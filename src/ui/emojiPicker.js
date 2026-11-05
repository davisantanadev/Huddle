// Emoji picker (message reactions and the chat box). Built once, mounted in
// document.body, and toggled via hidden attribute so opening never rebuilds or
// re-layouts ~1900 buttons from scratch.
import { EMOJI_CATEGORIES } from "../data/emojis.js";

const DEFAULT_FREQUENT = ["👍", "❤️", "😂", "🔥", "😭", "🙏", "😍", "💀", "👀", "🎉", "😮", "😢", "😡", "✅", "💯", "🤣", "🥰", "😎", "🤔", "👏", "🥺", "😅", "🤝", "💜"];
const ORDER = ["people", "nature", "food", "activities", "travel", "objects", "symbols", "flags"];
const CATEGORY_ICONS = {
  frequent: "🕘",
  people: "😀",
  nature: "🌿",
  food: "🍔",
  activities: "⚽",
  travel: "🚗",
  objects: "💡",
  symbols: "❤️",
  flags: "🏳️"
};
const USAGE_KEY = "eco-emoji-usage";
const WIDTH = 420;
const HEIGHT = 440;

const categories = ORDER.map((id) => EMOJI_CATEGORIES.find((c) => c.id === id)).filter(Boolean);
const names = new Map();
for (const c of categories) for (const [emoji, name] of c.emojis) names.set(emoji, name);

let frequentDirty = true;

function readUsage() {
  try {
    return JSON.parse(localStorage.getItem(USAGE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

export function recordEmojiUse(emoji) {
  try {
    const usage = readUsage();
    usage[emoji] = (usage[emoji] || 0) + 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    frequentDirty = true;
  } catch (_) {}
}

function frequentEmojis() {
  const used = Object.entries(readUsage())
    .sort((a, b) => b[1] - a[1])
    .map(([emoji]) => emoji);
  return [...new Set([...used, ...DEFAULT_FREQUENT])].slice(0, 24);
}

const button = (emoji, name) =>
  `<button type="button" class="emoji-btn" data-action="select-emoji" data-emoji="${emoji}" data-name="${name || ""}" title=":${name || ""}:">${emoji}</button>`;

const view = { root: null, target: null, lastFrequentKey: "" };

function refreshFrequentGrid(root) {
  const list = frequentEmojis();
  const key = list.join("|");
  if (!frequentDirty && view.lastFrequentKey === key) return;
  frequentDirty = false;
  view.lastFrequentKey = key;
  const grid = root.querySelector("[data-frequent-grid]");
  if (grid) {
    grid.innerHTML = list.map((e) => button(e, names.get(e) || "")).join("");
  }
}

function build() {
  const root = document.createElement("div");
  root.className = "floating-popout emoji-picker";
  root.setAttribute("data-testid", "emoji-picker");
  root.hidden = true;
  root.innerHTML = `
    <div class="emoji-picker-head">
      <input type="text" class="emoji-search" placeholder="Buscar emoji (ex.: grinning, heart, fire)" autocomplete="off" data-testid="emoji-search" />
    </div>
    <div class="emoji-picker-main">
      <nav class="emoji-cats">
        ${["frequent", ...categories.map((c) => c.id)]
          .map((id) => `<button type="button" class="emoji-cat-btn" data-emoji-cat="${id}" title="${id === "frequent" ? "Frequentes" : categories.find((c) => c.id === id).label}">${CATEGORY_ICONS[id]}</button>`)
          .join("")}
      </nav>
      <div class="emoji-scroll">
        <section class="emoji-section" data-emoji-section="frequent">
          <h4>Frequentes</h4>
          <div class="emoji-grid" data-frequent-grid></div>
        </section>
        ${categories
          .map(
            (c) => `
          <section class="emoji-section" data-emoji-section="${c.id}">
            <h4>${c.label}</h4>
            <div class="emoji-grid">${c.emojis.map(([e, n]) => button(e, n)).join("")}</div>
          </section>`
          )
          .join("")}
        <section class="emoji-section" data-emoji-section="results" hidden>
          <h4>Resultados</h4>
          <div class="emoji-grid" data-results-grid></div>
        </section>
        <div class="emoji-empty" hidden>Nenhum emoji encontrado.</div>
      </div>
    </div>
    <div class="emoji-picker-foot">
      <span class="emoji-foot-preview">😀</span>
      <span class="emoji-foot-name">:grinning_face:</span>
    </div>
  `;

  refreshFrequentGrid(root);

  const search = root.querySelector(".emoji-search");
  search.addEventListener("input", () => filter(search.value));
  root.querySelector(".emoji-cats").addEventListener("click", (e) => {
    const cat = e.target.closest("[data-emoji-cat]")?.getAttribute("data-emoji-cat");
    if (!cat) return;
    if (search.value) {
      search.value = "";
      filter("");
    }
    root.querySelector(`[data-emoji-section="${cat}"]`)?.scrollIntoView({ block: "start" });
  });
  root.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".emoji-btn");
    if (!btn) return;
    root.querySelector(".emoji-foot-preview").textContent = btn.getAttribute("data-emoji");
    root.querySelector(".emoji-foot-name").textContent = `:${btn.getAttribute("data-name")}:`;
  });
  return root;
}

function ensureMounted() {
  if (!view.root) view.root = build();
  if (!view.root.isConnected && document.body) {
    document.body.appendChild(view.root);
  }
  return view.root;
}

// Pre-warm the emoji picker DOM during browser idle time so the very first click
// opens instantaneously without waiting for ~1900 buttons to parse & mount.
if (typeof window !== "undefined") {
  const warm = () => {
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 120));
    schedule(() => {
      if (document.body && !view.root) ensureMounted();
    });
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", warm, { once: true });
  } else {
    warm();
  }
}

