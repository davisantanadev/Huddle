"use strict";

const https = require("https");

// =============================================================================
// Real, functional GIF provider.
//
// Historical note: this project originally targeted the Tenor (Google) API.
// Google FULLY SHUT DOWN the Tenor API on 2026-06-30 (it stopped accepting new
// clients in Jan 2026 and was decommissioned on Jun 30, 2026). Tenor is no
// longer usable. GIPHY is the live, free replacement that Google itself points
// integrators to, so this module now sources real animated GIFs from GIPHY's
// public v1 REST API.
//
//   Search:   https://api.giphy.com/v1/gifs/search?api_key=KEY&q=...
//   Trending: https://api.giphy.com/v1/gifs/trending?api_key=KEY
//
// The API key comes from GIPHY_API_KEY or app.config.local.json → "giphyApiKey"
// (see electron/appConfig.js). Create a free one at https://developers.giphy.com/.
// Without a key the picker uses the offline fallback GIFs.
// =============================================================================

const { loadAppConfig } = require("./appConfig");
const giphyApiKey = () => loadAppConfig().giphyApiKey;

const GIPHY_HOST = "api.giphy.com";
const REQUEST_TIMEOUT_MS = 7000;

// Results are cached so reopening the picker or revisiting a category is instant
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const responseCache = new Map(); // "endpoint?query" -> { at, json }

function getCached(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.json;
}

function setCached(key, json) {
  responseCache.delete(key);
  responseCache.set(key, { at: Date.now(), json });
  if (responseCache.size > CACHE_MAX_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value); // oldest entry
  }
}

const GIF_CATEGORIES = [
  "Todos",
  "Anime",
  "Gaming",
  "Cats",
  "Reaction",
  "Memes",
  "Cyberpunk",
  "Dance",
  "Celebration",
  "Lofi"
];

// Map our UI categories to real GIPHY search terms so clicking a category pill
// returns authentic, on-topic animated GIFs.
const CATEGORY_SEARCH_TERMS = {
  Anime: "anime",
  Gaming: "gaming",
  Cats: "cat",
  Reaction: "reaction",
  Memes: "meme",
  Cyberpunk: "cyberpunk neon",
  Dance: "dance",
  Celebration: "celebration confetti",
  Lofi: "lofi aesthetic"
};

function normalizeCategory(raw) {
  const clean = String(raw || "Todos").trim();
  if (clean === "All") return "Todos";
  return clean;
}

// Perform a GET request against the GIPHY REST API and parse JSON (cached).
async function giphyRequest(pathWithQuery) {
  const cached = getCached(pathWithQuery);
  if (cached) return cached;
  const json = await giphyFetch(pathWithQuery);
  setCached(pathWithQuery, json);
  return json;
}

