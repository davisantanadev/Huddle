// "@" autocomplete for the chat box and the call chat: typing @ followed by
// part of a name lists the people who can see the channel; ↑/↓ choose, Enter
// or Tab (or a click) inserts "@username ". The list lives outside the app
// tree, so re-renders never close it while typing.

const MAX_RESULTS = 8;
const state = new WeakMap(); // input -> { items, index, start }
let popup = null;
let activeInput = null;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The "@word" being typed right before the cursor, if any
function currentQuery(input) {
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const m = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u.exec(before);
  return m ? { start: pos - m[2].length - 1, text: m[2].toLowerCase() } : null;
}

function close() {
  popup?.remove();
  popup = null;
  if (activeInput) state.delete(activeInput);
  activeInput = null;
}

function renderCandidateIcon(u, renderAvatar) {
  if (u.kind === "group") {
    return `<span class="mention-badge-icon">@</span>`;
  }
  if (u.kind === "role") {
    const color = escapeHtml(u.color || "#99aab5");
    return `<span class="mention-role-badge" style="color:${color};border:1px solid ${color};">@</span>`;
  }
  return renderAvatar ? renderAvatar(u) : `<span class="mention-badge-icon">@</span>`;
}

function render(input, entry, renderAvatar) {
  if (!popup) {
    popup = document.createElement("div");
    popup.className = "mention-popup";
    popup.setAttribute("data-testid", "mention-popup");
    // mousedown (not click) so the box keeps focus
    popup.addEventListener("mousedown", (e) => {
      const row = e.target.closest("[data-mention-index]");
      if (!row || !activeInput) return;
      e.preventDefault();
      choose(activeInput, Number(row.getAttribute("data-mention-index")));
    });
    document.body.appendChild(popup);
  }
  popup.innerHTML = `
    <div class="mention-popup-title">Menções — Membros, Cargos e @todos</div>
    ${entry.items
      .map((u, i) => {
        const nameStyle = u.kind === "role" && u.color ? `style="color:${escapeHtml(u.color)};font-weight:700;"` : "";
        const rightText = u.subtitle ? escapeHtml(u.subtitle) : `@${escapeHtml(u.username)}`;
        return `
      <div class="mention-row ${i === entry.index ? "active" : ""}" data-mention-index="${i}">
        ${renderCandidateIcon(u, renderAvatar)}
        <span class="mention-row-name" ${nameStyle}>${escapeHtml(u.displayName)}</span>
        <span class="mention-row-user">${rightText}</span>
      </div>`;
      })
      .join("")}`;
  const r = input.getBoundingClientRect();
  popup.style.left = `${Math.max(8, r.left)}px`;
  popup.style.width = `${Math.min(Math.max(r.width, 280), 440)}px`;
  popup.style.bottom = `${window.innerHeight - r.top + 8}px`;
}

function choose(input, index) {
  const entry = state.get(input);
  const item = entry?.items[index];
  if (!item) return close();
  const pos = input.selectionStart ?? input.value.length;
  const token = item.insertText || item.username;
  const insert = `@${token} `;
  input.value = input.value.slice(0, entry.start) + insert + input.value.slice(pos);
  const caret = entry.start + insert.length;
  input.focus();
  input.setSelectionRange(caret, caret);
  close();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// getPeople() -> [{ id, username, displayName, kind?, color?, subtitle?, insertText? }] for the channel of this box
export function attachMentionAutocomplete(input, getPeople, renderAvatar) {
  if (!input) return;
  input._mentionCtx = { getPeople, renderAvatar };
  if (input.dataset.mentions) return;
  input.dataset.mentions = "1";

  const update = () => {
    const ctx = input._mentionCtx || { getPeople, renderAvatar };
    const q = currentQuery(input);
    if (!q) return close();
    const people = (ctx.getPeople?.() || []).filter(Boolean);
    const items = people
      .map((u, idx) => {
        const name = String(u.displayName || "").toLowerCase();
        const user = String(u.username || "").toLowerCase();
        const aliases = Array.isArray(u.aliases) ? u.aliases.map((a) => String(a).toLowerCase()) : [];
        const starts =
          user.startsWith(q.text) ||
          name.startsWith(q.text) ||
          aliases.some((a) => a.startsWith(q.text));
        const includes =
          user.includes(q.text) ||
          name.includes(q.text) ||
          aliases.some((a) => a.includes(q.text));
        const kindBoost = u.kind === "group" ? -0.2 : u.kind === "role" ? -0.1 : 0;
        const rank = !q.text ? 2 + kindBoost : starts ? 0 + kindBoost : includes ? 1 + kindBoost : 9;
        return { u, rank, idx };
      })
      .filter((x) => x.rank < 9)
      .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
      .slice(0, MAX_RESULTS)
      .map((x) => x.u);
    if (!items.length) return close();
    const prev = state.get(input);
    const entry = { items, index: prev && prev.start === q.start ? Math.min(prev.index, items.length - 1) : 0, start: q.start };
    state.set(input, entry);
    activeInput = input;
    render(input, entry, ctx.renderAvatar);
  };

  input.addEventListener("input", update);
  input.addEventListener("click", update);
  input.addEventListener("blur", () => setTimeout(() => activeInput === input && close(), 120));
  // Capture phase: runs before the form's own Enter (send) handling
  input.addEventListener(
    "keydown",
    (e) => {
      const ctx = input._mentionCtx || { getPeople, renderAvatar };
      const entry = state.get(input);
      if (!entry || activeInput !== input) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = entry.items.length;
        entry.index = (entry.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        render(input, entry, ctx.renderAvatar);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        choose(input, entry.index);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    true
  );
}

export function closeMentionPopup() {
  close();
}
