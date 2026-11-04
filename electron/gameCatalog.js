"use strict";

// Games recognised by the activity detector. They are matched by the title of
// the game's window: equal to the name (ignoring case, ™/® and extra spaces),
// the name followed by a version/subtitle, or one of `titles` when the window
// is named differently. `exe` documents the executable. steamAppId, when known,
// gives the cover art in the profile's "Atividade" tab; the rest show a
// coloured card with initials.
const GAME_CATALOG = [
  { id: "valorant", name: "VALORANT", exe: ["VALORANT-Win64-Shipping.exe"], color: "#ff4655" },
  { id: "league-of-legends", name: "League of Legends", exe: ["League of Legends.exe"], color: "#0a96aa" },
  { id: "fortnite", name: "Fortnite", exe: ["FortniteClient-Win64-Shipping.exe"], color: "#7b2fbe" },
  { id: "roblox", name: "Roblox", exe: ["RobloxPlayerBeta.exe"], color: "#e2231a" },
  { id: "minecraft", name: "Minecraft", exe: ["Minecraft.Windows.exe", "javaw.exe"], color: "#4c8c2b", titles: [/^Minecraft\*?\s+\d/i] },
  { id: "genshin-impact", name: "Genshin Impact", exe: ["GenshinImpact.exe"], color: "#3f6fd8" },
  { id: "cs2", name: "Counter-Strike 2", exe: ["cs2.exe"], steamAppId: 730 },
  { id: "dota2", name: "Dota 2", exe: ["dota2.exe"], steamAppId: 570 },
  { id: "apex-legends", name: "Apex Legends", exe: ["r5apex.exe", "r5apex_dx12.exe"], steamAppId: 1172470 },
  { id: "pubg", name: "PUBG: BATTLEGROUNDS", exe: ["TslGame.exe"], steamAppId: 578080 },
  { id: "rust", name: "Rust", exe: ["RustClient.exe"], steamAppId: 252490 },
  { id: "gta5", name: "Grand Theft Auto V", exe: ["GTA5.exe", "GTA5_Enhanced.exe"], steamAppId: 271590 },
  { id: "elden-ring", name: "ELDEN RING", exe: ["eldenring.exe"], steamAppId: 1245620 },
  { id: "sekiro", name: "Sekiro: Shadows Die Twice", exe: ["sekiro.exe"], steamAppId: 814380, titles: [/^Sekiro\b/i] },
  { id: "tekken8", name: "TEKKEN 8", exe: ["Polaris-Win64-Shipping.exe"], steamAppId: 1778820 },
  { id: "sifu", name: "Sifu", exe: ["Sifu-Win64-Shipping.exe"], steamAppId: 2138710 },
  { id: "ghost-of-tsushima", name: "Ghost of Tsushima", exe: ["GhostOfTsushima.exe"], steamAppId: 2215430 },
  { id: "monster-hunter-rise", name: "Monster Hunter Rise", exe: ["MonsterHunterRise.exe"], steamAppId: 1446780 },
  { id: "monster-hunter-wilds", name: "Monster Hunter Wilds", exe: ["MonsterHunterWilds.exe"], steamAppId: 2246340 },
  { id: "ark-ascended", name: "ARK: Survival Ascended", exe: ["ArkAscended.exe"], steamAppId: 2399830 },
  { id: "ark-evolved", name: "ARK: Survival Evolved", exe: ["ShooterGame.exe"], steamAppId: 346110 },
  { id: "rocket-league", name: "Rocket League", exe: ["RocketLeague.exe"], steamAppId: 252950 },
  { id: "rainbow-six-siege", name: "Rainbow Six Siege", exe: ["RainbowSix.exe", "RainbowSix_Vulkan.exe"], steamAppId: 359550, titles: [/^Rainbow Six\b/i] },
  { id: "dead-by-daylight", name: "Dead by Daylight", exe: ["DeadByDaylight-Win64-Shipping.exe"], steamAppId: 381210 },
  { id: "cyberpunk-2077", name: "Cyberpunk 2077", exe: ["Cyberpunk2077.exe"], steamAppId: 1091500 },
  { id: "witcher3", name: "The Witcher 3: Wild Hunt", exe: ["witcher3.exe"], steamAppId: 292030, titles: [/^The Witcher 3\b/i] },
  { id: "rdr2", name: "Red Dead Redemption 2", exe: ["RDR2.exe"], steamAppId: 1174180 },
  { id: "baldurs-gate-3", name: "Baldur's Gate 3", exe: ["bg3.exe", "bg3_dx11.exe"], steamAppId: 1086940 },
  { id: "terraria", name: "Terraria", exe: ["Terraria.exe"], steamAppId: 105600, titles: [/^Terraria\b/i] },
  { id: "stardew-valley", name: "Stardew Valley", exe: ["Stardew Valley.exe", "StardewModdingAPI.exe"], steamAppId: 413150 },
  { id: "among-us", name: "Among Us", exe: ["Among Us.exe"], steamAppId: 945360 },
  { id: "palworld", name: "Palworld", exe: ["Palworld-Win64-Shipping.exe"], steamAppId: 1623730 },
  { id: "helldivers2", name: "HELLDIVERS 2", exe: ["helldivers2.exe"], steamAppId: 553850 },
  { id: "marvel-rivals", name: "Marvel Rivals", exe: ["Marvel-Win64-Shipping.exe"], steamAppId: 2767030 },
  { id: "the-finals", name: "THE FINALS", exe: ["Discovery.exe"], steamAppId: 2073850 },
  { id: "lethal-company", name: "Lethal Company", exe: ["Lethal Company.exe"], steamAppId: 1966720 },
  { id: "phasmophobia", name: "Phasmophobia", exe: ["Phasmophobia.exe"], steamAppId: 739630 },
  { id: "overwatch2", name: "Overwatch 2", exe: ["Overwatch.exe"], steamAppId: 2357570, titles: [/^Overwatch\b/i] },
  { id: "call-of-duty", name: "Call of Duty", exe: ["cod.exe"], steamAppId: 1938090 },
  { id: "ea-fc-25", name: "EA SPORTS FC 25", exe: ["FC25.exe"], steamAppId: 2669320 },
  { id: "hollow-knight", name: "Hollow Knight", exe: ["hollow_knight.exe"], steamAppId: 367520 },
  { id: "euro-truck-simulator-2", name: "Euro Truck Simulator 2", exe: ["eurotrucks2.exe"], steamAppId: 227300 },
  { id: "valheim", name: "Valheim", exe: ["valheim.exe"], steamAppId: 892970 },
  { id: "destiny2", name: "Destiny 2", exe: ["destiny2.exe"], steamAppId: 1085660 },
  { id: "warframe", name: "Warframe", exe: ["Warframe.x64.exe"], steamAppId: 230410 },
  // Recent hits that owner counts have not caught up with yet
  { id: "silksong", name: "Hollow Knight: Silksong", exe: ["Hollow Knight Silksong.exe"], steamAppId: 1030300 },
  { id: "battlefield-6", name: "Battlefield 6", exe: ["bf6.exe"], steamAppId: 2807960 },
  { id: "expedition-33", name: "Clair Obscur: Expedition 33", exe: ["SandFall-Win64-Shipping.exe"], steamAppId: 1903340 },
  { id: "split-fiction", name: "Split Fiction", exe: ["SplitFiction.exe"], steamAppId: 2001120 },
  { id: "kcd2", name: "Kingdom Come: Deliverance II", exe: ["KingdomCome.exe"], steamAppId: 1771300 },
  { id: "nightreign", name: "ELDEN RING NIGHTREIGN", exe: ["nightreign.exe"], steamAppId: 2622380 },
  { id: "black-myth-wukong", name: "Black Myth: Wukong", exe: ["b1-Win64-Shipping.exe"], steamAppId: 2358720 },
  { id: "peak", name: "PEAK", exe: ["PEAK.exe"], steamAppId: 3527290 },
  // Popular games outside Steam (no Steam cover: coloured card, or the window's icon)
  { id: "honkai-star-rail", name: "Honkai: Star Rail", exe: ["StarRail.exe"], color: "#5b6bd6" },
  { id: "zenless-zone-zero", name: "Zenless Zone Zero", exe: ["ZenlessZoneZero.exe"], color: "#e8a316" },
  { id: "wow", name: "World of Warcraft", exe: ["Wow.exe"], color: "#f8b700" },
  { id: "hearthstone", name: "Hearthstone", exe: ["Hearthstone.exe"], color: "#c8853a" },
  { id: "diablo-iv", name: "Diablo IV", exe: ["Diablo IV.exe"], steamAppId: 2344520 },
  { id: "teamfight-tactics", name: "Teamfight Tactics", exe: ["League of Legends.exe"], color: "#c89b3c", titles: [/^Teamfight Tactics\b/i] },
  { id: "legends-of-runeterra", name: "Legends of Runeterra", exe: ["LoR.exe"], color: "#1f6f8b" },
  { id: "osu", name: "osu!", exe: ["osu!.exe"], color: "#ff66aa", titles: [/^osu!(\s|$)/i] },
  { id: "free-fire", name: "Free Fire", exe: [], color: "#f39c12", titles: [/^Free Fire\b/i] },
  { id: "brawlhalla", name: "Brawlhalla", exe: ["Brawlhalla.exe"], steamAppId: 291550 },
  { id: "fall-guys", name: "Fall Guys", exe: ["FallGuys_client_game.exe"], steamAppId: 1097150 },
  { id: "the-sims-4", name: "The Sims 4", exe: ["TS4_x64.exe"], steamAppId: 1222670 },
  { id: "wuthering-waves", name: "Wuthering Waves", exe: ["Client-Win64-Shipping.exe"], steamAppId: 3513350 },
  { id: "path-of-exile-2", name: "Path of Exile 2", exe: ["PathOfExile.exe"], steamAppId: 2694490 },
  { id: "deadlock", name: "Deadlock", exe: ["deadlock.exe"], steamAppId: 1422450 }
];