// Searching shows one "Resultados" list: exact name first, then names that
// start with the words typed, then names that contain them
function filter(query) {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, "").replace(/\s+/g, "_");
  const root = view.root;
  const results = root.querySelector('[data-emoji-section="results"]');
  for (const section of root.querySelectorAll(".emoji-section")) section.hidden = Boolean(q) && section !== results;
  results.hidden = !q;
  if (!q) {
    root.querySelector(".emoji-empty").hidden = true;
    return;
  }
  const rank = (name) => (name === q ? 0 : name.startsWith(q) ? 1 : name.split("_").includes(q) ? 2 : name.includes(q) ? 3 : 9);
  const found = [...names]
    .map(([emoji, name]) => [emoji, name, rank(name)])
    .filter(([, , r]) => r < 9)
    .sort((a, b) => a[2] - b[2] || a[1].length - b[1].length)
    .slice(0, 180);
  root.querySelector("[data-results-grid]").innerHTML = found.map(([e, n]) => button(e, n)).join("");
  root.querySelector(".emoji-empty").hidden = found.length > 0;
}

// Opens/updates/closes the picker to match the app state; anchor = rect of the
// button that opened it
export function syncEmojiPicker(target, anchor) {
  if (!target) {
    if (view.root) view.root.hidden = true;
    view.target = null;
    return;
  }
  const root = ensureMounted();
  const wasHidden = root.hidden;
  if (view.target !== target || wasHidden) {
    view.target = target;
    root.setAttribute("data-emoji-target", target);
    refreshFrequentGrid(root);
    const search = root.querySelector(".emoji-search");
    if (search.value) {
      search.value = "";
      filter("");
    }
    const scrollEl = root.querySelector(".emoji-scroll");
    if (scrollEl) scrollEl.scrollTop = 0;

    const a = anchor || { left: window.innerWidth - WIDTH - 280, right: window.innerWidth - 280, top: window.innerHeight - 90, bottom: window.innerHeight - 90 };
    const left = Math.max(8, Math.min(a.right - WIDTH, window.innerWidth - WIDTH - 8));
    const top = a.top - HEIGHT - 8 >= 8 ? a.top - HEIGHT - 8 : Math.min(a.bottom + 8, window.innerHeight - HEIGHT - 8);
    root.style.left = `${left}px`;
    root.style.top = `${Math.max(8, top)}px`;
    root.hidden = false;
    requestAnimationFrame(() => search.focus());
  }
}

export function emojiPickerTarget() {
  return view.target;
}
