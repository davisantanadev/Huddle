// Builds electron/gameCatalog.steam.json: the most-owned games on Steam, for
// the activity detector ("Jogando X") and their cover art.
//
// 1. Names and owner counts from SteamSpy pages saved beforehand
//    (https://steamspy.com/api.php?request=all&page=N, one page per minute).
// 2. Steam's public store API (IStoreBrowseService/GetItems, no key) tells
//    games (type 0) from software (OBS, Blender, Wallpaper Engine...) and
//    gives the exact path of each cover: newer games keep their images under
//    a hashed folder, which is why covers built from the app id alone broke.
//
// Usage: node scripts/build-game-catalog.js <folder with page*.json> [max]
// Output rows: [appid, name, coverPath] (coverPath relative to the Steam CDN).

const fs = require("fs");
const path = require("path");

const [pagesDir, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg) || 6000;
const OUT = path.join(__dirname, "..", "electron", "gameCatalog.steam.json");

// Not games, or not something anyone "plays"
const SKIP_NAME = /soundtrack|dedicated server|\bsdk\b|playtest|\bdemo\b|test server|benchmark|steamworks|source filmmaker|\bmod tools?\b|\beditor\b|wallpaper|\bpublic test\b/i;
// Window titles of ordinary programs: a game with exactly this name would
// make anyone with that window open "play" it
const COMMON_WINDOW_TITLES = new Set(
  [
    "steam", "discord", "spotify", "settings", "calculator", "photos", "paint", "notepad", "terminal", "task manager",
    "file explorer", "explorer", "control panel", "netflix", "youtube", "mail", "calendar", "camera", "clock", "maps",
    "store", "microsoft store", "xbox", "home", "desktop", "untitled", "new tab", "chat", "music", "movies", "news",
    "weather", "search", "start", "run", "help", "about", "loading", "launcher", "game", "play", "window", "the game"
  ].map((s) => s.toLowerCase())
);

function ownersLow(owners) {
  return Number(String(owners || "0").split("..")[0].replace(/[^\d]/g, "")) || 0;
}

async function getItems(ids) {
  const input = {
    ids: ids.map((appid) => ({ appid })),
    context: { language: "english", country_code: "US" },
    data_request: { include_assets: true }
  };
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json())?.response?.store_items || [];
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return [];
}

function coverPath(item) {
  const a = item.assets;
  if (!a?.asset_url_format) return "";
  const file = a.library_capsule_2x || a.library_capsule || a.header || "";
  if (!file) return "";
  return a.asset_url_format.replace("${FILENAME}", file).replace(/\?.*$/, "");
}

(async () => {
  const candidates = new Map();
  for (const f of fs.readdirSync(pagesDir).filter((n) => /^page\d+\.json$/.test(n))) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(pagesDir, f), "utf8"));
    } catch (_) {
      continue;
    }
    for (const g of Object.values(data)) {
      const name = String(g.name || "").trim();
      if (!g.appid || !name || SKIP_NAME.test(name)) continue;
      candidates.set(g.appid, { appid: g.appid, name, owners: ownersLow(g.owners), ccu: Number(g.ccu) || 0, positive: Number(g.positive) || 0 });
    }
  }
  // The hand-made entries with a Steam id always get their (correct) cover path
  const { GAME_CATALOG } = require("../electron/gameCatalog");
  const curated = GAME_CATALOG.filter((g) => g.steamAppId).map((g) => ({ appid: g.steamAppId, name: g.name, owners: Infinity, curated: true }));
  for (const g of curated) candidates.delete(g.appid);
  const ranked = [...curated, ...[...candidates.values()].sort((a, b) => b.owners - a.owners || b.ccu - a.ccu || b.positive - a.positive)];
  console.log(`${ranked.length} candidates from SteamSpy`);

  const rows = [];
  const seenNames = new Set();
  for (let i = 0; i < ranked.length && rows.length < MAX; i += 100) {
    const batch = ranked.slice(i, i + 100);
    const items = await getItems(batch.map((g) => g.appid));
    const byId = new Map(items.map((it) => [it.appid || it.id, it]));
    for (const g of batch) {
      const it = byId.get(g.appid);
      if (!it || it.success !== 1 || it.type !== 0) continue; // games only
      const name = String(it.name || g.name).trim();
      const key = name.toLowerCase();
      if (!g.curated && (name.length < 4 || COMMON_WINDOW_TITLES.has(key) || seenNames.has(key))) continue;
      seenNames.add(key);
      rows.push([g.appid, name, coverPath(it)]);
      if (rows.length >= MAX) break;
    }
    process.stdout.write(`\r${Math.min(i + 100, ranked.length)}/${ranked.length} checked, ${rows.length} games`);
  }
  fs.writeFileSync(OUT, JSON.stringify(rows));
  console.log(`\nWrote ${rows.length} games to ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})();