const BY_EXE = new Map();
const BY_ID = new Map();
for (const game of GAME_CATALOG) {
  BY_ID.set(game.id, game);
  for (const exe of game.exe) BY_EXE.set(exe.toLowerCase(), game);
}

function findGameByExe(exeName) {
  return BY_EXE.get(String(exeName || "").toLowerCase()) || null;
}

// Browser tabs ("Roblox - YouTube - Google Chrome") are never a game
const BROWSER_SUFFIX = /\s[-–—]\s(Google Chrome|Mozilla Firefox|Microsoft\u200b? ?Edge|Opera( GX)?|Brave|Vivaldi|Arc)$/i;

function normalizeTitle(text) {
  return String(text || "")
    .replace(/[™®©]/g, "")
    .replace(/[’`]/g, "'")
    // "Hollow Knight: Silksong" on Steam, "Hollow Knight Silksong" on the window
    .replace(/:/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ==========================================================================
// The thousands of most-owned Steam games (electron/gameCatalog.steam.json,
// built by scripts/build-game-catalog.js): rows [appid, name, coverPath].
// Loaded once, on first use, into lookups that cost the same however many
// games there are: a window title is checked against a name index, not the
// whole list. Their ids are "steam-<appid>".
// ==========================================================================
const STEAM_CDN = "https://shared.cloudflare.steamstatic.com/store_item_assets/";
let steam = null; // { byName: Map(normalized name -> row), byAppId: Map(appid -> row) }

function loadSteamCatalog() {
  if (steam) return steam;
  steam = { byName: new Map(), byAppId: new Map() };
  let rows = [];
  try {
    rows = require("./gameCatalog.steam.json");
  } catch (_) {}
  const curatedNames = new Set(GAME_CATALOG.map((g) => normalizeTitle(g.name)));
  for (const row of rows) {
    steam.byAppId.set(row[0], row);
    const name = normalizeTitle(row[1]);
    // The hand-made entries above win (their window rules are tuned)
    if (!curatedNames.has(name) && !steam.byName.has(name)) steam.byName.set(name, row);
  }
  return steam;
}

function steamGame(row) {
  return { id: `steam-${row[0]}`, name: row[1], steamAppId: row[0] };
}

// What may follow a Steam game's name in its window title without it being
// some other program: a version, a build, a renderer, a bracketed note
const STEAM_TITLE_SUFFIX = /^(v?\d[\w.\-]*|\(.*\)|\[.*\]|(dx|directx)\s?\d+|vulkan|opengl|x64|x86|64-bit|32-bit|beta|alpha|early access|build\b.*|version\b.*)(\s|$)/i;

function findSteamGameByTitle(n) {
  const { byName } = loadSteamCatalog();
  const exact = byName.get(n);
  if (exact) return steamGame(exact);
  if (n.includes(" - ")) return null; // "Song - Artist", "Document - App"...
  // The name followed by a version/renderer: try each word boundary
  for (let i = n.indexOf(" "); i > 0; i = n.indexOf(" ", i + 1)) {
    const row = byName.get(n.slice(0, i));
    if (row && STEAM_TITLE_SUFFIX.test(n.slice(i + 1))) return steamGame(row);
  }
  return null;
}

function findGameByTitle(title) {
  if (!title || BROWSER_SUFFIX.test(title)) return null;
  const n = normalizeTitle(title);
  for (const game of GAME_CATALOG) {
    if (game.titles?.some((re) => re.test(title)) || n === normalizeTitle(game.name)) return game;
  }
  // An exact Steam name beats the looser "name + anything" rule below
  // ("Hollow Knight Silksong" is not "Hollow Knight")
  const exactSteam = loadSteamCatalog().byName.get(n);
  if (exactSteam) return steamGame(exactSteam);
  for (const game of GAME_CATALOG) {
    const name = normalizeTitle(game.name);
    if (!n.startsWith(name + " ") || n.includes(" - ")) continue;
    // One-word names (PEAK, Rust, Sifu...) only with a version/renderer after
    // them: "Peak Performance" is not PEAK
    if (!name.includes(" ") && !STEAM_TITLE_SUFFIX.test(n.slice(name.length + 1))) continue;
    return game;
  }
  return findSteamGameByTitle(n);
}

function steamCoverUrl(appId) {
  const row = loadSteamCatalog().byAppId.get(appId);
  if (row?.[2]) return STEAM_CDN + row[2];
  // Not in the list: the classic path (older games keep it)
  return `${STEAM_CDN}steam/apps/${appId}/library_600x900_2x.jpg`;
}

function getGameArt(gameId) {
  const id = String(gameId || "");
  const steamMatch = /^steam-(\d+)$/.exec(id);
  if (steamMatch) return { coverUrl: steamCoverUrl(Number(steamMatch[1])), color: "#1b2838" };
  const game = BY_ID.get(id);
  if (!game) return { coverUrl: "", color: "#5865f2" };
  return {
    coverUrl: game.steamAppId ? steamCoverUrl(game.steamAppId) : "",
    color: game.color || "#5865f2"
  };
}

function gameCount() {
  return GAME_CATALOG.length + loadSteamCatalog().byName.size;
}

module.exports = { GAME_CATALOG, findGameByExe, findGameByTitle, getGameArt, gameCount };