function giphyFetch(pathWithQuery) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: GIPHY_HOST,
        path: pathWithQuery,
        headers: {
          Accept: "application/json",
          "User-Agent": "DiscordREA/1.0 (+gif-picker)"
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GIPHY HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`GIPHY JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("GIPHY request timed out"));
    });
    req.on("error", reject);
  });
}

// Pick the best animated GIF url from a GIPHY image object.
function pickGifUrl(images, keys) {
  for (const key of keys) {
    const entry = images && images[key];
    if (entry && entry.url) return entry.url;
  }
  return "";
}

// Map a raw GIPHY gif object into our normalized shape used by the frontend.
// Grid thumbnails use the 200px-wide WebP: same frames, frame rate and duration
// as the original GIF, at a fraction of the size. Never use the "downsampled"
// renditions: they keep only ~6 frames, which makes animations look choppy.
function pickPreviewUrl(images) {
  for (const key of ["fixed_width", "fixed_width_small"]) {
    const entry = images[key];
    if (entry && entry.webp) return entry.webp;
  }
  return pickGifUrl(images, ["fixed_width", "fixed_height", "preview_gif", "downsized"]);
}

function mapGiphyGif(g, category) {
  const images = g.images || {};
  const fullUrl = pickGifUrl(images, [
    "original",
    "downsized_large",
    "downsized",
    "fixed_height",
    "fixed_width"
  ]);
  const previewUrl = pickPreviewUrl(images) || fullUrl;
  // Full-size WebP keeps every frame at a fraction of the original GIF's size
  const largeUrl = (images.original && images.original.webp) || fullUrl;
  const dims = images.fixed_width || images.original || {};
  return {
    id: `giphy_${g.id}`,
    title: g.title && g.title.trim() ? g.title.trim() : "GIF",
    category,
    url: fullUrl,
    previewUrl,
    largeUrl,
    width: Number(dims.width) || 200,
    height: Number(dims.height) || 200,
    source: "GIPHY"
  };
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// =============================================================================
// Offline fallback: generate genuine multi-frame looping GIF89a buffers.
// Only used when the network/GIPHY API is unavailable so the picker never
// shows a broken/empty state. These are clearly flagged as the fallback source.
// =============================================================================
function createAnimatedGifBuffer(palette, patternType = 0, width = 64, height = 64) {
  const header = Buffer.from("474946383961", "hex"); // GIF89a
  const lsd = Buffer.from([
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    0xf1,
    0x00,
    0x00
  ]);
  const gct = Buffer.from(palette);
  const netscape = Buffer.from([
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01,
    0x00, 0x00, 0x00
  ]);

  const frameBuffers = [];
  const numFrames = 4;
  for (let f = 0; f < numFrames; f++) {
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0f, 0x00, 0x00, 0x00]);
    const id = Buffer.from([
      0x2c, 0x00, 0x00, 0x00, 0x00, width & 0xff, (width >> 8) & 0xff, height & 0xff,
      (height >> 8) & 0xff, 0x00
    ]);

    const pixels = Buffer.alloc(width * height, 0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let colorIdx = 0;
        if (patternType === 0) {
          colorIdx = (Math.floor((x + y + f * 12) / 8)) % 3 + 1;
        } else if (patternType === 1) {
          const dist = Math.sqrt((x - width / 2) ** 2 + (y - height / 2) ** 2);
          colorIdx = (Math.floor((dist - f * 4) / 6)) % 3 + 1;
          if (colorIdx < 1) colorIdx = 1;
        } else if (patternType === 2) {
          const barHeight = Math.sin((x / 6) + (f * Math.PI / 2)) * (height / 3) + (height / 2);
          colorIdx = y > barHeight ? 2 : 1;
        } else {
          const cx = Math.floor((x + f * 4) / 8);
          const cy = Math.floor((y + f * 4) / 8);
          colorIdx = ((cx + cy) % 3) + 1;
        }
        pixels[y * width + x] = colorIdx;
      }
    }

    const minCodeSize = 2;
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const codeSize = minCodeSize + 1;
    let bitBuf = 0;
    let bitCount = 0;
    const subBlocks = [];
    let curBlock = [];

    function writeBits(val, numBits) {
      bitBuf |= val << bitCount;
      bitCount += numBits;
      while (bitCount >= 8) {
        curBlock.push(bitBuf & 0xff);
        if (curBlock.length === 254) {
          subBlocks.push(Buffer.from([curBlock.length, ...curBlock]));
          curBlock = [];
        }
        bitBuf >>= 8;
        bitCount -= 8;
      }
    }

    writeBits(clearCode, codeSize);
    for (let i = 0; i < pixels.length; i++) writeBits(pixels[i], codeSize);
    writeBits(eoiCode, codeSize);
    if (bitCount > 0) curBlock.push(bitBuf & 0xff);
    if (curBlock.length > 0) subBlocks.push(Buffer.from([curBlock.length, ...curBlock]));
    subBlocks.push(Buffer.from([0x00]));

    const lzwData = Buffer.concat([Buffer.from([minCodeSize]), ...subBlocks]);
    frameBuffers.push(Buffer.concat([gce, id, lzwData]));
  }

  const trailer = Buffer.from([0x3b]);
  return Buffer.concat([header, lsd, gct, netscape, ...frameBuffers, trailer]);
}

function toDataUrl(buf) {
  return `data:image/gif;base64,${buf.toString("base64")}`;
}

const FALLBACK_PALETTES = {
  purple: [0x1e, 0x1f, 0x22, 0x58, 0x65, 0xf2, 0x85, 0x93, 0xf7, 0xeb, 0x45, 0x9e],
  green: [0x11, 0x18, 0x27, 0x10, 0xb9, 0x81, 0x34, 0xd3, 0x99, 0x6e, 0xe7, 0xb7],
  cyber: [0x0a, 0x0a, 0x12, 0x06, 0xb6, 0xd4, 0xec, 0x48, 0x99, 0xf5, 0x9e, 0x0b],
  pink: [0x1f, 0x12, 0x18, 0xf4, 0x3f, 0x5e, 0xfb, 0x71, 0x85, 0xff, 0xd1, 0xdc],
  neon: [0x13, 0x13, 0x1a, 0xa8, 0x55, 0xf7, 0x3b, 0x82, 0xf6, 0x10, 0xb9, 0x81],
  gold: [0x18, 0x16, 0x11, 0xf5, 0x9e, 0x0b, 0xfb, 0xbf, 0x24, 0xfa, 0xee, 0x7a]
};

let _fallbackCache = null;
function getFallbackGifs() {
  if (_fallbackCache) return _fallbackCache;
  const defs = [
    ["Anime", "purple", 2],
    ["Anime", "pink", 0],
    ["Gaming", "green", 1],
    ["Gaming", "cyber", 0],
    ["Cats", "pink", 3],
    ["Cats", "gold", 1],
    ["Reaction", "neon", 1],
    ["Reaction", "green", 2],
    ["Memes", "cyber", 3],
    ["Memes", "purple", 2],
    ["Cyberpunk", "cyber", 0],
    ["Lofi", "purple", 2],
    ["Dance", "pink", 1],
    ["Celebration", "gold", 3]
  ];
  _fallbackCache = defs.map(([cat, pal, pat], i) => {
    const url = toDataUrl(createAnimatedGifBuffer(FALLBACK_PALETTES[pal], pat, 64, 64));
    return {
      id: `fallback_${i}`,
      title: `${cat} (offline)`,
      category: cat,
      url,
      previewUrl: url,
      width: 64,
      height: 64,
      source: "Offline Fallback (GIPHY unavailable)"
    };
  });
  return _fallbackCache;
}

function fallbackSearch({ query, category, limit, offset }) {
  const cleanQ = String(query || "").trim().toLowerCase();
  const cleanCat = normalizeCategory(category);
  let matches = getFallbackGifs();
  if (cleanCat && cleanCat !== "Todos") {
    matches = matches.filter((g) => g.category.toLowerCase() === cleanCat.toLowerCase());
  }
  if (cleanQ) {
    matches = matches.filter(
      (g) => g.title.toLowerCase().includes(cleanQ) || g.category.toLowerCase().includes(cleanQ)
    );
  }
  const total = matches.length;
  const paged = matches.slice(offset, offset + limit);
  return {
    ok: true,
    query: cleanQ,
    category: cleanCat,
    total,
    offset,
    limit,
    categories: GIF_CATEGORIES,
    gifs: paged,
    source: "fallback"
  };
}

// =============================================================================
// Public async search: hits GIPHY first, falls back to procedural GIFs on any
// network/API failure so the picker is always functional.
// =============================================================================
async function searchGifs({ query = "", category = "Todos", limit = 16, offset = 0 } = {}) {
  const cleanQ = String(query || "").trim();
  const cleanCat = normalizeCategory(category);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 16));
  const safeOffset = Math.max(0, Number(offset) || 0);

  // Decide the effective GIPHY query:
  //  - explicit search text wins
  //  - otherwise a selected category maps to a search term
  //  - otherwise (Todos + no query) use the trending feed
  let effectiveQuery = cleanQ;
  if (!effectiveQuery && cleanCat && cleanCat !== "Todos") {
    effectiveQuery = CATEGORY_SEARCH_TERMS[cleanCat] || cleanCat;
  }

  try {
    let json;
    if (effectiveQuery) {
      const qs = buildQuery({
        api_key: giphyApiKey(),
        q: effectiveQuery,
        limit: safeLimit,
        offset: safeOffset,
        rating: "pg-13",
        bundle: "messaging_non_clips",
        lang: "pt"
      });
      json = await giphyRequest(`/v1/gifs/search?${qs}`);
    } else {
      const qs = buildQuery({
        api_key: giphyApiKey(),
        limit: safeLimit,
        offset: safeOffset,
        rating: "pg-13",
        bundle: "messaging_non_clips"
      });
      json = await giphyRequest(`/v1/gifs/trending?${qs}`);
    }

    const data = Array.isArray(json && json.data) ? json.data : [];
    const gifs = data
      .map((g) => mapGiphyGif(g, cleanCat === "Todos" ? "Trending" : cleanCat))
      .filter((g) => g.url && (g.url.startsWith("https://") || g.url.startsWith("http://")));

    const pagination = (json && json.pagination) || {};
    const total =
      typeof pagination.total_count === "number"
        ? pagination.total_count
        : safeOffset + gifs.length;

    if (gifs.length === 0) {
      // Valid API response but zero results for this query.
      return {
        ok: true,
        query: cleanQ,
        category: cleanCat,
        total: 0,
        offset: safeOffset,
        limit: safeLimit,
        categories: GIF_CATEGORIES,
        gifs: [],
        source: "giphy"
      };
    }

    return {
      ok: true,
      query: cleanQ,
      category: cleanCat,
      total,
      offset: safeOffset,
      limit: safeLimit,
      categories: GIF_CATEGORIES,
      gifs,
      source: "giphy"
    };
  } catch (err) {
    // Network down / API key invalid / timeout: degrade gracefully.
    console.warn(`[gifLibrary] GIPHY request failed, using offline fallback: ${err.message}`);
    return fallbackSearch({
      query: cleanQ,
      category: cleanCat,
      limit: safeLimit,
      offset: safeOffset
    });
  }
}

// Warm the cache with the trending feed so the picker opens instantly
function prefetchTrendingGifs() {
  return searchGifs({ category: "Todos", limit: 50, offset: 0 }).catch(() => {});
}

module.exports = {
  searchGifs,
  prefetchTrendingGifs,
  GIF_CATEGORIES,
  CATEGORY_SEARCH_TERMS,
  createAnimatedGifBuffer,
  getFallbackGifs
};
