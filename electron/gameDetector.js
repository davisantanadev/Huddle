"use strict";

// Detects what the user is doing on the PC, every SCAN_INTERVAL_MS, by reading
// the titles of the open windows (desktopCapturer, inside the app's own
// process; no tasklist/PowerShell processes are started):
//
// - Games from electron/gameCatalog.js. Each scan reports every running game
//   ("started", doubling as a heartbeat, with the window's icon) and games
//   that disappeared ("stopped").
// - Spotify (when enabled): its window is titled "Artist - Song" while playing
//   and "Spotify"/"Spotify Premium"/"Spotify Free" while paused. The window is
//   recognised by that idle title (or, if Spotify was already playing when the
//   app started, by asking Windows once which window belongs to Spotify.exe).

const { desktopCapturer, net } = require("electron");
const { execFile } = require("child_process");
const { findGameByTitle } = require("./gameCatalog");

const SCAN_INTERVAL_MS = 15 * 1000;
const SPOTIFY_IDLE_TITLE = /^Spotify( Premium| Free)?$/i;
const SPOTIFY_LOOKUP_INTERVAL_MS = 5 * 60 * 1000;

async function listWindows() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: true
    });
    return sources.map((s) => ({ id: s.id, title: String(s.name || "").trim(), icon: s.appIcon || null }));
  } catch (_) {
    return null;
  }
}

function iconDataUrl(icon) {
  try {
    if (!icon || icon.isEmpty()) return "";
    return icon.resize({ width: 32, height: 32, quality: "best" }).toDataURL();
  } catch (_) {
    return "";
  }
}

// Title of Spotify's main window, asked of Windows directly (rare fallback)
function spotifyTitleFromTasklist() {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/V", "/FI", "IMAGENAME eq Spotify.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        for (const line of String(stdout).split(/\r?\n/)) {
          const cols = line.match(/"([^"]*)"/g);
          const title = cols?.[cols.length - 1]?.slice(1, -1);
          if (title && title !== "N/A" && !/^(Default IME|MSCTFIME UI)$/.test(title)) return resolve(title);
        }
        resolve(null);
      }
    );
  });
}

// Cover art and length of a song, from the public iTunes catalogue (no key).
// Only a result by the same artist counts: no cover beats somebody else's.
const trackInfoCache = new Map();

function words(text) {
  return new Set(
    String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !["feat", "the", "mc"].includes(w))
  );
}

function sameArtist(a, b) {
  const wa = words(a);
  return [...words(b)].some((w) => wa.has(w));
}

async function lookupTrack({ artist, title }) {
  const key = `${artist}|${title}`.toLowerCase();
  if (trackInfoCache.has(key)) return trackInfoCache.get(key);
  let info = {};
  try {
    const term = encodeURIComponent(`${artist} ${title}`.slice(0, 200));
    const res = await net.fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10&country=BR`);
    const results = (await res.json())?.results || [];
    const hit = results.find((r) => sameArtist(r.artistName, artist) && words(r.trackName).size && sameArtist(r.trackName, title));
    if (hit) {
      info = {
        album: hit.collectionName || "",
        albumArtUrl: String(hit.artworkUrl100 || "").replace("100x100bb", "300x300bb"),
        durationMs: Number(hit.trackTimeMillis) || 0
      };
    }
  } catch (_) {}
  if (trackInfoCache.size > 200) trackInfoCache.clear();
  trackInfoCache.set(key, info);
  return info;
}

function parseTrack(title) {
  const i = title.indexOf(" - ");
  if (i <= 0) return null;
  return { artist: title.slice(0, i).trim(), title: title.slice(i + 3).trim() };
}

function startGameDetector(onActivity, { isSpotifyEnabled = () => false, isGameActivityEnabled = () => true } = {}) {
  if (process.platform !== "win32") return () => {};
  let running = new Map(); // gameId -> game
  let stopped = false;
  let spotifyWindowId = null;
  let lastTrackKey = null;
  let lastTrack = null; // { artist, title, album, albumArtUrl, durationMs, startedAt }
  let lastSpotifyLookup = 0;

  async function scanSpotify(windows) {
    if (!isSpotifyEnabled()) {
      if (lastTrackKey) onActivity({ kind: "spotify", state: "stopped" });
      lastTrackKey = null;
      return;
    }
    for (const w of windows) {
      if (SPOTIFY_IDLE_TITLE.test(w.title)) spotifyWindowId = w.id;
    }
    let win = spotifyWindowId ? windows.find((w) => w.id === spotifyWindowId) : null;
    if (spotifyWindowId && !win) spotifyWindowId = null; // Spotify was closed

    // Started while already playing: find its window once in a while
    if (!win && Date.now() - lastSpotifyLookup > SPOTIFY_LOOKUP_INTERVAL_MS && windows.some((w) => parseTrack(w.title))) {
      lastSpotifyLookup = Date.now();
      const title = await spotifyTitleFromTasklist();
      win = title ? windows.find((w) => w.title === title) : null;
      if (win) spotifyWindowId = win.id;
    }

    const track = win && !SPOTIFY_IDLE_TITLE.test(win.title) ? parseTrack(win.title) : null;
    const key = track ? `${track.artist}\u0000${track.title}` : null;
    if (key === lastTrackKey) {
      if (track && lastTrack) onActivity({ kind: "spotify", state: "playing", ...lastTrack, heartbeat: true });
      return;
    }
    lastTrackKey = key;
    if (!track) return onActivity({ kind: "spotify", state: "stopped" });
    const startedAt = Date.now();
    lastTrack = { ...track, startedAt, ...(await lookupTrack(track)) };
    if (lastTrackKey === key) onActivity({ kind: "spotify", state: "playing", ...lastTrack });
  }

  async function scan() {
    const windows = await listWindows();
    if (stopped || !windows) return;

    const now = new Map();
    if (isGameActivityEnabled()) {
      for (const w of windows) {
        const game = findGameByTitle(w.title);
        if (game && !now.has(game.id)) now.set(game.id, { game, icon: w.icon });
      }
    }
    for (const [id, { game, icon }] of now) {
      onActivity({ gameId: id, name: game.name, state: "started", iconDataUrl: running.has(id) ? undefined : iconDataUrl(icon) });
    }
    for (const [id, game] of running) {
      if (!now.has(id)) onActivity({ gameId: id, name: game.name, state: "stopped" });
    }
    running = new Map([...now].map(([id, { game }]) => [id, game]));

    await scanSpotify(windows);
  }

  const timer = setInterval(scan, SCAN_INTERVAL_MS);
  timer.unref();
  setTimeout(scan, 5000).unref();

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const [id, game] of running) onActivity({ gameId: id, name: game.name, state: "stopped" });
    running.clear();
    if (lastTrackKey) onActivity({ kind: "spotify", state: "stopped" });
  };
}

module.exports = { startGameDetector, parseTrack, lookupTrack };
