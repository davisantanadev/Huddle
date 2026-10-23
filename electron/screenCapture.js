"use strict";

// Real screen sharing for the renderer.
//
// The renderer lists sources (every monitor plus every open app window, as
// Windows reports them), picks one, then calls getDisplayMedia(). Electron's
// display-media handler answers that call with the picked source, so the
// capture runs natively on the GPU (Windows Graphics Capture) and the renderer
// gets a live MediaStream — no screenshots copied through the main process.

const { desktopCapturer } = require("electron");

const THUMB_SIZE = { width: 320, height: 180 };
let selected = { sourceId: null, includeAudio: false };

function isScreenId(id) {
  return String(id).startsWith("screen:");
}

function toDataUrl(image) {
  return image && !image.isEmpty() ? image.toDataURL() : "";
}

async function listSources({ thumbnailSize = THUMB_SIZE } = {}) {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize,
    fetchWindowIcons: true
  });
  const screens = sources.filter((s) => isScreenId(s.id));
  return sources.map((s) => {
    const screen = isScreenId(s.id);
    return {
      id: s.id,
      name: screen ? (screens.length > 1 ? `Tela ${screens.indexOf(s) + 1}` : "Tela inteira") : s.name,
      isScreen: screen,
      displayId: s.display_id || "",
      thumbnail: toDataUrl(s.thumbnail),
      appIcon: toDataUrl(s.appIcon)
    };
  });
}

function selectSource(opts = {}) {
  const sourceId = typeof opts === "string" ? opts : opts.sourceId;
  const includeAudio = typeof opts === "object" && opts ? Boolean(opts.includeAudio) : false;
  selected = { sourceId: sourceId || null, includeAudio };
  return { ok: true, selectedCaptureSource: selected };
}

// Answers getDisplayMedia() with the source picked in the app's own picker.
// Window ids stay valid while the window is open, so they are looked up again
// here; if it was closed in the meantime the request is denied.
function installDisplayMediaHandler(ses) {
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((s) => s.id === selected.sourceId);
      if (!source) return callback({});
      // System audio (loopback) is only available when sharing a whole screen
      const audio = selected.includeAudio && isScreenId(source.id) ? "loopback" : undefined;
      callback(audio ? { video: source, audio } : { video: source });
    } catch (_) {
      callback({});
    }
  });
}

function registerScreenCaptureHandlers(ipcMain, ses) {
  ipcMain.handle("DISCORD_DESKTOP_CAPTURER_GET_SOURCES", async (_e, options = {}) => {
    try {
      return await listSources(options);
    } catch (_) {
      return [];
    }
  });
  ipcMain.handle("DISCORD_DESKTOP_CAPTURER_SELECT_SOURCE", (_e, opts = {}) => selectSource(opts));
  installDisplayMediaHandler(ses);
}

module.exports = { registerScreenCaptureHandlers, listSources };
