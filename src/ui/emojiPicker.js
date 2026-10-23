// Emoji picker (message reactions and the chat box). Built once and kept
// outside the app tree: re-rendering the app never rebuilds its ~1900 buttons.
// "Frequentes" comes first: the user's most used emoji, topped up with presets.
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

const view = { root: null, target: null };

function build() {
  const root = document.createElement("div");
  root.className = "floating-popout emoji-picker";
  root.setAttribute("data-testid", "emoji-picker");
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
    view.root?.remove();
    view.target = null;
    return;
  }
  if (!view.root) view.root = build();
  const root = view.root;
  if (view.target !== target || !root.isConnected) {
    view.target = target;
    root.setAttribute("data-emoji-target", target);
    root.querySelector("[data-frequent-grid]").innerHTML = frequentEmojis()
      .map((e) => button(e, names.get(e) || ""))
      .join("");
    const search = root.querySelector(".emoji-search");
    search.value = "";
    filter("");
    root.querySelector(".emoji-scroll").scrollTop = 0;

    const a = anchor || { left: window.innerWidth - WIDTH - 280, right: window.innerWidth - 280, top: window.innerHeight - 90, bottom: window.innerHeight - 90 };
    const left = Math.max(8, Math.min(a.right - WIDTH, window.innerWidth - WIDTH - 8));
    const top = a.top - HEIGHT - 8 >= 8 ? a.top - HEIGHT - 8 : Math.min(a.bottom + 8, window.innerHeight - HEIGHT - 8);
    root.style.left = `${left}px`;
    root.style.top = `${Math.max(8, top)}px`;
    document.body.appendChild(root);
    requestAnimationFrame(() => search.focus());
  }
}

export function emojiPickerTarget() {
  return view.target;
}
