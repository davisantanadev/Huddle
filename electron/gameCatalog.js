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
  { id: "warframe", name: "Warframe", exe: ["Warframe.x64.exe"], steamAppId: 230410 }
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
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findGameByTitle(title) {
  if (!title || BROWSER_SUFFIX.test(title)) return null;
  const n = normalizeTitle(title);
  for (const game of GAME_CATALOG) {
    if (game.titles?.some((re) => re.test(title))) return game;
    const name = normalizeTitle(game.name);
    if (n === name || (n.startsWith(name + " ") && !n.includes(" - "))) return game;
  }
  return null;
}

function getGameArt(gameId) {
  const game = BY_ID.get(gameId);
  if (!game) return { coverUrl: "", color: "#5865f2" };
  return {
    coverUrl: game.steamAppId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/library_600x900.jpg` : "",
    color: game.color || "#5865f2"
  };
}

module.exports = { GAME_CATALOG, findGameByExe, findGameByTitle, getGameArt };
