// ==========================================================================
// Discord Desktop Replica — Main Renderer Application Controller
// Connected to Real SQLite Backend (Zero Illustrative Users in Production)
// ==========================================================================

import { store, AVAILABLE_THEMES } from "./state/store.js";
import { morphInnerHTML, bindReplacingDuplicates } from "./ui/morph.js";
import { syncEmojiPicker, recordEmojiUse } from "./ui/emojiPicker.js";
import { attachMentionAutocomplete } from "./ui/mentions.js";
import { Icons } from "./components/icons.js";
import {
  NativeBridge,
  IntegrationMetadata,
  ScreenShare,
  Voice,
  Camera,
  CallAudioEngine,
  VoiceDevices,
  VAD,
  AUDIO_ASSETS,
  SOUND_PRESETS as GATEWAY_SOUND_PRESETS
} from "./services/gatewayAdapter.js";

const EMOJI_PALETTE = ["👍", "❤️", "🔥", "🚀", "🎉", "😂", "👀", "⚡", "✅", "💯", "💜", "🦀"];

const BANNER_SWATCHES = [
  "#5865f2",
  "#eb459e",
  "#23a55a",
  "#f0b232",
  "#ed4245",
  "#0ea5e9",
  "#a855f7",
  "#14b8a6",
  "#f97316",
  "#1e1f22"
];

const SOUND_PRESETS = [
  { id: "discord-default", label: "Discord Padrão (Clássico)" },
  { id: "chime-crystal", label: "Cristal Harmônico" },
  { id: "synth-pulse", label: "Pulso Synthwave" },
  { id: "soft-pop", label: "Pop Suave Minimalista" },
  { id: "retro-8bit", label: "Arcade 8-Bit" },
  { id: "custom", label: "Arquivo de Áudio Personalizado" }
];

const uiState = {
  activeModal: null, // "create-server" | "create-channel" | "invite" | "quick-switcher" | "rea-info" | "custom-status" | "screenshare-picker"
  modalPayload: null,
  settingsOverlay: null, // null | { type: "user", tab: "account" } | { type: "server", tab: "overview" }
  userPopout: null, // null | { userId, anchor? } (anchor: rect of what was clicked)
  statusMenuOpen: false,
  serverMenuOpen: false,
  emojiPickerForMessageId: null, // null | "composer" | messageId
  pinnedPopoverOpen: false,
  replyingToMessageId: null,
  editingMessageId: null,
  callReplyToId: null,
  stagedAttachment: null,
  contextMenu: null, // null | { x, y, items: [...] }
  quickSwitcherQuery: "",
  toasts: [],

  // Phase 3: @username editing state
  usernameDraft: null,
  usernameAvailability: null, // null | { checking: true } | { available: bool, normalized, reason, message }
  usernameSaveStatus: null, // null | { ok: bool, msg: string }
  avatarLightbox: null, // { url, name } while a profile photo is expanded

  // Phase 5: Staged profile media customization
  stagedAvatar: null, // null | { url, name }
  stagedBanner: null, // null | { url, name }
  stagedBannerColor: null,
  stagedBannerPosY: null,

  // Phase 9: Screen share picker state
  screenSources: [],
  selectedScreenSourceId: null,
  selectedScreenSourceName: "",
  screenShareResolution: "1080p",
  screenShareFps: 60,
  screenShareAudio: false,
  loadingScreenSources: false,

  // Phase 10: Real user search results
  friendSearchResults: [],
  friendSearchQuery: "",
  friendSearchFeedback: null,

  // Phase 11: Server invites state
  currentInvite: null,
  guildInvitesList: [],
  inviteExpiresIn: 86400,
  inviteMaxUses: 0,
  inviteCopiedCode: null,
  joinInviteError: "",

  // Phase 7: Real audio devices & live mic test
  audioInputDevices: [],
  audioOutputDevices: [],
  selectedAudioInput: "default",
  selectedAudioOutput: "default",
  isTestingMic: false,
  micTestLevel: 0,

  // Call panel
  callFocusUserId: undefined, // undefined = automatic (a share fills the stage), null = grid, id = that tile
  callChatOpen: false,
  callChatWidth: (() => {
    try {
      return Math.min(640, Math.max(260, Number(localStorage.getItem("eco_call_chat_width")) || 340));
    } catch {
      return 340;
    }
  })(),
  // Widths of the channel list and the member list (dragged by their edge)
  channelsWidth: readStoredWidth("eco_channels_width", 240, 180, 420),
  membersWidth: readStoredWidth("eco_members_width", 240, 180, 420),
  stoppedWatching: {}, // sharer's userId -> true when the viewer chose "Parar de assistir"
  streamAspect: {}, // "userId" -> width/height of their stream, so the tile has its exact shape
  callStripHidden: (() => {
    try {
      return localStorage.getItem("eco_call_strip_hidden") === "1";
    } catch {
      return false;
    }
  })(),
  streamPopup: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem("eco_stream_popup") || "null");
      if (saved && saved.w >= 320) return saved;
    } catch {}
    return { x: 380, y: 90, w: 640, h: 400 };
  })(),
  callStagedAttachment: null, // file waiting to be sent in the call chat
  composerMenu: null, // null | "chat" | "call" — the "+" menu next to a message box

  // Confirmation dialog for destructive actions
  confirmDialog: null, // null | { title, message, quote?, confirmLabel, requirePassword?, attrs }

  // Account security tab
  accountSecurity: null, // snapshot from getAccountSecurity
  accountPanel: null, // null | "email" | "password" (which editor is expanded)
  accountFeedback: null, // null | { scope, ok, msg }
  accountDevCode: null, // null | { scope, code } when no e-mail service is configured
  accountBusy: false,

  // Full profile view: null | { userId, activities: null | [] }
  profileView: null,

  // Device menu opened from the arrows next to mic/headphones: null | "input" | "output"
  audioMenu: null,

  // Password prompt for the quick account switch
  switchAccountPrompt: null, // null | { userId, error }

  // Profile tab: which banner editor is shown
  bannerEditorMode: null // null (auto) | "color" | "image"
};

let usernameDebounceTimer = null;
let friendSearchDebounceTimer = null;

// ==========================================================================
// Phase 4: Unified Lifecycle Management for Pop-ups, Popovers & Menus
// ==========================================================================
function readStoredWidth(key, fallback, min, max) {
  try {
    return Math.min(max, Math.max(min, Number(localStorage.getItem(key)) || fallback));
  } catch {
    return fallback;
  }
}

// Sidebar edges: drag to resize (delegated once; the handles are re-rendered)
const SIDEBAR_LIMITS = { channels: [180, 420, "eco_channels_width", "--channels-width", 1], members: [180, 420, "eco_members_width", "--members-width", -1] };
document.addEventListener("mousedown", (downEvent) => {
  const handle = downEvent.target.closest?.("[data-sidebar-resizer]");
  if (!handle || downEvent.button !== 0) return;
  const which = handle.getAttribute("data-sidebar-resizer");
  const [min, max, storageKey, cssVar, direction] = SIDEBAR_LIMITS[which];
  const stateKey = which === "channels" ? "channelsWidth" : "membersWidth";
  downEvent.preventDefault();
  const root = document.querySelector(".app-root");
  const startX = downEvent.clientX;
  const startWidth = uiState[stateKey];
  document.body.classList.add("is-resizing");
  const onMove = (moveEvent) => {
    uiState[stateKey] = Math.round(Math.min(max, Math.max(min, startWidth + direction * (moveEvent.clientX - startX))));
    root?.style.setProperty(cssVar, `${uiState[stateKey]}px`);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("is-resizing");
    try {
      localStorage.setItem(storageKey, String(uiState[stateKey]));
    } catch {}
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

// DM call panel: collapsed or not, and its height (drag the line under it)
const DM_CALL_HEIGHT = { min: 190, fallback: 250, key: "eco_dm_call_height", collapsedKey: "eco_dm_call_collapsed" };
uiState.dmCallHeight = readStoredWidth(DM_CALL_HEIGHT.key, DM_CALL_HEIGHT.fallback, DM_CALL_HEIGHT.min, 2000);
try {
  uiState.dmCallCollapsed = localStorage.getItem(DM_CALL_HEIGHT.collapsedKey) === "1";
} catch {
  uiState.dmCallCollapsed = false;
}

document.addEventListener("mousedown", (downEvent) => {
  const handle = downEvent.target.closest?.("[data-dm-call-resizer]");
  if (!handle || downEvent.button !== 0) return;
  const panel = handle.closest(".dm-call-panel");
  if (!panel) return;
  downEvent.preventDefault();
  const startY = downEvent.clientY;
  const startHeight = panel.getBoundingClientRect().height;
  // Never more than ~70% of the conversation area, so the chat stays usable
  const max = Math.max(DM_CALL_HEIGHT.min, Math.round((panel.parentElement?.getBoundingClientRect().height || 700) * 0.7));
  document.body.classList.add("is-resizing", "is-resizing-row");
  const onMove = (moveEvent) => {
    uiState.dmCallHeight = Math.round(Math.min(max, Math.max(DM_CALL_HEIGHT.min, startHeight + moveEvent.clientY - startY)));
    panel.style.height = `${uiState.dmCallHeight}px`;
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("is-resizing", "is-resizing-row");
    try {
      localStorage.setItem(DM_CALL_HEIGHT.key, String(uiState.dmCallHeight));
    } catch {}
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

// Floating stream window: drag by the header, resize from the corner
document.addEventListener("mousedown", (downEvent) => {
  const drag = downEvent.target.closest?.("[data-stream-drag]");
  const resize = downEvent.target.closest?.("[data-stream-resize]");
  if ((!drag && !resize) || downEvent.button !== 0 || downEvent.target.closest("button")) return;
  const popup = downEvent.target.closest("[data-stream-popup]");
  if (!popup) return;
  downEvent.preventDefault();
  const start = { ...uiState.streamPopup, mx: downEvent.clientX, my: downEvent.clientY };
  document.body.classList.add(resize ? "is-resizing" : "is-dragging");
  const onMove = (e) => {
    const dx = e.clientX - start.mx;
    const dy = e.clientY - start.my;
    const box = uiState.streamPopup;
    if (resize) {
      box.w = Math.round(Math.min(window.innerWidth - 20, Math.max(320, start.w + dx)));
      box.h = Math.round(Math.min(window.innerHeight - 20, Math.max(200, start.h + dy)));
    } else {
      box.x = Math.round(Math.min(window.innerWidth - 80, Math.max(-box.w + 80, start.x + dx)));
      box.y = Math.round(Math.min(window.innerHeight - 40, Math.max(0, start.y + dy)));
    }
    popup.style.left = `${box.x}px`;
    popup.style.top = `${box.y}px`;
    popup.style.width = `${box.w}px`;
    popup.style.height = `${box.h}px`;
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("is-resizing", "is-dragging");
    try {
      localStorage.setItem("eco_stream_popup", JSON.stringify(uiState.streamPopup));
    } catch {}
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

export function closeAllFloatingMenus(except = null) {
  let changed = false;
  if (except !== "userPopout" && uiState.userPopout !== null) {
    uiState.userPopout = null;
    changed = true;
  }
  if (except !== "statusMenu" && uiState.statusMenuOpen) {
    uiState.statusMenuOpen = false;
    changed = true;
  }
  if (except !== "serverMenu" && uiState.serverMenuOpen) {
    uiState.serverMenuOpen = false;
    changed = true;
  }
  if (except !== "emojiPicker" && uiState.emojiPickerForMessageId !== null) {
    uiState.emojiPickerForMessageId = null;
    changed = true;
  }
  if (except !== "pinnedPopover" && uiState.pinnedPopoverOpen) {
    uiState.pinnedPopoverOpen = false;
    changed = true;
  }
  if (except !== "contextMenu" && uiState.contextMenu !== null) {
    uiState.contextMenu = null;
    changed = true;
  }
  if (except !== "audioMenu" && uiState.audioMenu !== null) {
    uiState.audioMenu = null;
    changed = true;
  }
  if (except !== "composerMenu" && uiState.composerMenu !== null) {
    uiState.composerMenu = null;
    changed = true;
  }
  return changed;
}

function hasAnyOpenFloatingMenu() {
  return Boolean(
    uiState.userPopout ||
      uiState.statusMenuOpen ||
      uiState.serverMenuOpen ||
      uiState.emojiPickerForMessageId ||
      uiState.pinnedPopoverOpen ||
      uiState.contextMenu ||
      uiState.audioMenu ||
      uiState.composerMenu
  );
}

function showToast(message) {
  const id = "t_" + Date.now() + Math.random();
  uiState.toasts.push({ id, message });
  renderToasts();
  setTimeout(() => {
    uiState.toasts = uiState.toasts.filter((t) => t.id !== id);
    renderToasts();
  }, 3000);
}

function renderToasts() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  container.innerHTML = uiState.toasts
    .map((t) => `<div class="toast-item">${escapeHtml(t.message)}</div>`)
    .join("");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getInitials(name) {
  const words = String(name || "U").trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || "U").slice(0, 2).toUpperCase();
}

// The green speaking ring is opt-in ({ speaking: true }): it belongs to the
// voice spots (channel list, account bar, call view), not to chat messages
// ==========================================================================
// Animated images (GIF avatars/banners)
// ==========================================================================
// GIFs from the Giphy library are played as MP4 (what Giphy serves for every
// GIF): a fraction of the size, decoded by the GPU at the clip's own frame
// rate. GIF files themselves can't be smooth: Chromium plays frames shorter
// than 20 ms as 100 ms. Animated avatars, server icons and banners always
// play (the small 200w clip is used for avatars, so it stays light).
const GIPHY_MEDIA = /^(https:\/\/media\d*\.giphy\.com\/media\/(?:[^/?#]+\/)?[A-Za-z0-9]+)\/[^/?#]+\.(?:gif|webp)(?:\?.*)?$/i;

function giphyRenditions(url) {
  const m = GIPHY_MEDIA.exec(String(url || ""));
  if (!m) return null;
  return { still: `${m[1]}/giphy_s.gif`, small: `${m[1]}/200w.mp4`, full: `${m[1]}/giphy.mp4` };
}

// mode: "animate" (always plays), "hover" (still frame, plays on hover)
function isMemorySaverActive() {
  if (uiState.memorySaver === undefined) {
    uiState.memorySaver = Boolean(window.DiscordNative?.processUtils?.getMemorySaver?.());
  }
  return Boolean(uiState.memorySaver);
}

function animatedImageHtml(url, { cls = "", style = "", alt = "", mode = "animate", size = "small", extra = "" } = {}) {
  const r = giphyRenditions(url);
  if (!r) {
    return `<img class="${cls}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="${style}" loading="lazy" decoding="async" ${extra} />`;
  }
  const effectiveMode = isMemorySaverActive() ? "hover" : mode;
  const video = size === "full" ? r.full : r.small;
  if (effectiveMode === "animate") {
    return `<video class="${cls}" src="${escapeHtml(video)}" poster="${escapeHtml(r.still)}" style="${style}" autoplay loop muted playsinline disablepictureinpicture preload="metadata" ${extra}></video>`;
  }
  return `<img class="${cls}" src="${escapeHtml(r.still)}" alt="${escapeHtml(alt)}" style="${style}" loading="lazy" decoding="async" ${extra} /><video class="${cls} hover-anim" data-anim-src="${escapeHtml(video)}" data-morph-keep-src style="${style}" loop muted playsinline disablepictureinpicture preload="none"></video>`;
}

// Animated banners/avatars must never freeze. The browser pauses a <video>
// when it is moved in the page (and "autoplay" only acts once), and a network
// hiccup can stall it: resume/reload anything meant to loop.
function keepAnimating(video) {
  if (isMemorySaverActive()) return;
  if (!video.isConnected || !video.autoplay || !video.loop) return;
  if (video.error) {
    const src = video.getAttribute("src");
    video.removeAttribute("src");
    video.load();
    video.src = src;
  }
  if (video.paused) video.play().catch(() => {});
}
document.addEventListener("pause", (e) => e.target instanceof HTMLVideoElement && setTimeout(() => keepAnimating(e.target), 50), true);
document.addEventListener("error", (e) => e.target instanceof HTMLVideoElement && setTimeout(() => keepAnimating(e.target), 2000), true);
document.addEventListener("stalled", (e) => e.target instanceof HTMLVideoElement && setTimeout(() => keepAnimating(e.target), 3000), true);
setInterval(() => document.querySelectorAll("video[autoplay][loop]").forEach(keepAnimating), 2000);

// Hover-to-play for the still avatars above (delegated once)
document.addEventListener("mouseover", (e) => {
  const host = e.target.closest?.(".avatar-wrap, .guild-btn");
  const video = host?.querySelector("video.hover-anim");
  if (!video || video.dataset.playing) return;
  video.dataset.playing = "1";
  if (!video.getAttribute("src")) video.src = video.dataset.animSrc;
  video.play().then(() => video.classList.add("playing")).catch(() => {});
  const leave = (ev) => {
    if (host.contains(ev.relatedTarget)) return;
    host.removeEventListener("mouseout", leave);
    delete video.dataset.playing;
    video.pause();
    video.classList.remove("playing");
  };
  host.addEventListener("mouseout", leave);
});

function renderAvatar(user, sizeClass = "", includeStatus = false, extraStyle = "", options = {}) {
  const u = user || { displayName: "User", avatarColor: "#5865f2", avatarUrl: "", status: "offline" };
  const avatarUrl = u.avatarUrl || "";
  const bg = u.avatarColor || "#5865f2";
  const st = store.getState?.();
  const isSpeaking = Boolean(options.speaking) && Boolean(st?.voice?.speakingUsers?.[u.id]);
  const speakingClass = isSpeaking ? "speaking" : "";

  const scale = Number(u.avatarScale ?? u.avatar_scale ?? 1);
  const cropX = Number(u.avatarCropX ?? u.avatar_crop_x ?? 0);
  const cropY = Number(u.avatarCropY ?? u.avatar_crop_y ?? 0);
  const transformStyle = scale !== 1 || cropX !== 0 || cropY !== 0 ? mediaFramingStyle(scale, cropX, cropY) : "";

  const inner = avatarUrl
    ? `<span class="avatar-clip">${animatedImageHtml(avatarUrl, { cls: "avatar-img", style: transformStyle, alt: u.displayName, mode: "animate" })}</span>`
    : escapeHtml(getInitials(u.displayName));
  const dot = includeStatus ? `<span class="status-dot ${escapeHtml(u.status || "offline")}"></span>` : "";
  return `
    <div class="avatar-wrap ${sizeClass} ${speakingClass}" style="background-color:${escapeHtml(bg)};${extraStyle}" data-user-id="${escapeHtml(u.id || "")}">
      ${inner}
      ${dot}
    </div>
  `;
}

// Framing of an avatar/banner (Configurações > Enquadrar). The X/Y sliders
// (-150..150) pick WHICH PART of the picture shows (object-position), and the
// zoom grows around that same point: the frame is always filled, any edge of
// a GIF can be reached. (Moving the picture itself with translate() left an
// empty strip on one side and cut the other, e.g. the bottom of a GIF.)
function framingPercent(offset) {
  return Math.round(Math.min(100, Math.max(0, 50 - Number(offset || 0) / 3)));
}
function mediaFramingStyle(scale = 1, cropX = 0, cropY = 0, fallbackPosY = 50) {
  const x = framingPercent(cropX);
  const y = Number(cropY) ? framingPercent(cropY) : Math.min(100, Math.max(0, Number(fallbackPosY) || 0));
  const s = Math.max(1, Number(scale) || 1);
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;${s !== 1 ? `transform:scale(${s});` : ""}`;
}

function renderBanner(user, heightPx = 100, override = {}) {
  const bannerUrl = override.bannerUrl !== undefined ? override.bannerUrl : user?.bannerUrl || "";
  const bannerColor = override.bannerColor || user?.bannerColor || user?.avatarColor || "#5865f2";
  const posY = override.bannerPositionY !== undefined ? override.bannerPositionY : user?.bannerPositionY ?? 50;

  const scale = Number(override.bannerScale !== undefined ? override.bannerScale : user?.bannerScale ?? user?.banner_scale ?? 1);
  const cropX = Number(override.bannerCropX !== undefined ? override.bannerCropX : user?.bannerCropX ?? user?.banner_crop_x ?? 0);
  const cropY = Number(override.bannerCropY !== undefined ? override.bannerCropY : user?.bannerCropY ?? user?.banner_crop_y ?? 0);

  if (bannerUrl) {
    return `
      <div class="profile-banner-box" style="height:${heightPx}px;background-color:${escapeHtml(bannerColor)};" data-testid="profile-banner">
        ${animatedImageHtml(bannerUrl, { cls: "profile-banner-img", style: mediaFramingStyle(scale, cropX, cropY, posY), alt: "Profile Banner", size: "full" })}
      </div>
    `;
  }
  return `
    <div
      class="profile-banner-box"
      style="height:${heightPx}px;background:${escapeHtml(bannerColor)};"
      data-testid="profile-banner"
    ></div>
  `;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

function formatMessageMarkdown(rawText) {
  let html = escapeHtml(rawText);
  // Links are set aside first so the other rules (mentions, *bold*...) can't break them
  const links = [];
  html = html.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => {
    links.push(url);
    return `\u0000${links.length - 1}\u0000`;
  });
  html = html.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(
    /\|\|([^|]+)\|\|/g,
    '<span class="spoiler-tag" data-action="toggle-spoiler" title="Clique para revelar spoiler">$1</span>'
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|\n)&gt;\s*(.+)/g, "$1<blockquote>$2</blockquote>");
  const users = Object.values(store.getState().users || {});
  const activeGuild = store.getActiveGuild();
  const guildRoles = activeGuild?.roles || [];
  html = html.replace(/(^|[^\w.])@([\p{L}\p{N}_.-]+)/gu, (whole, lead, name) => {
    const clean = name.replace(/\.+$/, "");
    const lower = clean.toLowerCase();
    if (lower === "everyone" || lower === "here" || lower === "all" || lower === "todos") {
      return `${lead}<span class="mention-pill mention-everyone" data-mention="${escapeHtml(clean)}">@${escapeHtml(clean)}</span>${name.slice(clean.length)}`;
    }
    const role = guildRoles.find((r) => r.name && r.name !== "@everyone" && r.name.toLowerCase() === lower);
    if (role) {
      const rColor = escapeHtml(role.color || "#dee0fc");
      const rBg = escapeHtml(role.color ? `${role.color}33` : "rgba(88, 101, 242, 0.22)");
      return `${lead}<span class="mention-pill mention-role" style="--role-mention-color:${rColor};--role-mention-bg:${rBg};" data-mention="${escapeHtml(role.name)}">@${escapeHtml(clean)}</span>${name.slice(clean.length)}`;
    }
    const u = users.find((x) => x.username?.toLowerCase() === lower);
    if (!u) return whole;
    return `${lead}<span class="mention-pill" data-mention="${escapeHtml(clean)}" data-action="open-user-popout" data-user-id="${escapeHtml(u.id)}">@${escapeHtml(clean)}</span>${name.slice(clean.length)}`;
  });
  html = html.replace(/\n/g, "<br/>");
  html = html.replace(/\u0000(\d+)\u0000/g, (_m, i) => {
    const url = links[Number(i)];
    return `<a class="chat-link" href="${url}" data-action="open-link" data-url="${url}" title="${url}">${url}</a>`;
  });
  return html;
}

// ==========================================================================
// Component Renderers
// ==========================================================================

function getAppName() {
  return store.getState().appConfig?.appName || "Huddle";
}

// Mirrors the backend's buildInviteUrl so placeholders show the real link format
function buildInviteUrl(code) {
  const base = store.getState().appConfig?.publicUrl || "";
  return `${base}/convite/${code}`;
}

// Brand mark: speech bubble with a voice waveform. `mono` follows currentColor
// (guild rail), the default variant uses the brand gradient.
const LOGO_BUBBLE_PATH =
  "M16 2.5C8.3 2.5 2.5 8.1 2.5 15c0 3.5 1.5 6.6 4 8.9l-1.3 5.4 6.1-2.9c1.5.5 3.1.7 4.7.7 7.7 0 13.5-5.3 13.5-12.1S23.7 2.5 16 2.5Z";
const LOGO_WAVE_BARS = `
  <rect x="8.6" y="12.4" width="2.6" height="5.4" rx="1.3"/>
  <rect x="13" y="8.6" width="2.6" height="13" rx="1.3"/>
  <rect x="17.4" y="10.6" width="2.6" height="9" rx="1.3"/>
  <rect x="21.8" y="13.2" width="2.6" height="3.8" rx="1.3"/>`;

function renderAppLogo(size = 18, { mono = false } = {}) {
  if (mono) {
    // Waveform is cut out of the bubble so it works on any button background
    return `
      <svg class="app-logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
        <defs><mask id="eco-logo-mask"><rect width="32" height="32" fill="#fff"/><g fill="#000">${LOGO_WAVE_BARS}</g></mask></defs>
        <path fill="currentColor" mask="url(#eco-logo-mask)" d="${LOGO_BUBBLE_PATH}"/>
      </svg>
    `;
  }
  return `
    <svg class="app-logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="eco-logo-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#3fd0c9"/>
      </linearGradient></defs>
      <path fill="url(#eco-logo-gradient)" d="${LOGO_BUBBLE_PATH}"/>
      <g fill="#ffffff">${LOGO_WAVE_BARS}</g>
    </svg>
  `;
}

function renderTitlebar(state) {
  return `
    <header class="win-titlebar" data-testid="win-titlebar">
      <div class="win-titlebar-left" data-testid="titlebar-brand">
        ${renderAppLogo(18)}
      </div>
      <div class="win-titlebar-controls">
        <button class="win-ctrl-btn" data-action="win-minimize" title="Minimizar">${Icons.minimize}</button>
        <button class="win-ctrl-btn" data-action="win-maximize" title="Maximizar">${Icons.maximize}</button>
        <button class="win-ctrl-btn close" data-action="win-close" title="Fechar">${Icons.close}</button>
      </div>
    </header>
  `;
}

function renderAuthScreen(state) {
  const mode = state.auth.mode || "login";
  const savedAccounts = store.getSavedAccounts();

  return `
    <div class="app-root" data-theme="${escapeHtml(state.settings.theme)}">
      ${renderTitlebar(state)}
      <main class="auth-screen" data-testid="auth-screen">
        <div class="auth-card">
          <div class="auth-left">
            ${
              mode === "register"
                ? `
              <h2 style="font-size:24px;color:var(--header-primary);text-align:center;">Criar uma conta real</h2>
              <form id="auth-register-form" style="display:flex;flex-direction:column;gap:12px;">
                <div class="form-group">
                  <label class="form-label">E-mail *</label>
                  <input class="form-input" name="email" type="email" placeholder="voce@exemplo.com" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Nome de Exibição</label>
                  <input class="form-input" name="displayName" type="text" placeholder="Como os outros verão você" />
                </div>
                <div class="form-group">
                  <label class="form-label">@Username (Identificador Único) *</label>
                  <input class="form-input" name="username" type="text" placeholder="ex: usuario_real" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Senha *</label>
                  <input class="form-input" name="password" type="password" placeholder="Mínimo de 6 caracteres" required />
                </div>
                <div id="auth-error-msg" class="form-error"></div>
                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:4px;">Cadastrar Conta</button>
              </form>
              <div style="font-size:13px;color:var(--text-muted);">
                Já possui uma conta?
                <button style="color:var(--link-color);font-weight:600;" data-action="switch-auth-mode" data-mode="login">Entrar</button>
              </div>
            `
                : `
              <div>
                <h2 style="font-size:24px;color:var(--header-primary);text-align:center;">Boas-vindas de volta!</h2>
                <p style="font-size:14px;color:var(--text-muted);text-align:center;margin-top:4px;">Entre com seu e-mail ou @username cadastrado.</p>
              </div>
              <form id="auth-login-form" style="display:flex;flex-direction:column;gap:14px;">
                <div class="form-group">
                  <label class="form-label">E-mail ou @Username *</label>
                  <input class="form-input" name="email" type="text" autocomplete="username" placeholder="voce@exemplo.com ou @usuario" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Senha *</label>
                  <input class="form-input" name="password" type="password" autocomplete="current-password" required />
                </div>
                <div id="auth-error-msg" class="form-error"></div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Entrar</button>
              </form>
              <div style="font-size:13px;color:var(--text-muted);">
                Precisa de uma conta?
                <button style="color:var(--link-color);font-weight:600;" data-action="switch-auth-mode" data-mode="register">Cadastrar</button>
              </div>
            `
            }
          </div>
          <div class="auth-qr-col">
            <h3 style="font-size:16px;color:var(--header-primary);">Contas neste dispositivo</h3>
            <p style="font-size:12px;color:var(--text-muted);">
              Escolha uma conta salva neste dispositivo. A senha dela será solicitada.
            </p>
            <div style="display:flex;flex-direction:column;gap:6px;width:100%;max-height:190px;overflow-y:auto;">
              ${savedAccounts.length === 0 ? `<div style="font-size:12px;color:var(--text-muted);">Nenhuma conta salva ainda. Entre uma vez e ela aparecerá aqui.</div>` : ""}
              ${savedAccounts
                .map(
                  (u) => `
                <button
                  class="btn btn-secondary"
                  style="width:100%;justify-content:flex-start;height:36px;padding:0 10px;"
                  data-action="quick-switch-user"
                  data-user-id="${u.id}"
                >
                  <span style="font-weight:700;">${escapeHtml(u.displayName)}</span>
                  <span style="font-size:11px;color:var(--text-muted);">@${escapeHtml(u.username)}</span>
                </button>
              `
                )
                .join("")}
            </div>
          </div>
        </div>
      </main>
      ${renderSwitchAccountPrompt()}
    </div>
  `;
}

// Shown instead of the app while app.config.json → requireVerifiedEmail blocks an unconfirmed account
function renderEmailGateScreen(state) {
  const gate = state.auth.emailGate;
  return `
    <div class="app-root" data-theme="${escapeHtml(state.settings.theme)}">
      ${renderTitlebar(state)}
      <main class="auth-screen" data-testid="email-gate-screen">
        <div class="auth-card email-gate-card">
          <div class="auth-left">
            <div style="display:flex;justify-content:center;">${renderAppLogo(48)}</div>
            <div>
              <h2 style="font-size:24px;color:var(--header-primary);text-align:center;">Confirme seu e-mail</h2>
              <p style="font-size:14px;color:var(--text-muted);text-align:center;margin-top:6px;">
                ${
                  gate.sentTo
                    ? `Enviamos um código de 6 dígitos para <strong>${escapeHtml(gate.sentTo)}</strong>.`
                    : "Para acessar o app, confirme o seu endereço de e-mail."
                }
              </p>
            </div>
            <form id="email-gate-form" style="display:flex;flex-direction:column;gap:12px;">
              <div class="form-group">
                <label class="form-label" for="email-gate-code">Código de verificação</label>
                <input class="form-input code-input" id="email-gate-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000" required data-testid="email-gate-code" />
              </div>
              <div id="email-gate-error" class="form-error">${escapeHtml(gate.error || "")}</div>
              <button type="submit" class="btn btn-primary" style="width:100%;" data-testid="email-gate-submit">Confirmar e entrar</button>
            </form>
            ${
              gate.devCode
                ? `<div class="dev-code-note" data-testid="email-gate-dev-code">
                     <strong>Modo desenvolvimento:</strong> nenhum provedor de e-mail configurado, então o código não foi enviado.
                     Use <code>${escapeHtml(gate.devCode)}</code> para testar.
                   </div>`
                : ""
            }
            <div class="btn-row" style="justify-content:space-between;">
              <button type="button" class="link-btn" data-action="email-gate-resend">${gate.sentTo ? "Reenviar código" : "Enviar código"}</button>
              <button type="button" class="link-btn" data-action="logout">Sair</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  `;
}

function renderGuildsRail(state) {
  const totalDmUnreads = state.dms.reduce((acc, d) => acc + (store.isDmMuted(d.id) ? 0 : d.unreadCount || 0), 0);
  const pendingCount = state.friends.filter((f) => f.relation === "incoming").length;
  const homeBadge = totalDmUnreads + pendingCount;

  const guildsHtml = store
    .sortedGuilds()
    .map((g) => {
      const isActive = state.navigation.view === "guild" && state.navigation.activeGuildId === g.id;
      const hasVoice = state.voice.connectedGuildId === g.id;
      const muted = store.isGuildMuted(g.id);
      const classes = [
        "guild-item-wrap",
        isActive ? "active" : "",
        g.unread && !isActive && !muted ? "unread" : "",
        muted ? "muted" : ""
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <div class="${classes}" data-guild-context="${g.id}">
          <div class="guild-pill"></div>
          <button
            class="guild-btn"
            style="${isActive ? `background-color:${g.iconColor};border-radius:16px;` : ""}"
            data-action="select-guild"
            data-guild-id="${g.id}"
            title="${escapeHtml(g.name)}"
          >
            <div class="guild-avatar-inner">${
              g.iconUrl
                ? animatedImageHtml(g.iconUrl, { cls: "guild-icon-img", alt: g.name })
                : escapeHtml(g.shortName)
            }</div>
            ${g.unreadCount > 0 && !isActive ? `<span class="guild-badge" data-testid="guild-unread-badge">${g.unreadCount > 99 ? "99+" : g.unreadCount}</span>` : ""}
            ${hasVoice ? `<span class="guild-voice-badge" title="Conectado em Voz">${Icons.speaker}</span>` : ""}
            ${g.mentions > 0 ? `<span class="guild-badge">${g.mentions}</span>` : ""}
          </button>
        </div>
      `;
    })
    .join("");

  const isHome = state.navigation.view === "home";
  const isDiscovery = state.navigation.view === "discovery";

  return `
    <nav class="guilds-rail" aria-label="Servers" data-testid="guilds-rail">
      <div class="guild-item-wrap ${isHome ? "active" : ""} ${homeBadge > 0 && !isHome ? "unread" : ""}">
        <div class="guild-pill"></div>
        <button class="guild-btn" data-action="select-home" title="Mensagens Diretas e Amigos">
          <div class="guild-avatar-inner home-logo">${renderAppLogo(30, { mono: true })}</div>
          ${homeBadge > 0 ? `<span class="guild-badge">${homeBadge}</span>` : ""}
        </button>
      </div>

      ${state.dms
        .filter((dm) => dm.unreadCount > 0 && state.users[dm.userId] && !store.isDmMuted(dm.id))
        .map((dm) => {
          const u = state.users[dm.userId];
          return `
            <div class="guild-item-wrap unread">
              <div class="guild-pill"></div>
              <button class="guild-btn rail-dm" data-action="open-dm" data-dm-id="${escapeHtml(dm.id)}" title="${escapeHtml(u.displayName)}" data-testid="rail-unread-dm">
                ${renderAvatar(u, "", false, "width:48px;height:48px;min-width:48px;")}
                <span class="guild-badge">${dm.unreadCount > 99 ? "99+" : dm.unreadCount}</span>
              </button>
            </div>`;
        })
        .join("")}

      <div class="guild-separator"></div>

      ${guildsHtml}

      <div class="guild-item-wrap">
        <div class="guild-pill"></div>
        <button class="guild-btn action-green" data-action="open-modal" data-modal="create-server" title="Criar ou Entrar em um Servidor">
          ${Icons.plus}
        </button>
      </div>

      <div class="guild-item-wrap ${isDiscovery ? "active" : ""}">
        <div class="guild-pill"></div>
        <button class="guild-btn action-green" data-action="select-discovery" title="Explorar Servidores">
          ${Icons.compass}
        </button>
      </div>
    </nav>
  `;
}

function renderVoiceAndAccountPanel(state) {
  const me = store.getCurrentUser();
  const voice = state.voice;
  let rtcHtml = "";

  if (voice.connectedChannelId && (voice.connectedGuildId || voice.dmCall)) {
    const g = state.guilds.find((item) => item.id === voice.connectedGuildId);
    const ch = g?.channels.find((item) => item.id === voice.connectedChannelId);
    const dmPeer = voice.dmCall ? state.users[voice.dmCall.peerId] : null;
    const isRinging = voice.dmCall?.status === "ringing";
    const statusLabel = isRinging ? "Chamando..." : voice.dmCall?.status === "waiting" ? "Aguardando resposta..." : `Voz Conectada (${voice.pingMs} ms)`;
    const locationLabel = voice.dmCall
      ? `Chamada com ${escapeHtml(dmPeer?.displayName || "contato")}`
      : `${escapeHtml(ch?.name || "Voz")} / ${escapeHtml(g?.name || "Servidor")}`;
    rtcHtml = `
      <div class="rtc-connected-panel" data-testid="rtc-connected-panel">
        <div class="rtc-top-row">
          <div>
            <div class="rtc-status-title" title="Latência RTC: ${voice.pingMs} ms">
              ${Icons.signal}
              <span>${statusLabel}</span>
            </div>
            ${
              voice.dmCall
                ? `<div class="rtc-channel-sub" data-testid="rtc-channel-sub">${locationLabel}</div>`
                : `<button class="rtc-channel-sub rtc-channel-link" data-action="open-call-view" data-channel-id="${escapeHtml(voice.connectedChannelId)}" title="Abrir o painel da call" data-testid="rtc-channel-sub">${locationLabel}</button>`
            }
          </div>
          <button class="icon-btn danger-active" data-action="leave-voice" title="Desconectar da Chamada" data-testid="leave-voice-btn">
            ${Icons.phoneOff}
          </button>
        </div>
        <div class="rtc-action-grid">
          <button class="rtc-grid-btn ${voice.videoEnabled ? "active" : ""}" data-action="toggle-video" title="Câmera">
            ${Icons.video}
          </button>
          <button
            class="rtc-grid-btn ${voice.screenShareEnabled ? "active" : ""}"
            data-action="toggle-screenshare"
            data-testid="screenshare-toggle-btn"
            title="${voice.screenShareEnabled ? "Parar Compartilhamento de Tela" : "Compartilhar Tela"}"
          >
            ${Icons.screenShare}
          </button>
          <button class="rtc-grid-btn" data-action="preview-join-sound" title="Testar Som de Entrada">
            🔔
          </button>
          <button class="rtc-grid-btn" data-action="open-voice-settings" title="Configurações de Sons de Chamada">
            🔊
          </button>
        </div>
      </div>
    `;
  }

  return `
    ${rtcHtml}
    <div class="account-bar" data-testid="account-bar">
      <div class="account-profile-btn" data-action="toggle-status-menu" data-testid="account-profile-btn" title="Alterar status ou trocar de conta">
        ${renderAvatar(me, "", true, "", { speaking: true })}
        <div class="account-meta">
          <div class="account-name" data-testid="account-display-name">${escapeHtml(me.displayName)}</div>
          <div class="account-sub" data-testid="account-username-sub">@${escapeHtml(me.username)}</div>
        </div>
      </div>
      <div class="account-controls">
        <div class="split-ctrl ${uiState.audioMenu === "input" ? "open" : ""}">
          <button
            class="icon-btn ${voice.muted ? "danger-active" : ""}"
            data-action="toggle-mute"
            title="${voice.muted ? "Ativar Microfone" : "Silenciar Microfone"}"
          >
            ${voice.muted ? Icons.micOff : Icons.mic}
          </button>
          <button class="split-ctrl-arrow" data-action="toggle-audio-menu" data-kind="input" title="Opções de entrada (microfone)" aria-label="Opções de entrada" data-testid="input-device-menu-btn">${Icons.chevronDownSmall}</button>
        </div>
        <div class="split-ctrl ${uiState.audioMenu === "output" ? "open" : ""}">
          <button
            class="icon-btn ${voice.deafened ? "danger-active" : ""}"
            data-action="toggle-deafen"
            title="${voice.deafened ? "Ativar Áudio" : "Desativar Áudio"}"
          >
            ${voice.deafened ? Icons.deafenOff : Icons.headphones}
          </button>
          <button class="split-ctrl-arrow" data-action="toggle-audio-menu" data-kind="output" title="Opções de saída (fone/alto-falantes)" aria-label="Opções de saída" data-testid="output-device-menu-btn">${Icons.chevronDownSmall}</button>
        </div>
        <button
          class="icon-btn"
          data-action="open-user-settings"
          title="Configurações de Usuário"
          data-testid="open-user-settings-btn"
        >
          ${Icons.settings}
        </button>
      </div>
    </div>
  `;
}

function renderSecondarySidebar(state) {
  if (state.navigation.view === "home" || state.navigation.view === "discovery") {
    const sec = state.navigation.homeSection;
    const pendingCount = state.friends.filter((f) => f.relation === "incoming").length;

    const dmsHtml =
      state.dms.length === 0
        ? `<div style="padding:18px 12px;font-size:12px;color:var(--text-muted);text-align:center;" data-testid="empty-dms-state">
            Nenhuma conversa direta ainda.<br/>Adicione um amigo pelo <strong>@username</strong> para conversar.
          </div>`
        : store
            .sortedDms()
            .map((dm) => {
              const u = state.users[dm.userId];
              if (!u) return "";
              const isActive =
                state.navigation.view === "home" && sec === "dm" && state.navigation.activeDmId === dm.id;
              const chat = store.getChatPrefs();
              const pinned = chat.pinnedDms.includes(dm.id);
              const favorite = !pinned && chat.favoriteDms.includes(dm.id);
              const muted = store.isDmMuted(dm.id);
              return `
                <div class="dm-item ${isActive ? "active" : ""} ${muted ? "muted" : ""}" data-action="open-dm" data-dm-id="${dm.id}">
                  ${renderAvatar(u, "", true)}
                  <div class="dm-item-info">
                    <div class="dm-item-name">${escapeHtml(u.displayName)}${pinned ? `<span class="dm-item-mark" title="Fixada">${Icons.pin}</span>` : favorite ? `<span class="dm-item-mark star" title="Favorita">${Icons.star}</span>` : ""}</div>
                    <div class="dm-item-sub">@${escapeHtml(u.username)}</div>
                  </div>
                  ${dm.unreadCount > 0 && !muted ? `<span class="guild-badge" style="position:static;border:none;">${dm.unreadCount}</span>` : ""}
                  <button type="button" class="dm-close-btn" data-action="close-dm" data-dm-id="${escapeHtml(dm.id)}" title="Fechar conversa" aria-label="Fechar conversa com ${escapeHtml(u.displayName)}" data-testid="close-dm-btn">${Icons.close}</button>
                </div>
              `;
            })
            .join("");

    return `
      <aside class="secondary-sidebar" data-testid="secondary-sidebar">
        <div class="sidebar-resizer right" data-sidebar-resizer="channels" title="Arraste para mudar a largura" role="separator" aria-orientation="vertical"></div>
        <div class="sidebar-header" style="cursor:default;">
          <button class="sidebar-search-btn" data-action="open-modal" data-modal="quick-switcher">
            <span>Encontrar ou iniciar conversa</span>
            <span style="font-size:10px;background:var(--bg-channels);padding:2px 4px;border-radius:3px;">Ctrl+K</span>
          </button>
        </div>
        <div class="sidebar-scroller">
          <div class="nav-row ${state.navigation.view === "home" && sec === "friends" ? "active" : ""}" data-action="home-nav" data-section="friends" data-testid="nav-friends-btn">
            ${Icons.friends}
            <span style="flex:1;">Amigos</span>
            ${pendingCount > 0 ? `<span class="guild-badge" style="position:static;border:none;">${pendingCount}</span>` : ""}
          </div>

          <div class="dm-section-header">
            <span>Mensagens Diretas</span>
            <button style="color:inherit;" data-action="friends-tab" data-tab="add" title="Adicionar Amigo">${Icons.plus}</button>
          </div>
          ${dmsHtml}
        </div>
        ${renderVoiceAndAccountPanel(state)}
      </aside>
    `;
  }

  // Guild Channels Sidebar
  const guild = store.getActiveGuild();
  if (!guild) return "";

  const canManageChannels = store.can("MANAGE_CHANNELS", guild);
  const canInvite = store.can("CREATE_INSTANT_INVITE", guild);
  // Right-click on the server: "Ocultar canais silenciados" and "Mostrar todos
  // os canais" (off = only channels with something new, plus the open one and voice)
  const chatPrefs = store.guildPrefs(guild.id);
  const channelVisible = (c) => {
    if (c.id === state.navigation.activeChannelId || c.id === state.voice.connectedChannelId) return true;
    if (chatPrefs.hideMutedChannels && store.isChannelMuted(c.id)) return false;
    if (!chatPrefs.showAllChannels && c.type !== "voice" && !c.unread) return false;
    return true;
  };
  const categoriesHtml = (guild.categories || [])
    .map((cat) => {
      const isCollapsed = Boolean(guild.collapsedCategories?.[cat.id]);
      const catChannels = (guild.channels || []).filter((c) => c.categoryId === cat.id && channelVisible(c));

      const channelsList = isCollapsed
        ? ""
        : catChannels
            .map((ch) => {
              // Gray = the channel on screen. A voice channel only when its call
              // panel is open; being connected while reading another channel
              // just tints its icon.
              const callOnScreen = getCallChannel(state)?.id;
              const isActive = ch.type === "voice" ? callOnScreen === ch.id : state.navigation.activeChannelId === ch.id && !callOnScreen;
              const isVoiceConnected =
                state.voice.connectedGuildId === guild.id && state.voice.connectedChannelId === ch.id;
              const channelSharers = new Set(channelShares(state, ch.id).map((s) => s.userId));
              const icon =
                ch.type === "voice"
                  ? Icons.speaker
                  : ch.type === "announcement"
                    ? Icons.megaphone
                    : Icons.hash;

              const voiceUsersHtml =
                ch.type === "voice" && Array.isArray(ch.connectedUsers) && ch.connectedUsers.length > 0
                  ? `<div class="voice-channel-users">
                      ${ch.connectedUsers
                        .map((uid) => {
                          const u = state.users[uid];
                          if (!u) return "";
                          const isSharing = channelSharers.has(u.id);
                          return `
                            <div class="voice-user-row" data-action="open-user-popout" data-user-id="${u.id}">
                              <div class="voice-user-left">
                                ${renderAvatar(u, "", false, "width:22px;height:22px;min-width:22px;font-size:10px;", { speaking: true })}
                                <span>${escapeHtml(store.memberNickname(guild, u.id) || u.displayName)}</span>
                              </div>
                              <div style="display:flex;align-items:center;gap:4px;">
                                ${isSharing ? `<span class="screenshare-live-badge" style="font-size:9px;padding:1px 4px;">LIVE</span>` : ""}
                                <span style="font-size:11px;color:var(--text-muted);">${uid === state.auth.currentUserId && state.voice.muted ? "🔇" : "🎙️"}</span>
                              </div>
                            </div>
                          `;
                        })
                        .join("")}
                    </div>`
                  : "";

              return `
                <div>
                  <div
                    class="channel-item ${isActive ? "active" : ""} ${isVoiceConnected && !isActive ? "connected" : ""} ${ch.unread && !isActive && !store.isChannelMuted(ch.id) ? "unread" : ""} ${store.isChannelMuted(ch.id) ? "muted" : ""}"
                    data-action="select-channel"
                    data-channel-id="${ch.id}"
                    ${ch.type !== "voice" ? `data-channel-context="${ch.id}"` : ""}
                  >
                    <div class="channel-item-left">
                      <span style="color:var(--channels-default);display:inline-flex;">${icon}</span>
                      <span class="channel-item-name">${escapeHtml(ch.name)}</span>
                    </div>
                    <div class="channel-item-actions">
                      ${
                        canInvite
                          ? `<button
                        class="channel-action-btn"
                        data-action="open-invite-modal"
                        data-channel-id="${ch.id}"
                        title="Criar Convite"
                        aria-label="Criar Convite"
                      >${Icons.userPlus}</button>`
                          : ""
                      }
                      ${
                        canManageChannels
                          ? `<button
                        class="channel-action-btn"
                        data-action="edit-channel"
                        data-channel-id="${ch.id}"
                        title="Editar canal"
                        aria-label="Editar canal"
                        data-testid="edit-channel-btn"
                      >${Icons.edit}</button>`
                          : ""
                      }
                      ${
                        canManageChannels && guild.channels.length > 1
                          ? `<button
                              class="channel-action-btn danger"
                              data-action="delete-channel"
                              data-channel-id="${ch.id}"
                              title="Excluir Canal"
                              aria-label="Excluir Canal"
                            >${Icons.trash}</button>`
                          : ""
                      }
                    </div>
                  </div>
                  ${voiceUsersHtml}
                </div>
              `;
            })
            .join("");

      return `
        <div>
          <div class="channel-category" data-action="toggle-category" data-category-id="${cat.id}">
            <div class="channel-category-left">
              ${isCollapsed ? Icons.chevronRight : Icons.chevronDown}
              <span>${escapeHtml(cat.name)}</span>
            </div>
            ${
              canManageChannels
                ? `<span class="channel-category-actions">
                    <button style="color:inherit;" data-action="edit-category" data-category-id="${cat.id}" title="Renomear categoria" aria-label="Renomear categoria">${Icons.edit}</button>
                    <button style="color:inherit;" data-action="open-create-channel" data-category-id="${cat.id}" title="Criar canal nesta categoria" aria-label="Criar canal">${Icons.plus}</button>
                  </span>`
                : ""
            }
          </div>
          ${channelsList}
        </div>
      `;
    })
    .join("");

  return `
    <aside class="secondary-sidebar" data-testid="secondary-sidebar">
        <div class="sidebar-resizer right" data-sidebar-resizer="channels" title="Arraste para mudar a largura" role="separator" aria-orientation="vertical"></div>
      <div class="server-header ${guild.bannerUrl ? "has-banner" : ""}" data-testid="server-header">
        ${
          guild.bannerUrl
            ? animatedImageHtml(guild.bannerUrl, { cls: "server-header-banner", size: "full", extra: 'data-testid="guild-sidebar-banner"' })
            : ""
        }
        <div class="server-header-bar">
          <button class="server-header-title" data-action="toggle-server-menu" title="Opções do servidor" data-testid="server-header-title">
            ${
              guild.iconUrl
                ? `<img class="server-header-icon" src="${escapeHtml(guild.iconUrl)}" alt="" />`
                : ""
            }
            <span class="server-header-name">${escapeHtml(guild.name)}</span>
            ${Icons.chevronDown}
          </button>
          <button
            class="server-header-btn"
            data-action="open-invite-modal"
            title="Convidar Pessoas"
            aria-label="Convidar Pessoas"
            data-testid="server-invite-btn"
          >${Icons.userPlus}</button>
          <button
            class="server-header-btn"
            data-action="open-server-settings"
            title="Configurações do Servidor"
            aria-label="Configurações do Servidor"
            data-testid="open-server-settings-btn"
          >${Icons.settings}</button>
        </div>
      </div>
      <div class="sidebar-scroller">
        ${categoriesHtml}
      </div>
      ${renderVoiceAndAccountPanel(state)}
    </aside>
  `;
}

// ==========================================================================
// Phase 2 & 10: Friends Stage with Real @username Search & Zero Fake Users
// ==========================================================================
function renderFriendsStage(state) {
  const tab = state.navigation.friendsTab || "online";
  const query = (state.navigation.friendsSearchQuery || "").toLowerCase();

  let bodyHtml = "";
  if (tab === "add") {
    const fb = uiState.friendSearchFeedback;
    const results = uiState.friendSearchResults || [];

    bodyHtml = `
      <div style="padding:24px 28px;overflow-y:auto;flex:1;" data-testid="add-friend-panel">
        <h2 style="font-size:16px;text-transform:uppercase;color:var(--header-primary);margin-bottom:6px;">Adicionar Amigo</h2>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;">
          Busque usuários reais cadastrados pelo <strong>@username</strong> ou envie uma solicitação de amizade diretamente.
        </p>
        <form id="add-friend-form" style="display:flex;gap:12px;background:var(--bg-input);padding:10px 14px;border-radius:8px;border:1px solid var(--border-faint);">
          <input
            type="text"
            id="add-friend-username-input"
            name="username"
            data-testid="add-friend-input"
            placeholder="Digite um @username real (ex: @alex_dev)"
            value="${escapeHtml(uiState.friendSearchQuery)}"
            style="flex:1;font-size:14px;color:var(--text-normal);"
            autocomplete="off"
            required
          />
          <button type="submit" class="btn btn-primary" data-testid="send-friend-request-btn">Enviar Pedido de Amizade</button>
        </form>
        ${
          fb
            ? `<div id="add-friend-feedback" data-testid="add-friend-feedback" style="margin-top:10px;font-size:13px;font-weight:600;color:${fb.ok ? "var(--status-green)" : "var(--status-red)"};">${escapeHtml(fb.msg)}</div>`
            : `<div id="add-friend-feedback" data-testid="add-friend-feedback" style="margin-top:10px;font-size:13px;"></div>`
        }

        <div style="margin-top:20px;">
          <div class="form-label" style="margin-bottom:10px;">Resultados de Usuários Reais no Sistema (${results.length})</div>
          ${
            results.length === 0
              ? `<div class="empty-state-box" style="padding:28px;background:var(--bg-channels);border-radius:8px;">
                  <div>${uiState.friendSearchQuery ? `Nenhum usuário real encontrado para "${escapeHtml(uiState.friendSearchQuery)}".` : "Digite um @username acima para pesquisar usuários reais cadastrados."}</div>
                </div>`
              : `<div style="display:flex;flex-direction:column;gap:8px;" data-testid="friend-search-results">
                  ${results
                    .map((u) => {
                      let actionHtml = `<button class="btn btn-primary" style="height:32px;font-size:12px;" data-action="send-friend-req-id" data-user-id="${u.id}">Adicionar @${escapeHtml(u.username)}</button>`;
                      if (u.relation === "friend") {
                        actionHtml = `<span class="availability-badge ok">✓ Já são amigos</span>`;
                      } else if (u.relation === "outgoing") {
                        actionHtml = `<button class="btn btn-secondary" style="height:32px;font-size:12px;" data-action="cancel-friend-req" data-user-id="${u.id}">Pedido Enviado (Cancelar)</button>`;
                      } else if (u.relation === "incoming") {
                        actionHtml = `<button class="btn btn-success" style="height:32px;font-size:12px;" data-action="accept-friend" data-user-id="${u.id}">Aceitar Pedido</button>`;
                      } else if (u.relation === "blocked") {
                        actionHtml = `<span class="availability-badge err">Bloqueado</span>`;
                      }
                      return `
                        <div class="friend-row" style="background:var(--bg-channels);padding:10px 14px;border:1px solid var(--border-faint);">
                          <div class="friend-row-left">
                            ${renderAvatar(u, "lg", true)}
                            <div>
                              <div style="font-size:15px;font-weight:600;color:var(--header-primary);">${escapeHtml(u.displayName)}</div>
                              <div style="font-size:12px;color:var(--text-muted);">@${escapeHtml(u.username)}</div>
                            </div>
                          </div>
                          <div class="friend-row-actions">
                            ${actionHtml}
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>`
          }
        </div>
      </div>
    `;
  } else {
    const filtered = state.friends.filter((f) => {
      const u = state.users[f.userId];
      if (!u) return false;
      if (query && !u.displayName.toLowerCase().includes(query) && !u.username.toLowerCase().includes(query)) {
        return false;
      }
      if (tab === "online") return f.relation === "friend" && u.status !== "offline";
      if (tab === "all") return f.relation === "friend";
      if (tab === "pending") return f.relation === "incoming" || f.relation === "outgoing";
      if (tab === "blocked") return f.relation === "blocked";
      return true;
    });

    const rowsHtml =
      filtered.length === 0
        ? `<div class="empty-state-box" data-testid="friends-empty-state">
            <div style="font-size:36px;">👥</div>
            <div style="font-size:16px;font-weight:700;color:var(--header-primary);">
              ${tab === "pending" ? "Nenhuma solicitação de amizade pendente" : tab === "blocked" ? "Nenhum usuário bloqueado" : "Nenhum amigo nesta lista ainda"}
            </div>
            <div style="font-size:13px;max-width:380px;">
              O sistema exibe apenas usuários reais cadastrados. Adicione alguém usando o identificador <strong>@username</strong>!
            </div>
            <button class="btn btn-success" data-action="friends-tab" data-tab="add">Adicionar Amigo (@username)</button>
          </div>`
        : filtered
            .map((f) => {
              const u = state.users[f.userId];
              return `
                <div class="friend-row" data-action="open-user-popout" data-user-id="${u.id}" data-testid="friend-row-${u.username}">
                  <div class="friend-row-left">
                    ${renderAvatar(u, "lg", true)}
                    <div>
                      <div style="font-size:15px;font-weight:600;color:var(--header-primary);">
                        ${escapeHtml(u.displayName)}
                        <span style="font-size:12px;color:var(--text-muted);font-weight:400;">@${escapeHtml(u.username)}</span>
                      </div>
                      <div style="font-size:12px;color:var(--text-muted);">
                        ${
                          f.relation === "incoming"
                            ? "Solicitação de Amizade Recebida"
                            : f.relation === "outgoing"
                              ? "Solicitação de Amizade Enviada"
                              : activitySummaryHtml(u.id) || escapeHtml(u.customStatus || u.status)
                        }
                      </div>
                    </div>
                  </div>
                  <div class="friend-row-actions">
                    ${
                      f.relation === "incoming"
                        ? `
                        <button class="circle-action-btn" data-action="accept-friend" data-user-id="${u.id}" title="Aceitar" style="color:var(--status-green);">✓</button>
                        <button class="circle-action-btn" data-action="decline-friend" data-user-id="${u.id}" title="Recusar" style="color:var(--status-red);">✕</button>
                      `
                        : f.relation === "outgoing"
                          ? `<button class="circle-action-btn" data-action="cancel-friend-req" data-user-id="${u.id}" title="Cancelar Pedido" style="color:var(--status-red);">✕</button>`
                          : f.relation === "blocked"
                            ? `<button class="btn btn-secondary" data-action="unblock-friend" data-user-id="${u.id}">Desbloquear</button>`
                            : `
                        <button class="circle-action-btn" data-action="message-friend" data-user-id="${u.id}" title="Enviar Mensagem">
                          ${Icons.thread}
                        </button>
                        <button class="circle-action-btn" data-action="block-friend" data-user-id="${u.id}" title="Bloquear">
                          🚫
                        </button>
                        <button class="circle-action-btn" data-action="remove-friend" data-user-id="${u.id}" title="Desfazer Amizade">
                          ${Icons.trash}
                        </button>
                      `
                    }
                  </div>
                </div>
              `;
            })
            .join("");

    bodyHtml = `
      <div class="friends-main-list">
        <div class="friends-search-bar">
          ${Icons.search}
          <input
            type="text"
            id="friends-search-input"
            placeholder="Filtrar amigos..."
            value="${escapeHtml(state.navigation.friendsSearchQuery || "")}"
          />
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">
          ${escapeHtml(tab)} — ${filtered.length}
        </div>
        ${rowsHtml}
      </div>
    `;
  }

  // Real Active Now sidebar (only real friends who are online)
  // Friends doing something right now (game or Spotify) come first
  const activeRealFriends = state.friends
    .filter((f) => f.relation === "friend")
    .map((f) => state.users[f.userId])
    .filter((u) => u && (u.status !== "offline" || store.getLiveActivity(u.id)))
    .sort((a, b) => Number(Boolean(store.getLiveActivity(b.id))) - Number(Boolean(store.getLiveActivity(a.id))));

  return `
    <section class="main-stage" data-testid="friends-stage">
      <header class="stage-header">
        <div class="stage-header-left">
          <span style="color:var(--text-muted);display:inline-flex;">${Icons.friends}</span>
          <span class="stage-title">Amigos</span>
          <div class="stage-divider"></div>
          <button class="friends-tab-btn ${tab === "online" ? "active" : ""}" data-action="friends-tab" data-tab="online">Disponível</button>
          <button class="friends-tab-btn ${tab === "all" ? "active" : ""}" data-action="friends-tab" data-tab="all">Todos</button>
          <button class="friends-tab-btn ${tab === "pending" ? "active" : ""}" data-action="friends-tab" data-tab="pending">Pendente</button>
          <button class="friends-tab-btn ${tab === "blocked" ? "active" : ""}" data-action="friends-tab" data-tab="blocked">Bloqueados</button>
          <button class="friends-tab-btn add-friend ${tab === "add" ? "active" : ""}" data-action="friends-tab" data-tab="add" data-testid="friends-tab-add">Adicionar Amigo</button>
        </div>
      </header>
      <div class="stage-content-split">
        <div class="chat-column">
          ${bodyHtml}
        </div>
        <aside class="active-now-sidebar" data-testid="active-now-sidebar">
          <h3 style="font-size:18px;font-weight:700;color:var(--header-primary);">Ativos Agora</h3>
          ${
            activeRealFriends.length === 0
              ? `<div style="margin-top:16px;text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">
                  <strong style="display:block;color:var(--header-primary);margin-bottom:4px;">Por enquanto está tudo quieto...</strong>
                  Quando um amigo iniciar uma atividade ou entrar em um canal de voz, ela aparecerá aqui!
                </div>`
              : activeRealFriends
                  .map(
                    (u) => `
                  ${renderActiveNowCard(u)}
                `
                  )
                  .join("")
          }
        </aside>
      </div>
    </section>
  `;
}

// Card in "Ativo agora": who, what (with the app's icon) and for how long
function renderActiveNowCard(u) {
  const live = store.getLiveActivity(u.id);
  const game = live?.game;
  const track = live?.listening;
  const headline = game
    ? `<span>${escapeHtml(game.name)}</span><span data-activity-since="${Number(game.since) || 0}">${escapeHtml(formatPlayTime((Date.now() - game.since) / 1000))}</span>`
    : track
      ? `<span>Ouvindo Spotify</span>`
      : `<span>${escapeHtml(u.customStatus || "Online")}</span>`;
  const icon = game ? gameIconHtml(game, 28) : track ? `<span class="active-now-app">${SPOTIFY_ICON}</span>` : "";
  const detail = game
    ? `<div class="active-now-detail">${gameIconHtml(game, 36)}<div><div class="active-now-detail-title">${escapeHtml(game.name)}</div><div class="active-now-detail-sub">Jogando agora</div></div></div>`
    : track
      ? `<div class="active-now-detail">${
          track.albumArtUrl ? `<img class="activity-album-art small" src="${escapeHtml(track.albumArtUrl)}" alt="" referrerpolicy="no-referrer" />` : `<span class="activity-album-art small placeholder">${SPOTIFY_ICON}</span>`
        }<div><div class="active-now-detail-title">${escapeHtml(track.title)}</div><div class="active-now-detail-sub">${escapeHtml(track.artist)}</div></div></div>`
      : "";
  return `
    <div class="active-now-card" data-action="open-user-popout" data-user-id="${escapeHtml(u.id)}" data-testid="active-now-card">
      <div class="active-now-head">
        ${renderAvatar(u, "", true)}
        <div class="active-now-who">
          <div class="active-now-name">${escapeHtml(u.displayName)}</div>
          <div class="active-now-what">${headline}</div>
        </div>
        ${icon}
      </div>
      ${detail}
    </div>`;
}

function renderDiscoveryStage(state) {
  const search = (state.navigation.discoverySearch || "").toLowerCase();
  const items = (state.discoverableGuilds || []).filter((d) => {
    if (search && !d.name.toLowerCase().includes(search) && !d.description.toLowerCase().includes(search)) return false;
    return true;
  });

  return `
    <section class="main-stage" data-testid="discovery-stage">
      <header class="stage-header">
        <div class="stage-header-left">
          ${Icons.compass}
          <span class="stage-title">Explorar Servidores</span>
        </div>
      </header>
      <div style="flex:1;overflow-y:auto;padding:24px;">
        <div style="background:linear-gradient(135deg,#5865f2 0%,#1e1f22 100%);border-radius:12px;padding:28px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
          <div>
            <h1 style="font-size:24px;color:#fff;margin-bottom:6px;">Servidores públicos</h1>
            <p style="font-size:13px;color:rgba(255,255,255,0.85);">Todos os servidores que os donos deixaram públicos. Para deixar o seu aqui, ative "Servidor público" nas configurações dele.</p>
          </div>
          <button class="btn btn-success" data-action="open-modal" data-modal="create-server">
            Entrar com Código de Convite / Criar Servidor
          </button>
        </div>
        ${
          items.length
            ? ""
            : `<div class="empty-state-box" style="padding:36px 20px;" data-testid="discovery-empty">
                <div style="font-size:14px;font-weight:600;color:var(--header-primary);">${search ? "Nenhum servidor público encontrado para essa busca." : "Ainda não há servidores públicos."}</div>
                <div style="font-size:12px;">Quem cria um servidor pode deixá-lo público nas configurações dele.</div>
              </div>`
        }
        <div class="discovery-grid">
          ${items
            .map((d) => {
              const alreadyJoined = state.guilds.some((g) => g.id === d.id);
              return `
                <div class="discovery-card">
                  <div style="height:76px;background:${escapeHtml(d.bannerColor)};position:relative;">
                    ${d.bannerUrl ? animatedImageHtml(d.bannerUrl, { cls: "discovery-banner-img", alt: "" }) : ""}
                    <div style="position:absolute;bottom:-18px;left:16px;width:44px;height:44px;border-radius:12px;background:${escapeHtml(d.iconColor)};border:4px solid var(--bg-channels);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;overflow:hidden;">
                      ${d.iconUrl ? animatedImageHtml(d.iconUrl, { cls: "discovery-icon-img", alt: d.name }) : escapeHtml(d.shortName)}
                    </div>
                  </div>
                  <div style="padding:26px 16px 16px 16px;flex:1;display:flex;flex-direction:column;gap:8px;">
                    <div style="font-size:16px;font-weight:700;color:var(--header-primary);">${escapeHtml(d.name)}</div>
                    <p style="font-size:13px;color:var(--text-muted);flex:1;">${escapeHtml(d.description)}</p>
                    <div style="font-size:11px;color:var(--text-muted);display:flex;gap:12px;">
                      <span>🟢 ${escapeHtml(d.onlineCount)} Online</span>
                      <span>⚪ ${escapeHtml(d.membersCount)} Membro(s)</span>
                    </div>
                    <button
                      class="btn ${alreadyJoined ? "btn-secondary" : "btn-primary"}"
                      style="margin-top:6px;width:100%;"
                      data-action="join-discoverable"
                      data-disc-id="${d.id}"
                    >
                      ${alreadyJoined ? "Abrir Servidor" : "Entrar no Servidor"}
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

// ==========================================================================
// Phase 9: Live Screen Share Stage & Chat Stage
// ==========================================================================
// A screen share while reading a text channel: a floating window you can
// drag by its header, resize from the corner and close (✕ only stops it for
// you; the person sharing keeps sharing). Closed, a small bar offers "Assistir".
function channelShares(state, channelId) {
  return Object.values(state.screenShares || {}).filter((s) => s.channelId === channelId);
}

// Next time this person shares, it starts visible and audible again
function forgetEndedStreams(state) {
  const live = new Set(Object.values(state.screenShares || {}).map((s) => s.userId));
  if (state.voice.screenShareEnabled) live.add(state.auth.currentUserId);
  for (const userId of Object.keys(uiState.stoppedWatching)) {
    if (!live.has(userId)) setStreamWatched(userId, true);
  }
}

function setStreamWatched(userId, watched) {
  if (watched) delete uiState.stoppedWatching[userId];
  else uiState.stoppedWatching[userId] = true;
  Voice.setStreamAudioMuted(userId, !watched);
}

function renderScreenShareBannerAndStage(state) {
  forgetEndedStreams(state);
  const voiceChannelId = state.voice.connectedChannelId;
  const me = state.auth.currentUserId;
  const inMyCall = voiceChannelId ? channelShares(state, voiceChannelId) : [];
  const candidates = inMyCall.length ? inMyCall : Object.values(state.screenShares || {});
  // Someone else's stream first; my own only as a preview
  const ordered = [...candidates].sort((x, y) => (x.userId === me) - (y.userId === me));
  const activeShare = ordered.find((s) => !uiState.stoppedWatching[s.userId]) || ordered[0] || null;

  if (!activeShare && !state.voice.screenShareEnabled) return "";

  const channelId = activeShare?.channelId || voiceChannelId || "";
  const sharerUser = activeShare ? state.users[activeShare.userId] : store.getCurrentUser();
  const isMeSharing = activeShare ? activeShare.userId === me : state.voice.screenShareEnabled;
  const streamUserId = activeShare?.userId || me;
  const sourceTitle = activeShare?.sourceName || state.voice.screenShareSourceName || "Tela";
  const stats = ScreenShare.getStats ? ScreenShare.getStats() : {};
  const displayFps = stats.requestedFps || activeShare?.fps || 30;
  const displayRes = stats.resolution || activeShare?.resolution || "";

  if (uiState.stoppedWatching[streamUserId]) {
    return `
      <div class="stream-mini-bar" data-testid="screenshare-stage">
        <span class="screenshare-live-badge">AO VIVO</span>
        <span>${escapeHtml(sharerUser?.displayName || "Alguém")} está transmitindo ${escapeHtml(sourceTitle)}</span>
        <button type="button" class="btn btn-primary btn-sm" data-action="watch-stream-popup" data-user-id="${escapeHtml(streamUserId)}">${isMeSharing ? "Mostrar prévia" : "Assistir"}</button>
        ${isMeSharing ? `<button class="btn btn-danger btn-sm" data-action="stop-screenshare" data-testid="stop-screenshare-btn">Parar Transmissão</button>` : ""}
      </div>`;
  }

  const box = uiState.streamPopup;
  const media =
    isMeSharing && ScreenShare.getStream()
      ? `<div class="screenshare-video-slot" data-share-video-slot></div>`
      : activeShare && Voice.getRemoteVideo(activeShare.userId, "screen")
        ? `<div class="screenshare-remote-slot" data-remote-video="${escapeHtml(activeShare.userId)}:screen" data-keep-children data-testid="screenshare-remote-slot"></div>`
        : activeShare && activeShare.channelId !== voiceChannelId
          ? `<div class="stream-popup-note">Entre na call para assistir à transmissão.</div>`
          : `<div class="stream-popup-note">Conectando à transmissão...</div>`;

  return `
    <div class="stream-popup" data-testid="screenshare-stage" data-stream-popup
      style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;">
      <div class="stream-popup-head" data-stream-drag title="Arraste para mover">
        <span class="screenshare-live-badge">AO VIVO</span>
        <span class="stream-popup-title">${escapeHtml(sharerUser?.displayName || "Usuário")} · ${escapeHtml(sourceTitle)}</span>
        <span class="stream-popup-stats" data-testid="stream-stats-overlay">
          <strong data-share-stat="capturedFps">${stats.capturedFps || "—"}</strong>/${escapeHtml(String(displayFps))} FPS ·
          <strong data-share-stat="resolution">${escapeHtml(displayRes || "—")}</strong>
          ${isMeSharing ? ` · enviando <strong data-share-stat="sent">—</strong>` : ""}
        </span>
        ${isMeSharing ? `<button class="btn btn-danger btn-sm" data-action="stop-screenshare" data-testid="stop-screenshare-btn">Parar</button>` : ""}
        <button type="button" class="icon-btn" data-action="stop-watching-stream" data-user-id="${escapeHtml(streamUserId)}" title="${isMeSharing ? "Fechar a prévia (a transmissão continua)" : "Fechar (para de assistir só para você)"}" aria-label="Fechar">${Icons.close}</button>
      </div>
      <div class="stream-popup-body">${media}</div>
      <div class="stream-popup-resize" data-stream-resize title="Arraste para redimensionar"></div>
    </div>
  `;
}

// ==========================================================================
// Attachments, polls and the composer "+" menu (shared by chat and call chat)
// ==========================================================================
function attachmentMediaKind(att) {
  const mime = String(att.mimeType || "");
  const ext = String(att.name || "").split(".").pop().toLowerCase();
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "opus", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return null;
}

function renderAttachment(att) {
  if (!att) return "";
  const url = att.url || att.dataUrl || "";
  const mediaKind = url && !att.isImage ? attachmentMediaKind(att) : null;
  if (mediaKind) {
    const saveBtn = `<button type="button" class="message-file-download-btn" data-action="download-file" data-url="${escapeHtml(url)}" title="Baixar ${escapeHtml(att.name)}" data-testid="attachment-download">${Icons.download}</button>`;
    return `
      <div class="message-attachment-card media ${mediaKind}">
        <div class="message-media-head">
          <span class="message-file-name">${escapeHtml(att.name)}</span>
          <span class="message-file-size">${escapeHtml(att.size || "")}</span>
          ${saveBtn}
        </div>
        ${
          mediaKind === "video"
            ? `<video class="message-media-player" src="${escapeHtml(url)}" controls preload="metadata" playsinline data-testid="attachment-video"></video>`
            : `<audio class="message-media-player" src="${escapeHtml(url)}" controls preload="metadata" data-testid="attachment-audio"></audio>`
        }
      </div>`;
  }
  if (att.isImage && url) {
    return `
      <div class="message-attachment-card image ${att.spoiler ? "spoiler" : ""}">
        <img class="message-attachment-img" src="${escapeHtml(url)}" alt="${escapeHtml(att.name)}" loading="lazy" decoding="async"
          data-action="open-media-viewer" data-url="${escapeHtml(url)}" data-name="${escapeHtml(att.name)}" title="Clique para ampliar" />
        ${att.spoiler ? `<button type="button" class="spoiler-cover" data-action="reveal-spoiler">SPOILER</button>` : ""}
        <button type="button" class="attachment-save-btn" data-action="download-file" data-url="${escapeHtml(url)}" title="Salvar imagem" aria-label="Salvar imagem">${Icons.download}</button>
      </div>`;
  }
  const inner = `
    <span class="message-file-icon">${Icons.file}</span>
    <span class="message-file-meta">
      <span class="message-file-name">${escapeHtml(att.name)}</span>
      <span class="message-file-size">${escapeHtml(att.size || "")}</span>
    </span>
    ${url ? `<span class="message-file-download" title="Baixar">${Icons.download}</span>` : ""}
  `;
  return `<div class="message-attachment-card">${
    url
      ? `<button type="button" class="message-file-box" data-action="download-file" data-url="${escapeHtml(url)}" title="Salvar ${escapeHtml(att.name)}">${inner}</button>`
      : `<div class="message-file-box">${inner}</div>`
  }</div>`;
}

function renderPollCard(m, channelId) {
  const poll = m.poll;
  if (!poll) return "";
  const meId = store.getState().auth.currentUserId;
  const votes = poll.votes || {};
  const total = poll.options.reduce((acc, o) => acc + (votes[o.id]?.length || 0), 0);
  return `
    <div class="poll-card" data-testid="poll-card">
      <div class="poll-question">${escapeHtml(poll.question)}</div>
      <div class="poll-hint">Escolha uma opção${total ? "" : " — seja o primeiro a votar"}</div>
      <div class="poll-options">
        ${poll.options
          .map((o) => {
            const count = votes[o.id]?.length || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const mine = (votes[o.id] || []).includes(meId);
            return `
              <button class="poll-option ${mine ? "mine" : ""}" style="--pct:${pct}%;" data-action="vote-poll" data-channel-id="${escapeHtml(channelId)}" data-message-id="${escapeHtml(m.id)}" data-option-id="${escapeHtml(o.id)}" title="${mine ? "Remover meu voto" : "Votar"}">
                <span class="poll-option-check">${mine ? Icons.check : ""}</span>
                <span class="poll-option-text">${escapeHtml(o.text)}</span>
                <span class="poll-option-count">${count} · ${pct}%</span>
              </button>
            `;
          })
          .join("")}
      </div>
      <div class="poll-footer">${total} ${total === 1 ? "voto" : "votos"}</div>
    </div>
  `;
}

// "+" next to the message box: attach a file or start a poll
function renderComposerPlus(target, channelId) {
  const open = uiState.composerMenu === target;
  const guild = store.getState().guilds.find((g) => g.channels.some((c) => c.id === channelId)) || null;
  const canAttach = store.can("ATTACH_FILES", guild);
  const canPoll = store.can("CREATE_POLLS", guild);
  if (!canAttach && !canPoll) return "";
  const inputId = target === "call" ? "call-chat-file-input" : "composer-file-input";
  return `
    <div class="composer-plus ${open ? "open" : ""}">
      <button type="button" class="icon-btn composer-plus-btn" data-action="toggle-composer-menu" data-target="${target}" title="Anexar arquivo ou criar enquete" aria-label="Mais opções" data-testid="${target}-plus-btn">${Icons.plus}</button>
      ${
        open
          ? `<div class="composer-plus-menu" data-testid="${target}-plus-menu">
              ${canAttach ? `<label class="composer-plus-item" for="${inputId}">
                ${Icons.upload}<span>Enviar arquivo</span>
              </label>
              <button type="button" class="composer-plus-item" data-action="open-gif-picker" data-target="${target}" data-testid="${target}-gif-menu-btn">
                ${Icons.sparkles}<span>Enviar GIF animado</span>
              </button>` : ""}
              ${canPoll ? `<button type="button" class="composer-plus-item" data-action="open-poll-modal" data-channel-id="${escapeHtml(channelId)}" data-testid="${target}-create-poll-btn">
                ${Icons.poll}<span>Criar enquete</span>
              </button>` : ""}
            </div>`
          : ""
      }
      <input type="file" id="${inputId}" style="display:none;" />
    </div>
  `;
}

// The file waiting in the message box: preview, edit (name / spoiler), remove.
// It is only sent with the message, so text can be written with it.
function renderStagedAttachmentBanner(att, clearAction) {
  if (!att) return "";
  const target = clearAction === "clear-call-attachment" ? "call" : "chat";
  return `
    <div class="staged-attachment" data-testid="staged-attachment">
      <div class="staged-attachment-preview ${att.spoiler ? "spoiler" : ""}">
        ${att.isImage ? `<img src="${escapeHtml(att.url)}" alt="" />` : `<span class="staged-attachment-file">${Icons.file}</span>`}
        ${att.spoiler ? `<span class="staged-spoiler-tag">SPOILER</span>` : ""}
      </div>
      <div class="staged-attachment-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}<span>${escapeHtml(att.size || "")}</span></div>
      <div class="staged-attachment-actions">
        <button type="button" data-action="edit-staged-attachment" data-target="${target}" title="Editar anexo" aria-label="Editar anexo">${Icons.edit}</button>
        <button type="button" class="danger" data-action="${clearAction}" title="Remover anexo" aria-label="Remover anexo">${Icons.trash}</button>
      </div>
    </div>
  `;
}

// Full-size image with Salvar / Abrir no navegador
function renderMediaViewer() {
  const v = uiState.mediaViewer;
  if (!v) return "";
  return `
    <div class="media-viewer" data-action="close-media-viewer" data-testid="media-viewer">
      <img src="${escapeHtml(v.url)}" alt="${escapeHtml(v.name || "")}" data-media-viewer-img />
      <div class="media-viewer-bar">
        <span class="media-viewer-name">${escapeHtml(v.name || "")}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-action="download-file" data-url="${escapeHtml(v.url)}">${Icons.download}<span>Salvar</span></button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="open-link" data-url="${escapeHtml(v.url)}">Abrir no navegador</button>
        <button type="button" class="icon-btn" data-action="close-media-viewer" title="Fechar" aria-label="Fechar">${Icons.close}</button>
      </div>
    </div>
  `;
}

// ==========================================================================
// Call panel: who is in the voice channel, screen shares, controls & call chat
// ==========================================================================
const CALL_CHAT_MIN_WIDTH = 260;
const CALL_CHAT_MAX_WIDTH = 640;

function getCallChannel(state) {
  const chId = state.navigation.callViewChannelId;
  if (!chId || state.voice.connectedChannelId !== chId || state.navigation.view !== "guild") return null;
  const guild = state.guilds.find((g) => g.id === state.voice.connectedGuildId);
  return guild?.channels.find((c) => c.id === chId) || null;
}

function renderCallTile(state, ch, userId, { focused = false, small = false, noStream = false } = {}) {
  const user = state.users[userId] || { id: userId, displayName: "Usuário", avatarColor: "#5865f2" };
  const isMe = userId === state.auth.currentUserId;
  const participant = (ch.voiceParticipants || []).find((p) => p.userId === userId);
  const muted = isMe ? state.voice.muted : Boolean(participant?.muted);
  const deafened = isMe ? state.voice.deafened : Boolean(participant?.deafened);
  const speaking = Boolean(state.voice.speakingUsers?.[userId]) && !muted;
  const isSharing = isMe ? state.voice.screenShareEnabled : channelShares(state, ch.id).some((s) => s.userId === userId);
  // "Desativar vídeo" from the right-click menu: this person's video stays off here
  const videoHidden = !isMe && store.getUserAudioPrefs().videoHidden.includes(userId);
  const watching = !noStream && !videoHidden && isSharing && !uiState.stoppedWatching[userId];
  const cameraOn = !videoHidden && (isMe ? state.voice.videoEnabled : Boolean(participant?.videoEnabled));

  let media;
  if (watching && isMe && ScreenShare.getStream()) {
    media = `<div class="screenshare-video-slot call-tile-stream" data-share-video-slot></div>`;
  } else if (watching && !isMe && Voice.getRemoteVideo(userId, "screen")) {
    media = `<div class="call-tile-stream" data-remote-video="${escapeHtml(userId)}:screen" data-keep-children data-testid="screenshare-remote-slot"></div>`;
  } else if (watching) {
    media = `<div class="call-tile-waiting">Carregando a transmissão...</div>`;
  } else if (cameraOn && (isMe ? Camera.getPreviewElement() : Voice.getRemoteVideo(userId, "camera"))) {
    media = isMe
      ? `<div class="call-tile-stream camera" data-local-camera data-keep-children></div>`
      : `<div class="call-tile-stream camera" data-remote-video="${escapeHtml(userId)}:camera" data-keep-children></div>`;
  } else {
    // Speaking shows as the tile's green frame; the avatar itself stays plain here
    media = `<div class="call-tile-avatar">${renderAvatar(user, "", false, small ? "width:48px;height:48px;min-width:48px;font-size:18px;" : "width:84px;height:84px;min-width:84px;font-size:30px;", { speaking: false })}</div>`;
  }

  const shareControls = isSharing && !noStream
    ? isMe
      ? `<button class="call-tile-action danger" data-action="stop-screenshare" data-testid="call-stop-share-btn">Parar de compartilhar</button>`
      : watching
        ? `<button class="call-tile-action" data-action="stop-watching-stream" data-user-id="${escapeHtml(userId)}" data-testid="call-stop-watching-btn">Parar de assistir</button>`
        : `<button class="call-tile-action primary" data-action="watch-stream" data-user-id="${escapeHtml(userId)}" data-testid="call-watch-btn">Assistir transmissão</button>`
    : "";

  return `
    <div
      class="call-tile ${watching || (cameraOn && !media.includes("call-tile-avatar")) ? "has-stream" : ""} ${focused && watching ? "fit-stream" : ""} ${speaking ? "speaking" : ""} ${focused ? "focused" : ""} ${small ? "small" : ""}"
      style="${user.callTileColor ? `--tile-bg:${escapeHtml(user.callTileColor)};` : `--tile-color:${escapeHtml(user.avatarColor || "#5865f2")};`}${focused && watching ? `--stream-ar:${Number(uiState.streamAspect[userId]) || 16 / 9};` : ""}"
      data-action="focus-call-tile"
      data-user-id="${escapeHtml(userId)}"
      data-testid="call-tile"
      title="${focused ? "Voltar para a grade" : "Ampliar"}"
    >
      ${media}
      ${isSharing && !noStream ? `<span class="call-tile-live">AO VIVO</span>` : ""}
      <div class="call-tile-footer">
        <span class="call-tile-name">${escapeHtml(user.displayName)}</span>
        ${deafened ? `<span class="call-tile-state" title="Áudio desativado">${Icons.deafenOff}</span>` : muted ? `<span class="call-tile-state" title="Microfone silenciado">${Icons.micOff}</span>` : ""}
      </div>
      ${
        shareControls || focused
          ? `<div class="call-tile-actions">${shareControls}${
              focused
                ? `<button class="call-tile-action" data-action="call-show-grid" title="Voltar para a grade" data-testid="call-show-grid-btn">${Icons.grid}<span>Ver todos</span></button>`
                : ""
            }</div>`
          : ""
      }
    </div>
  `;
}

// "Fulano está digitando..." under a chat box
function renderTypingIndicator(channelId) {
  const users = store.getTypingUsers(channelId);
  if (!users.length) return `<div class="typing-indicator" data-testid="typing-indicator"></div>`;
  const names = users.map((u) => `<strong>${escapeHtml(u.displayName)}</strong>`);
  const text =
    names.length === 1
      ? `${names[0]} está digitando...`
      : names.length <= 3
        ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]} estão digitando...`
        : "Várias pessoas estão digitando...";
  return `<div class="typing-indicator active" data-testid="typing-indicator"><span class="typing-dots"><i></i><i></i><i></i></span><span>${text}</span></div>`;
}

// Does this message mention me (@my_username, @everyone/@all/@todos, or one of my roles)?
function mentionsMe(content) {
  if (!content) return false;
  const guild = store.getActiveGuild();
  return store.messageMentionsMe(content, guild, {});
}

const FULLSCREEN_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
const FULLSCREEN_EXIT_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`;

// Edit, reactions, reply and delete work here as in the regular chat
// Message times in the viewer's clock: "Hoje às 21:05", "Ontem às 09:12",
// "03/11/2026 18:40". Messages from older servers only carry a ready label.
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function clockTime(d) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function messageTime(m) {
  if (!m.createdAt) return String(m.timestamp || "").replace("Today at ", "Hoje às ");
  const d = new Date(m.createdAt);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return `Hoje às ${clockTime(d)}`;
  if (sameDay(d, yesterday)) return `Ontem às ${clockTime(d)}`;
  return `${d.toLocaleDateString("pt-BR")} ${clockTime(d)}`;
}
function messageClock(m) {
  return m.createdAt ? clockTime(new Date(m.createdAt)) : String(m.timestamp || "").replace("Today at ", "");
}
function messageDayKey(m) {
  if (!m?.createdAt) return null;
  const d = new Date(m.createdAt);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
// A line with the date where the day changes, so each day's messages stand apart
function dateDivider(m, prev) {
  const key = messageDayKey(m);
  if (!key || key === messageDayKey(prev)) return "";
  const d = new Date(m.createdAt);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const label = sameDay(d, now)
    ? "Hoje"
    : sameDay(d, yesterday)
      ? "Ontem"
      : d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `<div class="message-date-divider" role="separator" data-key="day-${key}"><span>${escapeHtml(label)}</span></div>`;
}

function renderCallChatTools(state, ch, m) {
  const guild = state.guilds.find((g) => (g.channels || []).some((c) => c.id === ch.id)) || null;
  const mine = m.authorId === state.auth.currentUserId;
  const canManage = Boolean(guild) && store.can("MANAGE_MESSAGES", guild);
  const canDelete = store.canDeleteMessage(ch.id, m);
  const button = (action, title, icon, extra = "", cls = "") =>
    `<button class="toolbar-btn ${cls}" data-action="${action}" data-message-id="${m.id}" title="${title}" ${extra}>${icon}</button>`;
  return `
    <div class="message-toolbar">
      ${
        store.can("ADD_REACTIONS", guild)
          ? button("toggle-reaction", "Curtir", "👍", `data-emoji="👍"`) + button("open-emoji-picker", "Adicionar Reação", Icons.smile)
          : ""
      }
      ${store.can("SEND_MESSAGES", guild) ? button("reply-message", "Responder", Icons.reply) : ""}
      ${store.can("PIN_MESSAGES", guild) || canManage ? button("pin-message", m.pinned ? "Desafixar" : "Fixar", Icons.pin) : ""}
      ${mine ? button("start-edit-message", "Editar", Icons.edit) : ""}
      ${canDelete ? button("delete-message", "Excluir", Icons.trash, "", "danger") : ""}
    </div>`;
}

function renderCallChatPanel(state, ch) {
  const messages = state.messages[ch.id] || [];
  const listHtml =
    messages.length === 0
      ? `<div class="call-chat-empty">Nenhuma mensagem nesta call ainda.<br />O que for enviado aqui fica só no chat da call.</div>`
      : messages
          .map((m, idx) => {
            const author = state.users[m.authorId] || { id: m.authorId, displayName: "Usuário", avatarColor: "#5865f2" };
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const divider = dateDivider(m, prevMsg);
            const grouped = Boolean(prevMsg) && !divider && prevMsg.authorId === m.authorId && !m.replyToId;
            const replyTarget = m.replyToId ? messages.find((item) => item.id === m.replyToId) : null;
            const replyPreviewText = replyTarget
              ? replyTarget.content || (replyTarget.attachment ? `📎 ${replyTarget.attachment.name || "GIF/Anexo"}` : "Mensagem")
              : "Mensagem original";
            const replyHtml = m.replyToId
              ? `<div class="message-reply-preview" data-action="jump-to-message" data-target-id="${escapeHtml(m.replyToId)}" title="Ir para a mensagem respondida"><span>↱</span><strong style="color:var(--header-primary);">@${escapeHtml(state.users[replyTarget?.authorId]?.username || "user")}</strong><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(replyPreviewText)}</span></div>`
              : "";
            const reactionsHtml = (m.reactions || []).length
              ? `<div class="message-reactions">${m.reactions
                  .map((r) => `<button class="reaction-pill ${r.me ? "me" : ""}" data-action="toggle-reaction" data-message-id="${m.id}" data-emoji="${r.emoji}"><span>${r.emoji}</span><span>${r.count}</span></button>`)
                  .join("")}</div>`
              : "";
            const textHtml =
              uiState.editingMessageId === m.id
                ? `<div style="margin-top:4px;">
                    <input type="text" id="edit-message-input-${m.id}" class="form-input" style="width:100%;" value="${escapeHtml(m.content)}" data-edit-id="${m.id}" />
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                      ESC para <button style="color:var(--link-color);" data-action="cancel-edit">cancelar</button> •
                      ENTER para <button style="color:var(--link-color);" data-action="save-edit" data-message-id="${m.id}">salvar</button>
                    </div>
                  </div>`
                : `<div class="message-text">${formatMessageMarkdown(m.content)}${m.edited ? `<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">(editado)</span>` : ""}${m.pinned ? `<span style="font-size:10px;color:var(--status-yellow);margin-left:4px;">📌</span>` : ""}</div>`;
            const attachment = renderAttachment(m.attachment) + renderPollCard(m, ch.id);
            return `${divider}
              <div class="call-chat-msg ${grouped ? "grouped" : ""} ${mentionsMe(m.content) ? "mentioned" : ""} ${uiState.highlightedMessageId === m.id ? "reply-jump-highlight" : ""} ${m.pending ? "pending" : ""}" data-message-id="${m.id}">
                ${grouped ? "" : `<div data-action="open-user-popout" data-user-id="${author.id}" style="cursor:pointer;">${renderAvatar(author)}</div>`}
                <div class="call-chat-msg-body">
                  ${
                    grouped
                      ? ""
                      : `<div class="call-chat-msg-head"><span class="message-author" data-action="open-user-popout" data-user-id="${author.id}">${escapeHtml(author.displayName)}</span><span class="message-timestamp">${escapeHtml(messageTime(m))}</span></div>`
                  }
                  ${replyHtml}
                  ${textHtml}
                  ${attachment}
                  ${reactionsHtml}
                </div>
                ${renderCallChatTools(state, ch, m)}
              </div>
            `;
          })
          .join("");

  return `
    <aside class="call-chat" data-testid="call-chat-panel">
      <div class="call-chat-resizer" data-call-chat-resizer title="Arraste para redimensionar" role="separator" aria-orientation="vertical"></div>
      <div class="call-chat-header">
        ${Icons.chat}
        <span class="call-chat-title">${escapeHtml(ch.name)}</span>
        <button class="icon-btn" data-action="toggle-call-chat" title="Fechar chat" aria-label="Fechar chat" data-testid="close-call-chat-btn">${Icons.close}</button>
      </div>
      <div class="call-chat-messages" id="call-chat-scroller">${listHtml}</div>
      <div class="call-chat-composer">
        ${renderStagedAttachmentBanner(uiState.callStagedAttachment, "clear-call-attachment")}
        ${
          uiState.callReplyToId && messages.some((m) => m.id === uiState.callReplyToId)
            ? `<div class="call-chat-replying"><span>Respondendo a <strong>@${escapeHtml(state.users[messages.find((m) => m.id === uiState.callReplyToId).authorId]?.username || "user")}</strong></span><button type="button" class="icon-btn" data-action="cancel-call-reply" title="Cancelar">${Icons.close}</button></div>`
            : ""
        }
        <form class="call-chat-box" id="call-chat-form" data-channel-id="${escapeHtml(ch.id)}">
          ${renderComposerPlus("call", ch.id)}
          <input class="call-chat-input" name="message" autocomplete="off" placeholder="Conversar em ${escapeHtml(ch.name)}" data-testid="call-chat-input" />
          <button type="button" class="composer-gif-btn" data-action="open-gif-picker" data-target="call" title="Enviar GIF">GIF</button>
          <button type="button" class="icon-btn" data-action="open-emoji-picker" data-message-id="call-composer" title="Escolher Emoji">${Icons.smile}</button>
        </form>
        ${renderTypingIndicator(ch.id)}
      </div>
    </aside>
  `;
}

// Who gets a tile in the grid: everyone, or (with "Mostrar participantes sem
// vídeo" off) only people with camera/screen on — but never an empty grid
function gridIds(state, ch, participants) {
  if (uiState.showNonVideoTiles !== false) return participants;
  const hidden = new Set(store.getUserAudioPrefs().videoHidden);
  const sharers = new Set(channelShares(state, ch.id).map((s) => s.userId));
  const withVideo = participants.filter((id) => {
    if (hidden.has(id)) return false;
    if (id === state.auth.currentUserId) return state.voice.videoEnabled || state.voice.screenShareEnabled;
    const p = (ch.voiceParticipants || []).find((x) => x.userId === id);
    return Boolean(p?.videoEnabled) || sharers.has(id);
  });
  return withVideo.length ? withVideo : participants;
}

// Sizes the call grid like Discord: 16:9 tiles as big as the stage allows,
// packed together with a small gap, rows centred (the last one too)
const CALL_GRID_GAP = 8;
let callGridObserver = null;

function layoutCallGrid() {
  const grid = document.querySelector("[data-call-grid]");
  if (!grid) {
    callGridObserver?.disconnect();
    callGridObserver = null;
    return;
  }
  const fit = () => {
    const n = grid.children.length;
    const W = grid.clientWidth;
    const H = grid.clientHeight;
    if (!n || !W || !H) return;
    let best = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - (cols - 1) * CALL_GRID_GAP) / cols, ((H - (rows - 1) * CALL_GRID_GAP) / rows) * (16 / 9));
      if (w > best) best = w;
    }
    grid.style.setProperty("--tile-w", `${Math.floor(best)}px`);
  };
  fit();
  callGridObserver?.disconnect();
  callGridObserver = new ResizeObserver(fit);
  callGridObserver.observe(grid);
}

function renderCallStage(state, ch) {
  const participants = (ch.connectedUsers || []).length ? ch.connectedUsers : [state.auth.currentUserId];
  // A screen share fills the stage on its own; clicking the big tile (or "Ver
  // todos") goes back to the grid, where the share shows as a smaller tile.
  // callFocusUserId: undefined = automatic, null = grid chosen, id = that tile.
  forgetEndedStreams(state);
  const me = state.auth.currentUserId;
  const sharerIds = channelShares(state, ch.id).map((s) => s.userId).filter((id) => id !== me);
  if (state.voice.screenShareEnabled) sharerIds.push(me);
  const autoFocus = uiState.callFocusUserId === undefined ? sharerIds.find((id) => !uiState.stoppedWatching[id]) || null : null;
  const wanted = uiState.callFocusUserId === undefined ? autoFocus : uiState.callFocusUserId;
  const focusId = participants.includes(wanted) ? wanted : null;
  const focusIsStream = focusId && sharerIds.includes(focusId) && !uiState.stoppedWatching[focusId];
  // While a stream fills the stage, the sharer's own card stays in the strip too
  const stripIds = focusIsStream ? participants : participants.filter((id) => id !== focusId);
  const chatOpen = uiState.callChatOpen;

  const stripHidden = uiState.callStripHidden;
  const tilesHtml = focusId
    ? `
      <div class="call-focus">${renderCallTile(state, ch, focusId, { focused: true })}</div>
      ${
        stripIds.length
          ? `<button type="button" class="call-strip-toggle ${stripHidden ? "collapsed" : ""}" data-action="toggle-call-strip" title="${stripHidden ? "Mostrar os participantes" : "Esconder os participantes e ampliar"}" aria-label="${stripHidden ? "Mostrar os participantes" : "Esconder os participantes"}" data-testid="call-strip-toggle">${Icons.chevronDown}</button>
             ${stripHidden ? "" : `<div class="call-strip">${stripIds.map((id) => renderCallTile(state, ch, id, { small: true, noStream: focusIsStream && id === focusId })).join("")}</div>`}`
          : ""
      }
    `
    : `<div class="call-grid" data-call-grid>${gridIds(state, ch, participants).map((id) => renderCallTile(state, ch, id)).join("")}</div>`;

  const v = state.voice;
  return `
    <section class="main-stage call-stage" data-testid="call-stage" style="--call-chat-width:${uiState.callChatWidth}px;">
      <div class="call-main">
        <header class="call-header">
          <span class="call-header-icon">${Icons.speaker}</span>
          <span class="call-header-name">${escapeHtml(ch.name)}</span>
          <span class="call-header-count">${participants.length} na call</span>
          <div style="flex:1;"></div>
          <button class="icon-btn ${chatOpen ? "active" : ""}" data-action="toggle-call-chat" title="${chatOpen ? "Fechar chat da call" : "Abrir chat da call"}" data-testid="toggle-call-chat-btn">${Icons.chat}</button>
        </header>
        <div class="call-body">${tilesHtml}</div>
        <div class="call-controls">
          <div class="call-controls-group">
            <button class="call-ctrl ${v.muted ? "danger" : ""}" data-action="toggle-mute" title="${v.muted ? "Ativar microfone" : "Silenciar microfone"}">${v.muted ? Icons.micOff : Icons.mic}</button>
            <button class="call-ctrl ${v.deafened ? "danger" : ""}" data-action="toggle-deafen" title="${v.deafened ? "Ativar áudio" : "Desativar áudio"}">${v.deafened ? Icons.deafenOff : Icons.headphones}</button>
          </div>
          <div class="call-controls-group">
            ${
              store.can("STREAM_VIDEO", store.getState().guilds.find((g) => g.id === v.connectedGuildId) || null)
                ? `<button class="call-ctrl ${v.videoEnabled ? "active" : ""}" data-action="toggle-video" title="Câmera">${Icons.video}</button>
            <button class="call-ctrl ${v.screenShareEnabled ? "active" : ""}" data-action="toggle-screenshare" title="${v.screenShareEnabled ? "Parar de compartilhar a tela" : "Compartilhar a tela"}" data-testid="call-screenshare-btn">${Icons.screenShare}</button>`
                : ""
            }
          </div>
          <div class="call-controls-group">
            <label class="call-volume" title="Volume da call">
              ${Icons.headphones}
              <input type="range" min="0" max="100" step="1" value="${Number(state.settings.voiceOutputVolume ?? 100)}" data-call-volume aria-label="Volume da call" data-testid="call-volume" />
            </label>
            <button class="call-ctrl" data-action="toggle-call-fullscreen" title="${document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia"}" data-testid="call-fullscreen-btn">${document.fullscreenElement ? FULLSCREEN_EXIT_ICON : FULLSCREEN_ICON}</button>
          </div>
          <button class="call-ctrl leave" data-action="leave-voice" title="Sair da call" data-testid="call-leave-btn">${Icons.phoneOff}</button>
        </div>
      </div>
      ${chatOpen ? renderCallChatPanel(state, ch) : ""}
    </section>
  `;
}

// The call above a DM conversation (like Discord): both people side by side,
// the one being called pulsing with a soft white aura while it rings, and the
// controls under them. Also shows when the other person is waiting in the call
// for me (with "Entrar na chamada").
function renderDmCallPanel(state, channel) {
  const v = state.voice;
  const dm = state.dms.find((d) => d.id === channel.id);
  const peer = dm && state.users[dm.userId];
  const me = store.getCurrentUser();
  if (!peer || !me) return "";
  const inCall = v.connectedChannelId === channel.id && Boolean(v.dmCall);
  const peerWaiting = !inCall && store.roomUserIds(channel.id).includes(peer.id);
  if (!inCall && !peerWaiting) return "";

  const status = inCall ? v.dmCall.status : "incoming";
  const peerHere = inCall ? status === "connected" : true;
  const meHere = inCall;
  const person = (u, here, { calling = false } = {}) => `
    <div class="dm-call-person ${here ? "" : "absent"} ${calling ? "calling" : ""} ${state.voice.speakingUsers?.[u.id] && here ? "speaking" : ""}" data-user-id="${escapeHtml(u.id)}" title="${escapeHtml(u.displayName)}">
      <div class="dm-call-aura"></div>
      ${renderAvatar(u, "", false, "width:80px;height:80px;min-width:80px;font-size:28px;")}
    </div>`;

  const statusText =
    status === "ringing"
      ? `Chamando ${escapeHtml(peer.displayName)}...`
      : status === "waiting"
        ? `${escapeHtml(peer.displayName)} não atendeu. Esperando na chamada — desliga sozinha em <span id="dm-call-countdown">3:00</span>`
        : status === "incoming"
          ? state.incomingCall?.channelId === channel.id
            ? `${escapeHtml(peer.displayName)} está te chamando`
            : `${escapeHtml(peer.displayName)} está esperando você na chamada`
          : "";

  const controls = inCall
    ? `
      <div class="call-controls dm-call-controls">
        <div class="call-controls-group">
          <button class="call-ctrl ${v.muted ? "danger" : ""}" data-action="toggle-mute" title="${v.muted ? "Ativar microfone" : "Silenciar microfone"}" data-testid="dm-call-mute-btn">${v.muted ? Icons.micOff : Icons.mic}</button>
          <button class="call-ctrl dm-call-arrow" data-action="toggle-audio-menu" data-kind="input" title="Opções de entrada (microfone)">${Icons.chevronDownSmall}</button>
          <button class="call-ctrl ${v.videoEnabled ? "active" : ""}" data-action="toggle-video" title="Câmera">${Icons.video}</button>
        </div>
        <div class="call-controls-group">
          <button class="call-ctrl ${v.screenShareEnabled ? "active" : ""}" data-action="toggle-screenshare" title="${v.screenShareEnabled ? "Parar de compartilhar a tela" : "Compartilhar a tela"}">${Icons.screenShare}</button>
          <button class="call-ctrl ${v.deafened ? "danger" : ""}" data-action="toggle-deafen" title="${v.deafened ? "Ativar áudio" : "Desativar áudio"}">${v.deafened ? Icons.deafenOff : Icons.headphones}</button>
        </div>
        <button class="call-ctrl leave" data-action="leave-voice" title="${status === "connected" ? "Desligar" : "Cancelar chamada"}" data-testid="dm-call-hangup-btn">${Icons.phoneOff}</button>
      </div>`
    : `
      <div class="call-controls dm-call-controls">
        <button class="btn btn-success dm-call-join" data-action="start-dm-call" data-channel-id="${escapeHtml(channel.id)}" data-testid="dm-call-join-btn">${Icons.phone}<span>Entrar na chamada</span></button>
      </div>`;

  const collapsed = uiState.dmCallCollapsed;
  const toggle = `<button type="button" class="dm-call-collapse" data-action="toggle-dm-call-panel" title="${collapsed ? "Abrir a chamada" : "Recolher a chamada"}" aria-label="${collapsed ? "Abrir a chamada" : "Recolher a chamada"}" aria-expanded="${collapsed ? "false" : "true"}" data-testid="dm-call-collapse-btn">${Icons.chevronDown}</button>`;

  // Collapsed: one slim bar with the people, the status and hang up / join
  if (collapsed) {
    return `
      <div class="dm-call-panel collapsed" data-testid="dm-call-panel" data-status="${status}">
        <div class="dm-call-mini-people">
          ${person(me, meHere)}
          ${person(peer, peerHere, { calling: status === "ringing" || status === "waiting" })}
        </div>
        <div class="dm-call-status" data-testid="dm-call-status">${statusText || `Em chamada com ${escapeHtml(peer.displayName)}`}</div>
        <div style="flex:1;"></div>
        ${
          inCall
            ? `<button class="call-ctrl ${v.muted ? "danger" : ""}" data-action="toggle-mute" title="${v.muted ? "Ativar microfone" : "Silenciar microfone"}">${v.muted ? Icons.micOff : Icons.mic}</button>
               <button class="call-ctrl leave small" data-action="leave-voice" title="${status === "connected" ? "Desligar" : "Cancelar chamada"}" data-testid="dm-call-hangup-btn">${Icons.phoneOff}</button>`
            : `<button class="btn btn-success btn-sm dm-call-join" data-action="start-dm-call" data-channel-id="${escapeHtml(channel.id)}" data-testid="dm-call-join-btn">${Icons.phone}<span>Entrar</span></button>`
        }
        ${toggle}
      </div>
    `;
  }

  return `
    <div class="dm-call-panel" data-testid="dm-call-panel" data-status="${status}" style="height:${uiState.dmCallHeight}px;">
      ${toggle}
      <div class="dm-call-people">
        ${person(me, meHere)}
        ${person(peer, peerHere, { calling: status === "ringing" || status === "waiting" })}
      </div>
      ${statusText ? `<div class="dm-call-status" data-testid="dm-call-status">${statusText}</div>` : ""}
      ${controls}
      <div class="dm-call-resizer" data-dm-call-resizer title="Arraste para mudar a altura" role="separator" aria-orientation="horizontal" data-testid="dm-call-resizer"></div>
    </div>
  `;
}

function renderChatStage(state) {
  const channel = store.getActiveChannel();
  if (!channel) {
    return `
      <section class="main-stage" data-testid="chat-stage-empty">
        <div class="empty-state-box" style="flex:1;">
          <div style="font-size:36px;">💬</div>
          <div style="font-size:16px;font-weight:700;color:var(--header-primary);">Nenhum canal selecionado</div>
          <div style="font-size:13px;">Selecione um servidor na barra lateral ou adicione um amigo para conversar.</div>
        </div>
      </section>
    `;
  }
  const isDm = channel.type === "dm";
  const allMessages = state.messages[channel.id] || [];
  // What I can do here (DMs: everything)
  const chatGuild = isDm ? null : store.getActiveGuild();
  const perms = {
    send: store.can("SEND_MESSAGES", chatGuild),
    react: store.can("ADD_REACTIONS", chatGuild),
    pin: store.can("PIN_MESSAGES", chatGuild) || (Boolean(chatGuild) && store.can("MANAGE_MESSAGES", chatGuild)),
    manageMessages: Boolean(chatGuild) && store.can("MANAGE_MESSAGES", chatGuild)
  };
  const searchQuery = (state.navigation.searchQuery || "").trim().toLowerCase();
  const pinnedList = allMessages.filter((m) => m.pinned);

  const visibleMessages = searchQuery
    ? allMessages.filter((m) => {
        const author = state.users[m.authorId];
        if (searchQuery === "has:pin") return m.pinned;
        if (searchQuery.startsWith("from:")) {
          const target = searchQuery.slice(5).trim();
          return (
            author?.username.toLowerCase().includes(target) ||
            author?.displayName.toLowerCase().includes(target)
          );
        }
        return (
          m.content.toLowerCase().includes(searchQuery) ||
          author?.displayName.toLowerCase().includes(searchQuery) ||
          author?.username.toLowerCase().includes(searchQuery)
        );
      })
    : allMessages;

  const isCompact = state.settings.messageDisplay === "compact";
  const me = store.getCurrentUser();

  const messagesHtml =
    visibleMessages.length === 0
      ? `<div class="empty-state-box" style="padding:36px 20px;" data-testid="empty-messages-state">
          <div style="font-size:28px;">✨</div>
          <div style="font-size:14px;font-weight:600;color:var(--header-primary);">Nenhuma mensagem neste canal ainda</div>
          <div style="font-size:12px;">Envie a primeira mensagem no campo abaixo para iniciar a conversa!</div>
        </div>`
      : visibleMessages
          .map((m, idx) => {
            let author = state.users[m.authorId] || {
              id: m.authorId,
              displayName: "Usuário",
              username: "user",
              avatarColor: "#5865f2",
              avatarUrl: ""
            };
            // Someone I ignore (right-click > Ignorar): collapsed until I ask to see it
            if (store.isIgnored(m.authorId) && !uiState.revealedMessages?.[m.id]) {
              return `<div class="message-ignored" data-testid="ignored-message">Mensagem de alguém que você ignorou · <button type="button" data-action="reveal-ignored-message" data-message-id="${escapeHtml(m.id)}">Mostrar</button></div>`;
            }
            // With a server nickname ("Editar perfil por servidor"), it replaces the name here
            const nickname = chatGuild ? store.memberNickname(chatGuild, m.authorId) : "";
            if (nickname) author = { ...author, displayName: nickname };
            const prev = idx > 0 ? visibleMessages[idx - 1] : null;
            const divider = dateDivider(m, prev);
            const isGrouped = !isCompact && prev && !divider && prev.authorId === m.authorId && !m.replyToId;
            const isMentioned = mentionsMe(m.content);

            const replyTarget = m.replyToId ? allMessages.find((item) => item.id === m.replyToId) : null;
            const replyAuthor = replyTarget ? state.users[replyTarget.authorId] : null;
            const replyPreviewText = replyTarget
              ? replyTarget.content || (replyTarget.attachment ? `📎 ${replyTarget.attachment.name || "GIF/Anexo"}` : "Mensagem")
              : "Mensagem original";

            const replyHeaderHtml = m.replyToId
              ? `<div class="message-reply-preview" data-action="jump-to-message" data-target-id="${escapeHtml(m.replyToId)}" title="Ir para a mensagem respondida" data-testid="reply-preview-${escapeHtml(m.id)}">
                  <span>↱</span>
                  <strong style="color:var(--header-primary);">@${escapeHtml(replyAuthor?.username || "user")}</strong>
                  <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;">${escapeHtml(replyPreviewText)}</span>
                </div>`
              : "";

            const isEditing = uiState.editingMessageId === m.id;
            const contentHtml = isEditing
              ? `<div style="margin-top:6px;">
                  <input
                    type="text"
                    id="edit-message-input-${m.id}"
                    class="form-input"
                    style="width:100%;"
                    value="${escapeHtml(m.content)}"
                    data-edit-id="${m.id}"
                  />
                  <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                    ESC para <button style="color:var(--link-color);" data-action="cancel-edit">cancelar</button> •
                    ENTER para <button style="color:var(--link-color);" data-action="save-edit" data-message-id="${m.id}">salvar</button>
                  </div>
                </div>`
              : `<div class="message-text">
                  ${formatMessageMarkdown(m.content)}
                  ${m.edited ? `<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">(editado)</span>` : ""}
                </div>`;

            const attachmentHtml = renderAttachment(m.attachment) + renderPollCard(m, channel.id);

            const reactionsHtml =
              Array.isArray(m.reactions) && m.reactions.length > 0
                ? `<div class="message-reactions">
                    ${m.reactions
                      .map(
                        (r) => `
                      <button
                        class="reaction-pill ${r.me ? "me" : ""}"
                        data-action="toggle-reaction"
                        data-message-id="${m.id}"
                        data-emoji="${r.emoji}"
                      >
                        <span>${r.emoji}</span>
                        <span>${r.count}</span>
                      </button>
                    `
                      )
                      .join("")}
                  </div>`
                : "";

            const threadCount = Array.isArray(m.replies) ? m.replies.length : 0;
            const threadBadgeHtml =
              threadCount > 0
                ? `<button
                    class="reaction-pill"
                    style="margin-top:6px;color:var(--link-color);border-color:var(--border-faint);"
                    data-action="open-thread"
                    data-message-id="${m.id}"
                  >
                    ${Icons.thread}
                    <span>${threadCount} ${threadCount === 1 ? "resposta" : "respostas"} • Ver Tópico</span>
                  </button>`
                : "";

            return `${divider}
              <div
                class="message-row ${isGrouped ? "compact-followup" : ""} ${isMentioned ? "mentioned" : ""} ${uiState.highlightedMessageId === m.id ? "reply-jump-highlight" : ""} ${m.pending ? "pending" : ""}"
                data-message-id="${m.id}"
              >
                ${
                  isCompact
                    ? `<span class="message-timestamp" style="min-width:55px;padding-top:3px;">${escapeHtml(messageClock(m))}</span>`
                    : isGrouped
                      ? `<div class="message-gutter-time">${escapeHtml(messageClock(m))}</div>`
                      : `<div data-action="open-user-popout" data-user-id="${author.id}" style="cursor:pointer;">
                          ${renderAvatar(author, "lg", false)}
                        </div>`
                }
                <div class="message-main">
                  ${replyHeaderHtml}
                  ${
                    !isGrouped || isCompact
                      ? `<div class="message-header">
                          <span class="message-author" data-action="open-user-popout" data-user-id="${author.id}" style="${nameColorStyle(store.getActiveGuild(), author.id)}">
                            ${escapeHtml(author.displayName)}
                          </span>
                          <span style="font-size:11px;color:var(--text-muted);">@${escapeHtml(author.username)}</span>
                          ${m.pinned ? `<span style="font-size:11px;color:var(--status-yellow);">📌 Fixada</span>` : ""}
                          <span class="message-timestamp">${escapeHtml(messageTime(m))}</span>
                        </div>`
                      : ""
                  }
                  ${contentHtml}
                  ${attachmentHtml}
                  ${reactionsHtml}
                  ${threadBadgeHtml}
                </div>

                <div class="message-toolbar">
                  ${
                    perms.react
                      ? `<button class="toolbar-btn" data-action="toggle-reaction" data-message-id="${m.id}" data-emoji="👍" title="Curtir">👍</button>
                  <button class="toolbar-btn" data-action="toggle-reaction" data-message-id="${m.id}" data-emoji="🔥" title="Fogo">🔥</button>
                  <button class="toolbar-btn" data-action="open-emoji-picker" data-message-id="${m.id}" title="Adicionar Reação">${Icons.smile}</button>`
                      : ""
                  }
                  ${perms.send ? `<button class="toolbar-btn" data-action="reply-message" data-message-id="${m.id}" title="Responder">${Icons.reply}</button>` : ""}
                  <button class="toolbar-btn" data-action="open-thread" data-message-id="${m.id}" title="Tópico">${Icons.thread}</button>
                  ${perms.pin ? `<button class="toolbar-btn" data-action="pin-message" data-message-id="${m.id}" title="${m.pinned ? "Desafixar" : "Fixar"}">${Icons.pin}</button>` : ""}
                  ${
                    m.authorId === state.auth.currentUserId
                      ? `<button class="toolbar-btn" data-action="start-edit-message" data-message-id="${m.id}" title="Editar">${Icons.edit}</button>`
                      : ""
                  }
                  ${
                    store.canDeleteMessage(channel.id, m)
                      ? `<button class="toolbar-btn danger" data-action="delete-message" data-message-id="${m.id}" title="Excluir">${Icons.trash}</button>`
                      : ""
                  }
                </div>
              </div>
            `;
          })
          .join("");

  // Right Sidebar (Thread OR Real Guild Members List)
  let rightSidebarHtml = "";
  const activeThreadId = state.navigation.activeThreadMessageId;
  if (activeThreadId) {
    const parentMsg = allMessages.find((m) => m.id === activeThreadId);
    const parentAuthor = parentMsg ? state.users[parentMsg.authorId] : null;
    const replies = parentMsg?.replies || [];
    rightSidebarHtml = `
      <aside class="members-sidebar" style="width:320px;min-width:320px;border-left:1px solid var(--divider-subtle);padding:0;display:flex;flex-direction:column;" data-testid="thread-sidebar">
        <div style="height:48px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--divider-subtle);">
          <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--header-primary);">
            ${Icons.thread}
            <span>Tópico</span>
          </div>
          <button class="icon-btn" data-action="close-thread">${Icons.close}</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;">
          ${
            parentMsg
              ? `<div style="padding-bottom:12px;border-bottom:1px solid var(--divider-subtle);">
                  <div style="font-size:13px;font-weight:700;color:var(--header-primary);">${escapeHtml(parentAuthor?.displayName || "Usuário")}</div>
                  <div style="font-size:14px;color:var(--text-normal);margin-top:4px;">${formatMessageMarkdown(parentMsg.content)}</div>
                </div>`
              : ""
          }
          ${replies
            .map((r) => {
              const u = state.users[r.authorId] || { displayName: "Usuário", avatarColor: "#5865f2" };
              return `
                <div style="display:flex;gap:10px;">
                  ${renderAvatar(u)}
                  <div>
                    <div style="font-size:13px;font-weight:600;color:var(--header-primary);">
                      ${escapeHtml(u.displayName)}
                      <span style="font-size:10px;color:var(--text-muted);font-weight:400;">${escapeHtml(r.timestamp)}</span>
                    </div>
                    <div style="font-size:13px;color:var(--text-normal);margin-top:2px;">${formatMessageMarkdown(r.content)}</div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
        <form id="thread-reply-form" style="padding:12px;border-top:1px solid var(--divider-subtle);display:flex;gap:8px;">
          <input type="text" name="threadText" class="form-input" style="flex:1;height:36px;" placeholder="Responder no tópico..." required />
          <button type="submit" class="btn btn-primary" style="height:36px;">Enviar</button>
        </form>
      </aside>
    `;
  } else if (state.navigation.showMemberList) {
    const guild = isDm ? null : store.getActiveGuild();
    const memberIds = isDm
      ? [state.auth.currentUserId, channel.userId].filter(Boolean)
      : Array.isArray(guild?.memberIds)
        ? guild.memberIds
        : [];
    const dmOrGuildUsers = memberIds.map((id) => state.users[id]).filter(Boolean);
    const onlineUsers = dmOrGuildUsers.filter((u) => u.status !== "offline");
    const offlineUsers = dmOrGuildUsers.filter((u) => u.status === "offline");

    rightSidebarHtml = `
      <div class="members-resizer-anchor"><div class="sidebar-resizer left" data-sidebar-resizer="members" title="Arraste para mudar a largura" role="separator" aria-orientation="vertical"></div></div>
      <aside class="members-sidebar" data-testid="members-sidebar">
        <div class="member-role-title">Online — ${onlineUsers.length}</div>
        ${onlineUsers
          .map(
            (u) => `
          <div class="member-item" data-action="open-user-popout" data-user-id="${u.id}">
            ${renderAvatar(u, "", true)}
            <div style="min-width:0;flex:1;">
              <div class="member-name" style="color:var(--header-primary);${nameColorStyle(guild, u.id)}">
                ${escapeHtml(store.memberNickname(guild, u.id) || u.displayName)}
              </div>
              <div class="member-activity">${activitySummaryHtml(u.id) || `@${escapeHtml(u.username)}`}</div>
            </div>
          </div>
        `
          )
          .join("")}
        ${
          offlineUsers.length > 0
            ? `<div class="member-role-title">Offline — ${offlineUsers.length}</div>
              ${offlineUsers
                .map(
                  (u) => `
                <div class="member-item offline" data-action="open-user-popout" data-user-id="${u.id}">
                  ${renderAvatar(u)}
                  <div style="min-width:0;flex:1;">
                    <div class="member-name" style="${nameColorStyle(guild, u.id)}">${escapeHtml(store.memberNickname(guild, u.id) || u.displayName)}</div>
                    <div class="member-activity">@${escapeHtml(u.username)}</div>
                  </div>
                </div>
              `
                )
                .join("")}`
            : ""
        }
      </aside>
    `;
  }

  // Reply / Attachment Composer Banner
  const replyingMsg = uiState.replyingToMessageId
    ? allMessages.find((m) => m.id === uiState.replyingToMessageId)
    : null;
  const replyingAuthor = replyingMsg ? state.users[replyingMsg.authorId] : null;

  let bannerHtml = "";
  if (replyingMsg) {
    bannerHtml = `
      <div class="composer-banner">
        <span>Respondendo a <strong style="color:var(--header-primary);">@${escapeHtml(replyingAuthor?.username || "user")}</strong></span>
        <button style="color:var(--interactive-normal);" data-action="cancel-reply">${Icons.close}</button>
      </div>
    `;
  }
  // The attached file shows above (works together with a reply)
  const stagedHtml = renderStagedAttachmentBanner(uiState.stagedAttachment, "clear-attachment");

  return `
    <section class="main-stage" data-testid="chat-stage">
      <header class="stage-header">
        <div class="stage-header-left">
          <span style="color:var(--text-muted);display:inline-flex;">
            ${isDm ? `@` : channel.type === "announcement" ? Icons.megaphone : Icons.hash}
          </span>
          <span class="stage-title" data-testid="active-channel-title">${escapeHtml(channel.name)}</span>
          ${
            channel.topic
              ? `<div class="stage-divider"></div>
                 <span class="stage-topic" title="${escapeHtml(channel.topic)}">${escapeHtml(channel.topic)}</span>`
              : ""
          }
        </div>
        <div class="stage-header-right">
          ${
            isDm
              ? state.voice.connectedChannelId === channel.id
                ? `<button class="icon-btn danger-active" data-action="leave-voice" title="Encerrar Chamada" data-testid="end-dm-call-btn">${Icons.phoneOff}</button>`
                : `<button class="icon-btn" data-action="start-dm-call" data-channel-id="${escapeHtml(channel.id)}" title="Iniciar Chamada de Voz" data-testid="start-dm-call-btn">${Icons.phone}</button>`
              : ""
          }
          <button
            class="icon-btn"
            data-action="toggle-pinned-popover"
            title="Mensagens Fixadas (${pinnedList.length})"
            data-testid="pinned-messages-btn"
          >
            ${Icons.pin}
            ${pinnedList.length > 0 ? `<span style="font-size:10px;margin-left:2px;color:var(--brand-purple);font-weight:700;">${pinnedList.length}</span>` : ""}
          </button>
          <button
            class="icon-btn ${state.navigation.showMemberList ? "active" : ""}"
            data-action="toggle-member-list"
            title="Alternar Lista de Membros"
            data-testid="toggle-members-btn"
          >${Icons.friends}</button>
          <div class="header-search-box">
            <input
              type="text"
              id="channel-search-input"
              placeholder="Buscar (ou has:pin)"
              value="${escapeHtml(state.navigation.searchQuery || "")}"
            />
            ${Icons.search}
          </div>
          <button class="icon-btn" data-action="open-rea-info" title="Informações REA">
            ${Icons.help}
          </button>
        </div>
      </header>

      ${isDm ? renderDmCallPanel(state, channel) : ""}
      ${renderScreenShareBannerAndStage(state)}

      <div class="stage-content-split">
        <div class="chat-column">
          <div class="messages-scroller" id="messages-scroller" data-testid="messages-scroller">
            <div class="channel-welcome">
              <div class="channel-welcome-icon">
                ${isDm ? `@` : Icons.hash}
              </div>
              <h1>${isDm ? escapeHtml(channel.name) : `Bem-vindo(a) a #${escapeHtml(channel.name)}!`}</h1>
              <p>${escapeHtml(channel.topic || `Este é o começo do canal #${channel.name}.`)}</p>
            </div>
            ${messagesHtml}
          </div>

          <button
            type="button"
            id="jump-to-present-bar"
            class="jump-to-present-bar"
            data-action="jump-to-present"
            data-testid="jump-to-present-btn"
            title="Ir para as mensagens mais recentes"
            ${shouldShowJumpBar() ? "" : "hidden"}
          >
            <span id="jump-to-present-label">${jumpBarLabel()}</span>
            <span class="jump-to-present-arrow" aria-hidden="true">↓</span>
          </button>

          <div class="composer-area">
            ${stagedHtml}
            ${bannerHtml}
            <form id="message-composer-form" class="composer-box ${bannerHtml ? "has-banner" : ""}">
              ${renderComposerPlus("chat", channel.id)}
              <input
                type="text"
                id="composer-text-input"
                data-testid="composer-input"
                class="composer-input"
                ${perms.send ? "" : "disabled"}
                placeholder="${perms.send ? `Conversar em ${isDm ? `@${channel.name}` : `#${channel.name}`}` : "Você não tem permissão para enviar mensagens neste canal"}"
                autocomplete="off"
              />
              ${perms.send ? `<button type="button" class="composer-gif-btn" data-action="open-gif-picker" data-target="chat" title="Enviar GIF" data-testid="composer-gif-btn">GIF</button>` : ""}
              <button type="button" class="icon-btn" data-action="open-emoji-picker" data-message-id="composer" title="Escolher Emoji">${Icons.smile}</button>
            </form>
            ${renderTypingIndicator(channel.id)}
          </div>
        </div>

        ${rightSidebarHtml}
      </div>
    </section>
  `;
}

// ==========================================================================
// Floating Popovers, Menus, Modals & Fullscreen Settings Overlays
// ==========================================================================

function renderServerDropdownMenu(state) {
  if (!uiState.serverMenuOpen) return "";
  const guild = store.getActiveGuild();
  if (!guild) return "";
  return `
    <div class="floating-popout" style="top:54px;left:80px;width:224px;padding:6px;" data-testid="server-dropdown-menu">
      ${
        store.can("CREATE_INSTANT_INVITE", guild)
          ? `<button class="context-menu-item" data-action="open-invite-modal">
        <span>Convidar Pessoas</span>
        <span>📨</span>
      </button>`
          : ""
      }
      <button class="context-menu-item" data-action="open-server-settings">
        <span>Configurações do Servidor</span>
        <span>⚙️</span>
      </button>
      ${
        store.can("MANAGE_CHANNELS", guild)
          ? `<button class="context-menu-item" data-action="open-create-channel">
        <span>Criar Canal</span>
        <span>＋</span>
      </button>
      <button class="context-menu-item" data-action="edit-category" data-testid="create-category-btn">
        <span>Criar Categoria</span>
        <span>🗂️</span>
      </button>`
          : ""
      }
      ${
        guild.ownerId === state.auth.currentUserId
          ? `<button class="context-menu-item danger" data-action="delete-guild" data-guild-id="${escapeHtml(guild.id)}" data-testid="delete-guild-menu-btn">
               <span>Apagar Servidor</span>
               <span>🗑️</span>
             </button>`
          : ""
      }
    </div>
  `;
}

function renderPinnedPopover(state) {
  if (!uiState.pinnedPopoverOpen) return "";
  const channel = store.getActiveChannel();
  if (!channel) return "";
  const pinned = (state.messages[channel.id] || []).filter((m) => m.pinned);

  return `
    <div class="floating-popout" style="top:56px;right:250px;width:380px;max-height:420px;display:flex;flex-direction:column;" data-testid="pinned-popover">
      <div style="padding:12px 16px;background:var(--bg-channels);border-bottom:1px solid var(--divider-subtle);display:flex;justify-content:space-between;align-items:center;">
        <strong style="color:var(--header-primary);font-size:15px;">📌 Mensagens Fixadas (${pinned.length})</strong>
        <button class="icon-btn" style="width:24px;height:24px;" data-action="toggle-pinned-popover">${Icons.close}</button>
      </div>
      <div style="padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;">
        ${
          pinned.length === 0
            ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">Este canal ainda não possui mensagens fixadas.</div>`
            : pinned
                .map((m) => {
                  const u = state.users[m.authorId] || { displayName: "Usuário" };
                  return `
                    <div style="background:var(--bg-channels);padding:10px;border-radius:6px;border:1px solid var(--border-faint);">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <strong style="font-size:13px;color:var(--header-primary);">${escapeHtml(u.displayName)}</strong>
                        <button style="font-size:11px;color:var(--status-red);" data-action="pin-message" data-message-id="${m.id}">Desafixar</button>
                      </div>
                      <div style="font-size:13px;color:var(--text-normal);">${formatMessageMarkdown(m.content)}</div>
                    </div>
                  `;
                })
                .join("")
        }
      </div>
    </div>
  `;
}

function renderStatusMenu(state) {
  if (!uiState.statusMenuOpen) return "";
  const me = store.getCurrentUser();
  const statuses = [
    { id: "online", label: "Disponível (Online)", dot: "online" },
    { id: "idle", label: "Ausente", dot: "idle" },
    { id: "dnd", label: "Não Perturbe", dot: "dnd" },
    { id: "invisible", label: "Invisível", dot: "offline" }
  ];

  const otherUsers = store.getSavedAccounts().filter((u) => u.id !== me.id);

  return `
    <div class="floating-popout" style="bottom:62px;left:78px;width:270px;padding:12px;" data-testid="status-popout">
      <button class="status-menu-profile" data-action="open-profile-view" data-user-id="${escapeHtml(me.id)}" title="Ver seu perfil" data-testid="status-menu-profile-btn">
        ${renderAvatar(me, "lg", true)}
        <span style="min-width:0;flex:1;text-align:left;">
          <span style="display:block;font-weight:700;color:var(--header-primary);">${escapeHtml(me.displayName)}</span>
          <span style="display:block;font-size:12px;color:var(--text-muted);">@${escapeHtml(me.username)}</span>
        </span>
        <span class="status-menu-profile-hint">Ver perfil ›</span>
      </button>
      <div style="display:flex;flex-direction:column;gap:2px;">
        ${statuses
          .map(
            (s) => `
          <button class="context-menu-item" data-action="set-my-status" data-status="${s.id}">
            <span style="display:flex;align-items:center;gap:8px;">
              <span class="status-dot ${s.dot}" style="position:static;border:none;width:10px;height:10px;"></span>
              ${s.label}
            </span>
            ${me.status === s.id ? "✓" : ""}
          </button>
        `
          )
          .join("")}
        <div style="height:1px;background:var(--divider-subtle);margin:4px 0;"></div>
        <button class="context-menu-item" data-action="open-modal" data-modal="custom-status">
          ✏️ Definir Status Personalizado
        </button>
        <button class="context-menu-item" data-action="copy-text" data-text="${me.id}">
          📋 Copiar ID do Usuário
        </button>
        ${
          otherUsers.length > 0
            ? `<div style="height:1px;background:var(--divider-subtle);margin:4px 0;"></div>
               <div style="font-size:10px;font-weight:700;color:var(--text-muted);padding:2px 8px;text-transform:uppercase;">Alternar Conta Real</div>
               ${otherUsers
                 .slice(0, 4)
                 .map(
                   (u) => `
                 <button class="context-menu-item" data-action="quick-switch-user" data-user-id="${u.id}">
                   <span>@${escapeHtml(u.username)}</span>
                   <span style="font-size:11px;opacity:0.75;">Trocar</span>
                 </button>
               `
                 )
                 .join("")}`
            : ""
        }
        <div style="height:1px;background:var(--divider-subtle);margin:4px 0;"></div>
        <button class="context-menu-item danger" data-action="logout">
          🚪 Sair / Cadastrar Outra Conta
        </button>
      </div>
    </div>
  `;
}

// Message / friend / ban buttons shown on someone else's profile card
function renderProfileActions(state, u, guild) {
  const meId = state.auth.currentUserId;
  if (!u || u.id === meId) return "";
  const relation = state.friends.find((f) => f.userId === u.id)?.relation || null;
  let friendBtn;
  if (relation === "friend") {
    friendBtn = `<button type="button" class="btn btn-secondary btn-sm" disabled title="Vocês já são amigos">Amigos ✓</button>`;
  } else if (relation === "outgoing") {
    friendBtn = `<button type="button" class="btn btn-secondary btn-sm" disabled>Pedido enviado</button>`;
  } else if (relation === "incoming") {
    friendBtn = `<button type="button" class="btn btn-success btn-sm" data-action="accept-friend" data-user-id="${escapeHtml(u.id)}">Aceitar amizade</button>`;
  } else if (relation !== "blocked") {
    friendBtn = `<button type="button" class="btn btn-secondary btn-sm" data-action="send-friend-req-id" data-user-id="${escapeHtml(u.id)}" data-testid="popout-add-friend-btn">Adicionar amigo</button>`;
  } else {
    friendBtn = "";
  }

  let banBtn = "";
  const isMember = guild && guild.ownerId !== u.id && (guild.memberIds || []).includes(u.id);
  if (isMember && canModerate(guild, meId, u.id, "KICK_MEMBERS")) {
    banBtn += `<button type="button" class="btn btn-secondary btn-sm" data-action="kick-member" data-guild-id="${escapeHtml(guild.id)}" data-user-id="${escapeHtml(u.id)}" data-testid="popout-kick-btn">Expulsar</button>`;
  }
  if (isMember && canModerate(guild, meId, u.id, "BAN_MEMBERS")) {
    banBtn += `<button type="button" class="btn btn-danger btn-sm" data-action="ban-member" data-guild-id="${escapeHtml(guild.id)}" data-user-id="${escapeHtml(u.id)}" data-testid="popout-ban-btn">Banir</button>`;
  }

  return `
    <div class="profile-actions-row">
      <button type="button" class="btn btn-primary btn-sm" data-action="popout-message" data-user-id="${escapeHtml(u.id)}" data-testid="popout-message-btn">Mensagem</button>
      ${friendBtn}
      ${banBtn}
    </div>
  `;
}

// Owner, or a role with the permission (or ADMINISTRATOR) placed above the target's roles
function canModerate(guild, actorId, targetId, permission) {
  if (guild.ownerId === actorId) return true;
  const rolesOf = (uid) => (guild.members || []).find((m) => m.userId === uid)?.roles || [];
  const myRoles = guild.roles.filter((r) => rolesOf(actorId).includes(r.id));
  if (!store.can(permission, guild)) return false;
  const top = (roles) => Math.max(0, ...roles.map((r) => r.position || 0));
  return top(myRoles) > top(guild.roles.filter((r) => rolesOf(targetId).includes(r.id)));
}

// Roles on someone's card: coloured pills (× to take one off) and "+" with a
// small searchable list of the roles that can be given
function renderPopoutRoles(state, guild, u, memberRoles, assignableRoles, canManageRoles, isOwner, myHighestPos) {
  const picker = uiState.rolePicker && uiState.rolePicker.userId === u.id ? uiState.rolePicker : null;
  const q = (picker?.search || "").toLowerCase();
  return `
    <div style="height:1px;background:var(--divider-subtle);"></div>
    <div>
      <div class="form-label" style="margin-bottom:6px;">Cargos</div>
      <div class="popout-roles" data-testid="user-popout-roles">
        ${memberRoles
          .map((r) => {
            const canRemove = isOwner || (canManageRoles && (r.position || 0) < myHighestPos);
            return `
            <span class="role-pill" data-role-id="${escapeHtml(r.id)}">
              <span class="role-dot" style="background:${escapeHtml(r.color || "#99aab5")};"></span>
              <span>${escapeHtml(r.name)}</span>
              ${canRemove ? `<button type="button" class="role-pill-x" data-action="remove-user-role" data-guild-id="${escapeHtml(guild.id)}" data-user-id="${escapeHtml(u.id)}" data-role-id="${escapeHtml(r.id)}" title="Tirar o cargo" aria-label="Tirar o cargo ${escapeHtml(r.name)}">×</button>` : ""}
            </span>`;
          })
          .join("")}
        ${
          canManageRoles && assignableRoles.length
            ? `<button type="button" class="role-pill add" data-action="toggle-role-picker" data-user-id="${escapeHtml(u.id)}" title="Dar um cargo" data-testid="popout-add-role-btn">+</button>`
            : ""
        }
        ${!memberRoles.length && !(canManageRoles && assignableRoles.length) ? `<span class="setting-desc">Sem cargos.</span>` : ""}
      </div>
      ${
        picker
          ? `<div class="role-picker" data-testid="role-picker">
              <input type="search" class="form-input" id="role-picker-search" placeholder="Pesquisar cargos" value="${escapeHtml(picker.search || "")}" autocomplete="off" />
              <div class="role-picker-list">
                ${assignableRoles
                  .map(
                    (r) => `<button type="button" class="role-picker-item" data-action="assign-role" data-guild-id="${escapeHtml(guild.id)}" data-user-id="${escapeHtml(u.id)}" data-role-id="${escapeHtml(r.id)}" data-role-name="${escapeHtml(r.name.toLowerCase())}" ${q && !r.name.toLowerCase().includes(q) ? "hidden" : ""}>
                      <span class="role-dot" style="background:${escapeHtml(r.color || "#99aab5")};"></span>${escapeHtml(r.name)}
                    </button>`
                  )
                  .join("")}
              </div>
            </div>`
          : ""
      }
    </div>`;
}

// Next to whatever was clicked (a name in the chat, someone in the call...):
// to its right when there is room, otherwise to its left. Without an anchor,
// beside the member list as before.
const USER_POPOUT_WIDTH = 330;
const USER_POPOUT_GAP = 12;
function userPopoutPosition(anchor) {
  if (!anchor) return "top:84px;right:255px;";
  const fitsRight = anchor.right + USER_POPOUT_GAP + USER_POPOUT_WIDTH <= window.innerWidth - USER_POPOUT_GAP;
  const left = fitsRight ? anchor.right + USER_POPOUT_GAP : Math.max(USER_POPOUT_GAP, anchor.left - USER_POPOUT_GAP - USER_POPOUT_WIDTH);
  return `left:${Math.round(left)}px;top:${Math.round(Math.max(USER_POPOUT_GAP, anchor.top))}px;`;
}

// Its height is only known once drawn: moved up if it would leave the window
function keepUserPopoutOnScreen() {
  const el = document.querySelector(".user-popout");
  if (!el || !uiState.userPopout?.anchor) return;
  const r = el.getBoundingClientRect();
  const overflow = r.bottom - (window.innerHeight - USER_POPOUT_GAP);
  if (overflow > 0) el.style.top = `${Math.max(USER_POPOUT_GAP, r.top - overflow)}px`;
}

function renderUserPopout(state) {
  if (!uiState.userPopout) return "";
  const u = state.users[uiState.userPopout.userId];
  if (!u) return "";
  const note = state.userNotes[u.id] || "";

  const guild = store.getActiveGuild();
  const me = store.getCurrentUser();
  const isOwner = guild && guild.ownerId === me.id;
  const canManageRoles = Boolean(guild) && store.can("MANAGE_ROLES", guild);
  const myHighestPos = guild ? myTopRolePosition(guild, me.id) : 0;

  const memberRoleIds = guild ? ((guild.members || []).find((m) => m.userId === u.id)?.roles || []) : [];
  const memberRoles = guild ? guild.roles.filter((r) => memberRoleIds.includes(r.id)) : [];
  const assignableRoles = guild && canManageRoles
    ? guild.roles.filter((r) => !memberRoleIds.includes(r.id) && r.name !== "@everyone" && (isOwner || (r.position || 0) < myHighestPos))
    : [];

  return `
    <div class="floating-popout user-popout ${profileCardClasses(u)}" style="${userPopoutPosition(uiState.userPopout.anchor)}width:330px;${profileThemeStyle(u)}" data-testid="user-profile-popout">
      <div style="position:relative;">
        ${renderBanner(u, 96)}
        <button
          style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.55);color:#fff;width:26px;height:26px;border-radius:50%;font-weight:700;"
          data-action="close-user-popout"
        >×</button>
      </div>
      <div style="padding:0 16px 16px 16px;position:relative;">
        <div class="user-popout-avatar">
          ${renderExpandableAvatar(u)}
        </div>
        <div class="user-popout-inner">
          <div>
            <div class="popout-display-name selectable" style="font-size:18px;font-weight:700;color:var(--header-primary);${nameColorStyle(guild, u.id)}">${escapeHtml(u.displayName)}</div>
            <div class="selectable" style="font-size:13px;color:var(--text-muted);" data-testid="popout-username">@${escapeHtml(u.username)}</div>
            <button class="link-btn" style="margin-top:4px;" data-action="open-profile-view" data-user-id="${escapeHtml(u.id)}">Ver perfil completo</button>
          </div>
          ${renderProfileActions(state, u, guild)}
          ${u.customStatus ? `<div style="font-size:13px;color:var(--text-normal);">${escapeHtml(u.customStatus)}</div>` : ""}
          ${(() => {
            const cards = renderLiveActivityCards(u.id);
            return cards ? `<div class="activity-card-list compact">${cards}</div>` : "";
          })()}
          <div style="height:1px;background:var(--divider-subtle);"></div>
          <div>
            <div class="form-label" style="margin-bottom:4px;">Sobre Mim</div>
            <div style="font-size:13px;color:var(--text-normal);">${escapeHtml(u.aboutMe || "")}</div>
          </div>
          <div>
            <div class="form-label" style="margin-bottom:4px;">Membro Desde</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(u.memberSince || "Out 2021")}</div>
          </div>
          <div>
            <div class="form-label" style="margin-bottom:4px;">Nota Pessoal</div>
            <input
              type="text"
              class="form-input"
              style="height:30px;font-size:12px;"
              placeholder="Clique para adicionar uma nota"
              value="${escapeHtml(note)}"
              data-user-note-id="${u.id}"
            />
          </div>

          ${guild && (guild.memberIds || []).includes(u.id) ? renderPopoutRoles(state, guild, u, memberRoles, assignableRoles, canManageRoles, isOwner, myHighestPos) : ""}

          ${
            u.id !== state.auth.currentUserId
              ? `<form id="popout-dm-form" data-target-user="${u.id}" class="popout-dm-form">
                  <label class="form-label">Conversar com ${escapeHtml(u.displayName)}</label>
                  <input
                    type="text"
                    name="quickDm"
                    class="form-input"
                    style="width:100%;height:34px;font-size:13px;"
                    placeholder="Conversar com @${escapeHtml(u.username)}"
                    required
                  />
                </form>`
              : `<button type="button" class="btn btn-secondary btn-sm popout-edit-profile" data-action="open-profile-settings" data-testid="popout-edit-profile-btn">${Icons.edit} Editar perfil</button>`
          }
        </div>
      </div>
    </div>
  `;
}

// The emoji picker lives outside the app tree (src/ui/emojiPicker.js)
function renderEmojiPickerPopover() {
  return "";
}

// ==========================================================================
// Modals (Create/Join Server, Create Channel, Cryptographic Invites, Screen Share Picker)
// ==========================================================================
function renderActiveModal(state) {
  const modal = uiState.activeModal;
  if (!modal) return "";

  if (modal === "create-server") {
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card wide" data-testid="create-server-modal">
          <div class="modal-header">
            <h2>Criar um Servidor ou Entrar com Convite</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <div class="modal-body" style="gap:20px;">
            <form id="create-server-form" style="background:var(--bg-channels);padding:16px;border-radius:8px;display:flex;flex-direction:column;gap:12px;">
              <h3 style="font-size:15px;color:var(--header-primary);">1. Criar um Novo Servidor</h3>
              <div style="display:flex;gap:12px;align-items:flex-end;">
                <div class="form-group" style="flex:1;">
                  <label class="form-label">Nome do Servidor *</label>
                  <input class="form-input" name="name" type="text" value="Servidor de ${escapeHtml(store.getCurrentUser().displayName)}" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Cor</label>
                  <input class="form-input" name="iconColor" type="color" value="#5865f2" style="padding:4px;height:40px;width:64px;" />
                </div>
                <button type="submit" class="btn btn-primary" style="height:40px;">Criar Servidor</button>
              </div>
              <label class="checkbox-row" for="create-server-public">
                <input type="checkbox" class="checkbox-input" id="create-server-public" name="isPublic" />
                <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
                <span class="checkbox-text"><span class="setting-title">Servidor público</span><span class="setting-desc">Aparece em Explorar servidores e qualquer pessoa pode entrar. Dá para mudar depois nas configurações do servidor.</span></span>
              </label>
            </form>

            <form id="join-invite-form" style="background:var(--bg-channels);padding:16px;border-radius:8px;display:flex;flex-direction:column;gap:12px;" data-testid="join-invite-form">
              <h3 style="font-size:15px;color:var(--header-primary);">2. Já tem um Convite? Entrar em um Servidor</h3>
              <p style="font-size:12px;color:var(--text-muted);">Insira o código único de convite ou o link completo (ex: <code>${escapeHtml(buildInviteUrl("AbCdEf123456"))}</code>):</p>
              <div style="display:flex;gap:10px;">
                <input
                  class="form-input"
                  name="inviteCode"
                  data-testid="join-invite-input"
                  type="text"
                  placeholder="${escapeHtml(buildInviteUrl("codigo-unico"))}"
                  style="flex:1;"
                  required
                />
                <button type="submit" class="btn btn-success" data-testid="join-invite-submit-btn">Entrar com Convite</button>
              </div>
              ${uiState.joinInviteError ? `<div class="form-error" data-testid="join-invite-error">${escapeHtml(uiState.joinInviteError)}</div>` : ""}
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-action="close-modal">Fechar</button>
          </div>
        </div>
      </div>
    `;
  }

  // Right-click on a server > Config. de privacidade
  if (modal === "guild-privacy") {
    const guild = state.guilds.find((g) => g.id === uiState.guildPrivacyId);
    if (!guild) return "";
    const me = (guild.members || []).find((m) => m.userId === state.auth.currentUserId);
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card" data-testid="guild-privacy-modal">
          <div class="modal-header">
            <h2>Privacidade em ${escapeHtml(guild.name)}</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="guild-privacy-form" data-guild-id="${escapeHtml(guild.id)}">
            <div class="modal-body">
              <label class="checkbox-row" for="guild-allow-dms">
                <input type="checkbox" class="checkbox-input" id="guild-allow-dms" name="allowDms" ${me?.allowDms !== false ? "checked" : ""} />
                <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
                <span class="checkbox-text"><span class="setting-title">Permitir mensagens diretas de membros do servidor</span><span class="setting-desc">Quem não é seu amigo e só compartilha este servidor com você não consegue iniciar uma conversa. Amigos e conversas já abertas continuam iguais.</span></span>
              </label>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Right-click on a server > Editar perfil por servidor (nickname there)
  if (modal === "guild-nickname") {
    const guild = state.guilds.find((g) => g.id === uiState.guildNicknameId);
    if (!guild) return "";
    const me = store.getCurrentUser();
    const nickname = store.memberNickname(guild, me.id);
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card" data-testid="guild-nickname-modal">
          <div class="modal-header">
            <h2>Seu perfil em ${escapeHtml(guild.name)}</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="guild-nickname-form" data-guild-id="${escapeHtml(guild.id)}">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Apelido no servidor</label>
                <input class="form-input" name="nickname" type="text" maxlength="32" value="${escapeHtml(nickname)}" placeholder="${escapeHtml(me.displayName)}" />
                <div class="setting-desc" style="margin-top:6px;">Aparece no lugar do seu nome só neste servidor (no chat, na lista de membros e nas chamadas). Deixe vazio para usar ${escapeHtml(me.displayName)}.</div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (modal === "create-channel") {
    const guild = store.getActiveGuild();
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card" data-testid="create-channel-modal">
          <div class="modal-header">
            <h2>Criar Canal em ${escapeHtml(guild?.name || "Servidor")}</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="create-channel-form">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Tipo de Canal</label>
                <select class="form-input" name="type">
                  <option value="text"># Texto — Mensagens, imagens e código</option>
                  <option value="voice">🔊 Voz — Chamada de áudio e compartilhamento de tela</option>
                  <option value="announcement">📢 Anúncios — Avisos importantes</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Nome do Canal *</label>
                <input class="form-input" name="name" type="text" placeholder="novo-canal" required />
              </div>
              <div class="form-group">
                <label class="form-label">Tópico do Canal</label>
                <input class="form-input" name="topic" type="text" placeholder="Assunto principal do canal" />
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Criar Canal</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Name / spoiler of the file waiting to be sent
  if (modal === "edit-attachment") {
    const att = uiState.modalPayload?.target === "call" ? uiState.callStagedAttachment : uiState.stagedAttachment;
    if (!att) return "";
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card" data-testid="edit-attachment-modal">
          <div class="modal-header">
            <h2>Editar anexo</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="edit-attachment-form">
            <div class="modal-body">
              ${att.isImage ? `<img class="edit-attachment-preview" src="${escapeHtml(att.url)}" alt="" />` : ""}
              <div class="form-group">
                <label class="form-label">Nome do arquivo</label>
                <input class="form-input" name="name" type="text" maxlength="120" value="${escapeHtml(att.name)}" required />
              </div>
              <label class="checkbox-row" for="attachment-spoiler">
                <input type="checkbox" class="checkbox-input" id="attachment-spoiler" name="spoiler" ${att.spoiler ? "checked" : ""} />
                <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
                <span class="checkbox-text"><span class="setting-title">Marcar como spoiler</span><span class="setting-desc">A imagem chega borrada e só aparece quando a pessoa clicar.</span></span>
              </label>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Edit a channel: name, topic and the category it sits in
  if (modal === "edit-channel") {
    const guild = store.getActiveGuild();
    const ch = guild?.channels.find((c) => c.id === uiState.modalPayload?.channelId);
    if (!ch) return "";
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card" data-testid="edit-channel-modal">
          <div class="modal-header">
            <h2>Editar canal</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="edit-channel-form" data-channel-id="${escapeHtml(ch.id)}">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Nome do canal</label>
                <input class="form-input" name="name" type="text" maxlength="100" value="${escapeHtml(ch.name)}" required data-testid="edit-channel-name" />
              </div>
              ${
                ch.type === "voice"
                  ? ""
                  : `<div class="form-group">
                <label class="form-label">Tópico do canal</label>
                <input class="form-input" name="topic" type="text" maxlength="300" value="${escapeHtml(ch.topic || "")}" />
              </div>`
              }
              <div class="form-group">
                <label class="form-label">Categoria</label>
                <select class="form-input" name="categoryId">
                  ${(guild.categories || []).map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === ch.categoryId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-danger" data-action="delete-channel" data-channel-id="${escapeHtml(ch.id)}" style="margin-right:auto;">Excluir canal</button>
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Create (no id) or rename a category
  if (modal === "edit-category") {
    const guild = store.getActiveGuild();
    const cat = guild?.categories.find((c) => c.id === uiState.modalPayload?.categoryId) || null;
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card" data-testid="edit-category-modal">
          <div class="modal-header">
            <h2>${cat ? "Renomear categoria" : "Criar categoria"}</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="edit-category-form" data-category-id="${escapeHtml(cat?.id || "")}">
            <div class="modal-body">
              <p class="setting-desc">Categorias agrupam canais de texto e de voz. Depois de criar, use o <strong>+</strong> da categoria para adicionar canais dentro dela.</p>
              <div class="form-group">
                <label class="form-label">Nome da categoria</label>
                <input class="form-input" name="name" type="text" maxlength="100" value="${escapeHtml(cat?.name || "")}" placeholder="Ex.: Jogos" required data-testid="category-name-input" />
              </div>
            </div>
            <div class="modal-footer">
              ${cat ? `<button type="button" class="btn btn-danger" data-action="delete-category" data-category-id="${escapeHtml(cat.id)}" style="margin-right:auto;">Excluir categoria</button>` : ""}
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">${cat ? "Salvar" : "Criar categoria"}</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Poll: question + 2..10 options, posted as a message in the chosen channel
  if (modal === "create-poll") {
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <form class="modal-card" id="create-poll-form" data-channel-id="${escapeHtml(uiState.modalPayload?.channelId || "")}" data-testid="create-poll-modal">
          <div class="modal-header">
            <h2>Criar enquete</h2>
            <button type="button" class="icon-btn" data-action="close-modal" aria-label="Fechar">${Icons.close}</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="poll-question">Pergunta</label>
              <input class="form-input" id="poll-question" name="question" maxlength="300" placeholder="Ex.: Qual jogo hoje à noite?" required />
            </div>
            <div class="form-group">
              <label class="form-label">Opções</label>
              <div class="poll-option-inputs" id="poll-option-inputs">
                <input class="form-input" name="option" maxlength="80" placeholder="Opção 1" required />
                <input class="form-input" name="option" maxlength="80" placeholder="Opção 2" required />
              </div>
              <button type="button" class="link-btn" id="poll-add-option">+ Adicionar opção</button>
            </div>
            <div class="form-error" id="poll-error"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
            <button type="submit" class="btn btn-primary" data-testid="poll-submit-btn">Publicar enquete</button>
          </div>
        </form>
      </div>
    `;
  }

  // Phase 11: Cryptographic Server Invite Modal
  if (modal === "invite") {
    const guild = store.getActiveGuild();
    const inv = uiState.currentInvite;
    const inviteCode = inv?.code || "";
    const inviteUrl = inviteCode ? inv.url || buildInviteUrl(inviteCode) : "Gerando código único...";
    const activeInvites = (uiState.guildInvitesList || []).filter((i) => !i.revoked);

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card wide" data-testid="invite-modal">
          <div class="modal-header">
            <h2>Convidar amigos para ${escapeHtml(guild?.name || "Servidor")}</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <div class="modal-body" style="gap:16px;">
            <div style="background:var(--bg-channels);padding:14px;border-radius:8px;display:flex;flex-direction:column;gap:10px;">
              <div class="form-label">Link de Convite do ${escapeHtml(getAppName())}</div>
              <div style="display:flex;gap:8px;">
                <input
                  class="form-input"
                  id="generated-invite-url-input"
                  data-testid="invite-url-input"
                  style="flex:1;font-family:var(--monospace-font);"
                  type="text"
                  readonly
                  value="${escapeHtml(inviteUrl)}"
                />
                <button
                  class="btn ${uiState.inviteCopiedCode === inviteCode ? "btn-success" : "btn-primary"}"
                  data-action="copy-invite-code"
                  data-code="${escapeHtml(inviteCode)}"
                  data-url="${escapeHtml(inviteUrl)}"
                  data-testid="copy-invite-btn"
                >
                  ${uiState.inviteCopiedCode === inviteCode ? "✓ Copiado!" : "Copiar Link"}
                </button>
                <button class="btn btn-secondary" data-action="generate-new-invite" data-testid="generate-new-invite-btn" title="Gerar um novo token único">
                  Gerar Novo Código
                </button>
              </div>
              <div style="display:flex;gap:12px;align-items:center;margin-top:4px;">
                <div class="form-group" style="flex:1;">
                  <label class="form-label">Expiração</label>
                  <select class="form-input" id="invite-expires-select" style="height:34px;font-size:12px;">
                    <option value="1800" ${uiState.inviteExpiresIn === 1800 ? "selected" : ""}>30 minutos</option>
                    <option value="86400" ${uiState.inviteExpiresIn === 86400 ? "selected" : ""}>24 horas</option>
                    <option value="604800" ${uiState.inviteExpiresIn === 604800 ? "selected" : ""}>7 dias</option>
                    <option value="0" ${uiState.inviteExpiresIn === 0 ? "selected" : ""}>Nunca expira</option>
                  </select>
                </div>
                <div class="form-group" style="flex:1;">
                  <label class="form-label">Limite de Usos</label>
                  <select class="form-input" id="invite-maxuses-select" style="height:34px;font-size:12px;">
                    <option value="0" ${uiState.inviteMaxUses === 0 ? "selected" : ""}>Sem limite</option>
                    <option value="1" ${uiState.inviteMaxUses === 1 ? "selected" : ""}>1 uso</option>
                    <option value="5" ${uiState.inviteMaxUses === 5 ? "selected" : ""}>5 usos</option>
                    <option value="10" ${uiState.inviteMaxUses === 10 ? "selected" : ""}>10 usos</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div class="form-label" style="margin-bottom:8px;">Convites Ativos neste Servidor (${activeInvites.length})</div>
              <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
                ${
                  activeInvites.length === 0
                    ? `<div style="font-size:12px;color:var(--text-muted);padding:8px;">Nenhum convite ativo.</div>`
                    : activeInvites
                        .map(
                          (item) => `
                        <div style="background:var(--bg-channels);padding:8px 12px;border-radius:6px;display:flex;align-items:center;justify-content:space-between;font-size:12px;">
                          <div>
                            <code style="color:var(--header-primary);font-weight:700;">${escapeHtml(item.code)}</code>
                            <span style="color:var(--text-muted);margin-left:8px;">Usos: ${item.uses}${item.maxUses > 0 ? `/${item.maxUses}` : " (ilimitado)"}</span>
                          </div>
                          <button class="btn btn-danger" style="height:26px;padding:0 10px;font-size:11px;" data-action="revoke-invite" data-code="${escapeHtml(item.code)}">
                            Revogar
                          </button>
                        </div>
                      `
                        )
                        .join("")
                }
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-action="close-modal">Fechar</button>
          </div>
        </div>
      </div>
    `;
  }

  // Phase 9: Screen Share Source Picker Modal
  if (modal === "screenshare-picker") {
    const sources = uiState.screenSources || [];
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card wide" data-testid="screenshare-picker-modal">
          <div class="modal-header">
            <h2>Compartilhar Sua Tela</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <div class="modal-body">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <p style="font-size:13px;color:var(--text-muted);">Escolha uma tela ou a janela de um app aberto no Windows.</p>
              <button type="button" class="btn btn-secondary btn-sm" data-action="refresh-screen-sources" data-testid="refresh-screen-sources-btn">Atualizar lista</button>
            </div>
            ${
              sources.length === 0
                ? `<div class="screen-source-empty">${uiState.loadingScreenSources ? "Procurando telas e janelas abertas..." : "Nenhuma tela ou janela disponível para compartilhar."}</div>`
                : [
                    ["Telas", sources.filter((src) => src.isScreen)],
                    ["Janelas", sources.filter((src) => !src.isScreen)]
                  ]
                    .filter(([, list]) => list.length > 0)
                    .map(
                      ([label, list]) => `
                  <div class="screen-source-group">
                    <div class="form-label">${label} (${list.length})</div>
                    <div class="screen-source-grid" data-testid="screen-source-grid">
                      ${list.map((src) => renderScreenSourceCard(src)).join("")}
                    </div>
                  </div>`
                    )
                    .join("")
            }
            <div style="display:flex;gap:12px;background:var(--bg-channels);padding:12px;border-radius:8px;">
              <div class="form-group" style="flex:1;">
                <label class="form-label">Qualidade da Transmissão</label>
                <select class="form-input" id="screenshare-res-select" style="height:34px;">
                  ${[
                    ["720p", "720p HD"],
                    ["1080p", "1080p Full HD"],
                    ["1440p", "1440p Quad HD"],
                    ["source", "Original (resolução da tela)"]
                  ]
                    .map(([v, label]) => `<option value="${v}" ${uiState.screenShareResolution === v ? "selected" : ""}>${label}</option>`)
                    .join("")}
                </select>
              </div>
              <div class="form-group" style="flex:1;">
                <label class="form-label">Taxa de Quadros</label>
                <select class="form-input" id="screenshare-fps-select" style="height:34px;">
                  ${[15, 30, 60, 120].map((f) => `<option value="${f}" ${uiState.screenShareFps === f ? "selected" : ""}>${f} FPS</option>`).join("")}
                </select>
              </div>
            </div>
            <label class="screenshare-audio-toggle">
              <input type="checkbox" id="screenshare-audio-check" ${uiState.screenShareAudio ? "checked" : ""} />
              <span>Transmitir o som do PC junto (só ao compartilhar uma tela inteira)</span>
            </label>
            <p class="screenshare-quality-hint">Quanto maior a qualidade, mais internet de upload é usada (1080p a 60 FPS ≈ 9 Mbps; 120 FPS ≈ 17 Mbps por pessoa assistindo). A transmissão se ajusta sozinha se a conexão não aguentar.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
            <button type="button" class="btn btn-primary" data-action="confirm-start-screenshare" data-testid="confirm-start-screenshare-btn">
              Transmitir Ao Vivo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (modal === "custom-status") {
    const me = store.getCurrentUser();
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <h2>Definir um status personalizado</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <form id="custom-status-form">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">O que está acontecendo, ${escapeHtml(me.displayName)}?</label>
                <input class="form-input" name="customStatus" type="text" value="${escapeHtml(me.customStatus || "")}" placeholder="Ex: Trabalhando no projeto..." />
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-action="close-modal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (modal === "quick-switcher") {
    const q = (uiState.quickSwitcherQuery || "").toLowerCase();
    const items = [];
    for (const g of state.guilds) {
      if (!q || g.name.toLowerCase().includes(q)) {
        items.push({ type: "guild", id: g.id, label: `Servidor: ${g.name}` });
      }
      for (const c of g.channels) {
        if (!q || c.name.toLowerCase().includes(q)) {
          items.push({ type: "channel", guildId: g.id, id: c.id, label: `#${c.name} (${g.name})` });
        }
      }
    }
    for (const dm of state.dms) {
      const u = state.users[dm.userId];
      if (u && (!q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))) {
        items.push({ type: "dm", id: dm.id, label: `@${u.username} (${u.displayName})` });
      }
    }

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card wide" data-testid="quick-switcher-modal">
          <div class="modal-body" style="padding:20px;">
            <input
              type="text"
              id="quick-switcher-input"
              class="form-input"
              style="height:46px;font-size:16px;"
              placeholder="Para onde você quer ir? (Servidores, #canais, @DMs)"
              value="${escapeHtml(uiState.quickSwitcherQuery)}"
              autofocus
            />
            <div style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto;margin-top:8px;">
              ${items
                .slice(0, 12)
                .map(
                  (it) => `
                <button
                  class="context-menu-item"
                  data-action="quick-switch-go"
                  data-type="${it.type}"
                  data-id="${it.id}"
                  data-guild-id="${it.guildId || ""}"
                >
                  <span>${escapeHtml(it.label)}</span>
                  <span style="font-size:11px;color:var(--text-muted);">${it.type.toUpperCase()}</span>
                </button>
              `
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (modal === "rea-info") {
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-card wide" data-testid="rea-info-modal">
          <div class="modal-header">
            <h2>Relatório REA & Arquitetura SQLite Real</h2>
            <button class="icon-btn" data-action="close-modal">${Icons.close}</button>
          </div>
          <div class="modal-body" style="font-size:13px;line-height:1.5;">
            <div style="background:var(--bg-channels);padding:12px;border-radius:6px;">
              <strong style="color:var(--header-primary);">1. Evidências REA Verificadas</strong>
              <ul style="padding-left:18px;margin-top:6px;color:var(--text-normal);">
                <li><code>Discord.exe</code> (Update.exe launcher PE32+) & <code>app-1.0.9262/Discord.exe</code> (Electron 42.7.1)</li>
                <li><code>resources/app.asar</code> & <code>discord_desktop_core/core.asar</code> (162 canais IPC <code>DISCORD_*</code> e 33 módulos <code>DiscordNative</code>)</li>
              </ul>
            </div>
            <div style="background:var(--bg-channels);padding:12px;border-radius:6px;">
              <strong style="color:var(--header-primary);">2. Persistência SQLite & Servidor Real</strong>
              <p style="margin-top:4px;color:var(--text-muted);">
                Modo ativo: <code>${escapeHtml(IntegrationMetadata.mode)}</code><br/>
                Todos os usuários, identificadores <code>@username</code>, amizades, mensagens, convites criptográficos, temas, sons de chamada e uploads de mídia estão persistidos no banco SQLite nativo (<code>node:sqlite</code>) em <code>userData/discord_rea.sqlite</code>.
              </p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" data-action="close-modal">Fechar</button>
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

// ==========================================================================
// Phase 2: Role Permissions & Server Roles Hierarchy Manager
// ==========================================================================
// Highest role of a member that has a colour (names in chat and member list)
function roleColorOf(guild, userId) {
  if (!guild) return "";
  const roleIds = (guild.members || []).find((m) => m.userId === userId)?.roles || [];
  const role = (guild.roles || [])
    .filter((r) => roleIds.includes(r.id) && r.color && r.color.toLowerCase() !== "#99aab5")
    .sort((a, b) => (b.position || 0) - (a.position || 0))[0];
  return role?.color || "";
}

function nameColorStyle(guild, userId) {
  const color = roleColorOf(guild, userId);
  return color ? `color:${escapeHtml(color)};` : "";
}

function myTopRolePosition(guild, meId) {
  if (guild.ownerId === meId) return Infinity;
  const roleIds = (guild.members || []).find((m) => m.userId === meId)?.roles || [];
  return Math.max(0, ...(guild.roles || []).filter((r) => roleIds.includes(r.id)).map((r) => r.position || 0));
}

const ROLE_COLOR_PRESETS = ["#99aab5", "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b", "#ffffff"];

function renderServerRolesManager(guild, me) {
  const view = uiState.rolesView || { mode: "list" };
  const canManage = store.can("MANAGE_ROLES", guild);
  const myTop = myTopRolePosition(guild, me.id);
  const roles = [...(guild.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const membersWith = (roleId) => (guild.members || []).filter((m) => (m.roles || []).includes(roleId));
  const catalog = store.getState().permissionCatalog || [];

  if (view.mode === "edit") {
    const isEveryone = view.roleId === "everyone";
    const role = isEveryone
      ? { id: "everyone", name: "@everyone", color: "#99aab5", permissions: guild.everyonePermissions || [], position: 0 }
      : roles.find((r) => r.id === view.roleId);
    if (!role) {
      uiState.rolesView = { mode: "list" };
      return renderServerRolesManager(guild, me);
    }
    const editable = canManage && (isEveryone || guild.ownerId === me.id || (role.position || 0) < myTop);
    const dis = editable ? "" : "disabled";
    return `
      <div class="roles-page" data-testid="roles-manager-container">
        <button type="button" class="link-btn roles-back" data-action="roles-back">← Voltar para cargos</button>
        <div class="roles-edit-head">
          <h2 class="roles-title"><span class="role-dot" style="background:${escapeHtml(role.color || "#99aab5")};"></span>Editar cargo — ${escapeHtml(role.name)}</h2>
          ${editable ? `<button type="submit" form="edit-role-form" class="btn btn-success">Salvar alterações</button>` : ""}
        </div>
        ${editable ? "" : `<p class="roles-locked">🔒 Este cargo está acima do seu: você pode ver, mas não editar.</p>`}
        <form id="edit-role-form" data-guild-id="${escapeHtml(guild.id)}" data-role-id="${escapeHtml(role.id)}" data-everyone="${isEveryone ? "1" : ""}">
          ${
            isEveryone
              ? `<p class="setting-desc">Permissões que <strong>todos os membros</strong> do servidor têm, além das dos cargos deles.</p>`
              : `
            <div class="roles-edit-grid">
              <div class="form-group">
                <label class="form-label" for="role-name-input">Nome do cargo</label>
                <input type="text" id="role-name-input" data-testid="role-name-input" class="form-input" name="name" maxlength="60" value="${escapeHtml(role.name)}" ${dis} required />
              </div>
              <div class="form-group">
                <label class="form-label">Cor do cargo</label>
                <div class="role-color-row">
                  <input type="color" id="role-color-picker" data-testid="role-color-picker" value="${escapeHtml(role.color || "#99aab5")}" ${dis} />
                  <input type="text" id="role-color-hex" class="form-input" maxlength="7" value="${escapeHtml(role.color || "#99aab5")}" ${dis} />
                </div>
                <div class="role-color-presets">
                  ${ROLE_COLOR_PRESETS.map((c) => `<button type="button" class="role-color-swatch" style="background:${c};" data-role-color="${c}" title="${c}" ${dis}></button>`).join("")}
                </div>
              </div>
            </div>
            <label class="checkbox-row" for="role-hoist-checkbox">
              <input type="checkbox" class="checkbox-input" id="role-hoist-checkbox" data-testid="role-hoist-checkbox" ${role.hoist ? "checked" : ""} ${dis} />
              <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
              <span class="checkbox-text"><span class="setting-title">Mostrar separado na lista de membros</span></span>
            </label>`
          }
          <div class="perm-groups" data-testid="role-permissions-checklist">
            ${catalog
              .filter((group) => !isEveryone || group.perms.some((p) => p.flag !== "ADMINISTRATOR"))
              .map(
                (group) => `
              <section class="perm-group">
                <h4>${escapeHtml(group.title)}</h4>
                ${group.perms
                  .filter((p) => !(isEveryone && p.flag === "ADMINISTRATOR"))
                  .map(
                    (p) => `
                  <label class="perm-row">
                    <span class="perm-text">
                      <strong>${escapeHtml(p.label)}</strong>
                      <span>${escapeHtml(p.desc)}</span>
                    </span>
                    <input type="checkbox" class="role-perm-checkbox perm-switch" data-perm-flag="${p.flag}" data-testid="perm-checkbox-${p.flag}" ${(role.permissions || []).includes(p.flag) ? "checked" : ""} ${dis} />
                  </label>`
                  )
                  .join("")}
              </section>`
              )
              .join("")}
          </div>
          <div class="roles-edit-footer">
            ${
              !isEveryone && editable
                ? `<button type="button" class="btn btn-danger" data-action="delete-role" data-guild-id="${escapeHtml(guild.id)}" data-role-id="${escapeHtml(role.id)}" data-testid="delete-role-btn">Excluir cargo</button>`
                : "<span></span>"
            }
            ${editable ? `<button type="submit" class="btn btn-success" data-testid="save-role-btn">Salvar alterações</button>` : ""}
          </div>
        </form>
      </div>`;
  }

  if (view.mode === "members") {
    const role = roles.find((r) => r.id === view.roleId);
    if (!role) {
      uiState.rolesView = { mode: "list" };
      return renderServerRolesManager(guild, me);
    }
    const canTouch = canManage && (guild.ownerId === me.id || (role.position || 0) < myTop);
    const withRole = membersWith(role.id).map((m) => store.getState().users[m.userId]).filter(Boolean);
    const without = (guild.members || [])
      .filter((m) => !(m.roles || []).includes(role.id))
      .map((m) => store.getState().users[m.userId])
      .filter(Boolean);
    return `
      <div class="roles-page">
        <button type="button" class="link-btn roles-back" data-action="roles-back">← Voltar para cargos</button>
        <h2 class="roles-title"><span class="role-dot" style="background:${escapeHtml(role.color || "#99aab5")};"></span>Membros com ${escapeHtml(role.name)} (${withRole.length})</h2>
        <div class="role-members-list">
          ${
            withRole.length
              ? withRole
                  .map(
                    (u) => `
              <div class="role-member-row">
                ${renderAvatar(u, "", false)}
                <span class="role-member-name">${escapeHtml(u.displayName)} <span>@${escapeHtml(u.username)}</span></span>
                ${canTouch ? `<button type="button" class="icon-btn" data-action="remove-user-role" data-guild-id="${escapeHtml(guild.id)}" data-user-id="${escapeHtml(u.id)}" data-role-id="${escapeHtml(role.id)}" title="Tirar o cargo">${Icons.close}</button>` : ""}
              </div>`
                  )
                  .join("")
              : `<p class="setting-desc">Ninguém tem este cargo ainda.</p>`
          }
        </div>
        ${
          canTouch && without.length
            ? `<h4 class="roles-subtitle">Adicionar membro</h4>
               <div class="role-members-list">
                 ${without
                   .map(
                     (u) => `
                   <button type="button" class="role-member-row add" data-action="role-add-member" data-guild-id="${escapeHtml(guild.id)}" data-user-id="${escapeHtml(u.id)}" data-role-id="${escapeHtml(role.id)}">
                     ${renderAvatar(u, "", false)}
                     <span class="role-member-name">${escapeHtml(u.displayName)} <span>@${escapeHtml(u.username)}</span></span>
                     <span class="role-member-add">${Icons.plus}</span>
                   </button>`
                   )
                   .join("")}
               </div>`
            : ""
        }
      </div>`;
  }

  // List
  const q = (view.search || "").toLowerCase();
  return `
    <div class="roles-page" data-testid="roles-manager-container">
      <h2 class="roles-title">Cargos</h2>
      <p class="setting-desc">Use cargos para organizar os membros e dar permissões. A cor do cargo mais alto aparece no nome da pessoa.</p>
      <div class="roles-toolbar">
        <input type="search" class="form-input" id="roles-search-input" placeholder="Pesquisar cargos" value="${escapeHtml(view.search || "")}" autocomplete="off" />
        ${canManage ? `<button type="button" class="btn btn-primary" data-action="create-new-role" data-guild-id="${escapeHtml(guild.id)}" data-testid="create-role-btn">Criar cargo</button>` : ""}
      </div>
      <button type="button" class="role-row everyone" data-action="role-edit" data-role-id="everyone">
        <span class="role-dot" style="background:#99aab5;"></span>
        <span class="role-row-name">@everyone<span>Permissões padrão de todos os membros</span></span>
        <span class="role-row-icon" title="Permissões">${Icons.more || "⋯"}</span>
      </button>
      <div class="roles-table">
        <div class="roles-table-head"><span>Cargos — ${roles.length}</span><span>Membros</span><span></span></div>
        ${roles
          .map(
            (r) => `
          <div class="role-row" data-role-row data-role-name="${escapeHtml(r.name.toLowerCase())}" data-testid="role-item-${escapeHtml(r.id)}" ${q && !r.name.toLowerCase().includes(q) ? "hidden" : ""}>
            <span class="role-dot" style="background:${escapeHtml(r.color || "#99aab5")};"></span>
            <span class="role-row-name">${escapeHtml(r.name)}</span>
            <span class="role-row-count">${membersWith(r.id).length} ${Icons.friends}</span>
            <span class="role-row-actions">
              <button type="button" class="icon-btn" data-action="role-view-members" data-role-id="${escapeHtml(r.id)}" title="Ver membros com este cargo">👁</button>
              <button type="button" class="icon-btn" data-action="role-edit" data-role-id="${escapeHtml(r.id)}" title="Permissões e edição">⋯</button>
            </span>
          </div>`
          )
          .join("")}
        ${roles.length ? "" : `<p class="setting-desc">Nenhum cargo criado ainda.</p>`}
      </div>
    </div>`;
}

// ==========================================================================
// GIF Library picker
// Lives in its own container outside renderApp(), so app re-renders never touch
// it, and new pages are appended to the grid instead of rebuilding it (rebuilding
// re-downloaded and re-decoded every animation, which froze the UI).
// ==========================================================================
const GIF_PICKER_CATEGORIES = ["All", "Anime", "Gaming", "Gatos", "Reações", "Memes", "Cyberpunk", "Lofi", "Dança", "Celebração"];
const GIF_SEARCH_DEBOUNCE_MS = 300;
const gifView = { root: null, searchId: -1, rendered: 0, debounce: null };

function gifCardHtml(gif) {
  return `
    <button
      type="button"
      class="gif-item-card"
      data-action="pick-gif-item"
      data-gif-url="${escapeHtml(gif.url)}"
      data-gif-large-url="${escapeHtml(gif.largeUrl || gif.url)}"
      data-gif-title="${escapeHtml(gif.title)}"
      title="${escapeHtml(gif.title)}"
      data-testid="gif-card"
    >
      <img src="${escapeHtml(gif.previewUrl || gif.url)}" alt="${escapeHtml(gif.title)}" loading="lazy" decoding="async" />
      <span class="gif-item-overlay">${escapeHtml(gif.title)}</span>
    </button>
  `;
}

function mountGifPicker(gp) {
  const root = document.createElement("div");
  root.id = "gif-picker-root";
  root.className = "app-root theme-layer";
  root.innerHTML = `
    <div class="modal-backdrop" data-action="close-gif-picker-backdrop">
      <div class="modal-card wide gif-modal-box" data-testid="gif-picker-modal" role="dialog" aria-labelledby="gif-picker-title">
        <div class="modal-header">
          <div>
            <h2 id="gif-picker-title" style="font-size:18px;">Biblioteca de GIFs</h2>
            <div style="font-size:12px;color:var(--text-muted);">
              ${
                gp.target === "chat" || gp.target === "call"
                  ? "Escolha um GIF animado para enviar na conversa"
                  : `Escolha uma animação para ${gp.target === "avatar" ? "o seu avatar" : gp.target === "guild-banner" ? "o banner do servidor" : "o seu banner"}`
              }
            </div>
          </div>
          <button class="icon-btn" data-action="close-gif-picker" aria-label="Fechar">${Icons.close}</button>
        </div>
        <div class="gif-picker-controls">
          <form id="gif-search-form" class="gif-search-row" role="search">
            <input type="search" id="gif-search-input" class="form-input" placeholder="Pesquisar GIFs..." autocomplete="off" aria-label="Pesquisar GIFs" />
            <button type="submit" class="btn btn-primary">Buscar</button>
          </form>
          <div class="gif-categories-bar" role="tablist">
            ${GIF_PICKER_CATEGORIES.map(
              (c) => `<button type="button" role="tab" class="gif-cat-chip" data-action="select-gif-category" data-category="${c}">${c === "All" ? "Todos" : c}</button>`
            ).join("")}
          </div>
        </div>
        <div class="gif-results-scroller" id="gif-results-scroller">
          <div class="gif-grid" data-testid="gif-results-grid"></div>
          <div class="gif-status" id="gif-picker-status"></div>
        </div>
        <div class="modal-footer gif-picker-footer">
          <div id="gif-picker-count" style="font-size:12px;color:var(--text-muted);"></div>
          <button type="button" class="btn btn-secondary" data-action="close-gif-picker">Cancelar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  gifView.root = root;
  gifView.searchId = -1;
  gifView.rendered = 0;

  const input = root.querySelector("#gif-search-input");
  const runSearch = () => {
    clearTimeout(gifView.debounce);
    store.searchGifs({ query: input.value.trim(), category: store.getState().gifPicker.category });
  };
  root.querySelector("#gif-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });
  // Search as you type, once typing pauses
  input.addEventListener("input", () => {
    clearTimeout(gifView.debounce);
    gifView.debounce = setTimeout(runSearch, GIF_SEARCH_DEBOUNCE_MS);
  });

  const scroller = root.querySelector("#gif-results-scroller");
  scroller.addEventListener(
    "scroll",
    () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 400) store.loadMoreGifs();
    },
    { passive: true }
  );
  input.focus();
}

function unmountGifPicker() {
  clearTimeout(gifView.debounce);
  gifView.root?.remove();
  gifView.root = null;
}

function syncGifPicker(state) {
  const gp = state.gifPicker;
  if (!gp?.isOpen) {
    if (gifView.root) unmountGifPicker();
    return;
  }
  if (!gifView.root) mountGifPicker(gp);
  const root = gifView.root;
  root.setAttribute("data-theme", state.settings.theme);
  const grid = root.querySelector(".gif-grid");
  const results = gp.results || [];

  for (const chip of root.querySelectorAll(".gif-cat-chip")) {
    const active = chip.getAttribute("data-category").toLowerCase() === String(gp.category || "All").toLowerCase();
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-selected", String(active));
  }

  // New search: replace the grid. Same search: append only the new items.
  if (gp.searchId !== gifView.searchId) {
    gifView.searchId = gp.searchId;
    gifView.rendered = 0;
    grid.textContent = "";
    root.querySelector("#gif-results-scroller").scrollTop = 0;
  }
  if (results.length > gifView.rendered) {
    const tpl = document.createElement("template");
    tpl.innerHTML = results.slice(gifView.rendered).map(gifCardHtml).join("");
    grid.appendChild(tpl.content);
    gifView.rendered = results.length;
  }

  const status = root.querySelector("#gif-picker-status");
  let statusHtml = "";
  if (gp.loading && gifView.rendered === 0) {
    statusHtml = `<div class="gif-grid gif-skeleton-grid" aria-label="Carregando GIFs">${'<div class="gif-skeleton"></div>'.repeat(12)}</div>`;
  } else if (gp.loading) {
    statusHtml = `<div class="gif-status-line">Buscando...</div>`;
  } else if (results.length === 0) {
    statusHtml = `
      <div class="gif-empty">
        <div>Nenhum GIF encontrado para "${escapeHtml(gp.query || gp.category)}".</div>
        <button class="btn btn-secondary btn-sm" data-action="select-gif-category" data-category="All">Ver todos</button>
      </div>
    `;
  } else if (gp.loadingMore) {
    statusHtml = `<div class="gif-status-line">Carregando mais GIFs...</div>`;
  } else if (gp.hasMore) {
    statusHtml = `<div class="gif-status-line"><button type="button" class="btn btn-secondary btn-sm" data-action="load-more-gifs">Carregar mais</button></div>`;
  }
  if (status.innerHTML !== statusHtml) status.innerHTML = statusHtml;
  grid.classList.toggle("is-stale", Boolean(gp.loading && gifView.rendered > 0));

  root.querySelector("#gif-picker-count").textContent = results.length
    ? `${results.length} de ${gp.total || results.length} GIF(s)`
    : "";
}

// ==========================================================================
// Phase 8: Media Framing & Crop Editor (Avatar & Banner)
// ==========================================================================
function renderMediaEditorModal(state) {
  const me = state.mediaEditor;
  if (!me || !me.isOpen) return "";

  const isAvatar = me.target === "avatar";
  const scale = Number(me.scale || 1);
  const cropX = Number(me.cropX || 0);
  const cropY = Number(me.cropY || 0);
  const framing = mediaFramingStyle(scale, cropX, cropY);

  return `
    <div class="modal-backdrop" data-action="close-media-editor-backdrop">
      <div class="modal-card media-editor-box" data-testid="media-editor-modal" style="max-width:540px;">
        <div class="modal-header">
          <h2>✂️ Enquadrar & Ajustar ${isAvatar ? "Avatar" : "Banner"}</h2>
          <button class="icon-btn" data-action="close-media-editor">${Icons.close}</button>
        </div>
        <div class="modal-body" style="gap:16px;">
          <div style="background:#111214;padding:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${isAvatar ? `
              <div class="media-editor-crop-circle" style="width:160px;height:160px;border-radius:50%;overflow:hidden;border:3px solid var(--brand-purple);box-shadow:0 0 0 9999px rgba(0,0,0,0.65);position:relative;background:#202225;">
                <img
                  id="media-editor-preview-img"
                  src="${escapeHtml(me.mediaUrl)}"
                  alt="Pré-visualização"
                  style="width:100%;height:100%;object-fit:cover;${framing}"
                />
              </div>
            ` : `
              <div class="media-editor-crop-banner" style="width:360px;height:120px;border-radius:8px;overflow:hidden;border:3px solid var(--brand-purple);box-shadow:0 0 0 9999px rgba(0,0,0,0.65);position:relative;background:#202225;">
                <img
                  id="media-editor-preview-img"
                  src="${escapeHtml(me.mediaUrl)}"
                  alt="Pré-visualização"
                  style="width:100%;height:100%;object-fit:cover;${framing}"
                />
              </div>
            `}
          </div>

          <div style="background:var(--bg-channels);padding:14px;border-radius:8px;display:flex;flex-direction:column;gap:12px;">
            <div class="form-group">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <label class="form-label">Zoom da Imagem</label>
                <span id="editor-zoom-label" style="font-size:12px;color:var(--brand-purple);font-weight:700;">${scale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                id="media-editor-zoom-slider"
                data-testid="media-editor-zoom-slider"
                min="1.0"
                max="3.0"
                step="0.05"
                value="${scale}"
                style="width:100%;accent-color:var(--brand-purple);"
              />
            </div>

            <div style="display:flex;gap:12px;">
              <div class="form-group" style="flex:1;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <label class="form-label">Posição X</label>
                  <span id="editor-panx-label" style="font-size:11px;color:var(--text-muted);">${framingPercent(cropX)}%</span>
                </div>
                <input
                  type="range"
                  id="media-editor-panx-slider"
                  data-testid="media-editor-panx-slider"
                  min="-150"
                  max="150"
                  step="2"
                  value="${cropX}"
                  style="width:100%;accent-color:var(--brand-purple);"
                />
              </div>
              <div class="form-group" style="flex:1;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <label class="form-label">Posição Y</label>
                  <span id="editor-pany-label" style="font-size:11px;color:var(--text-muted);">${framingPercent(cropY)}%</span>
                </div>
                <input
                  type="range"
                  id="media-editor-pany-slider"
                  data-testid="media-editor-pany-slider"
                  min="-150"
                  max="150"
                  step="2"
                  value="${cropY}"
                  style="width:100%;accent-color:var(--brand-purple);"
                />
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;">
              <button type="button" class="btn btn-secondary" style="height:28px;font-size:11px;" data-action="center-media-editor" data-testid="media-editor-center-btn">
                🎯 Centralizar (1.0x, 0, 0)
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn btn-secondary" data-action="close-media-editor">Cancelar</button>
          <button type="button" class="btn btn-success" data-action="apply-media-editor" data-testid="apply-media-editor-btn">
            ✓ Aplicar e Salvar
          </button>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// Server Settings > Overview: name, icon and banner
// ==========================================================================
function canManageGuild(guild, me) {
  if (guild.ownerId === me.id) return true;
  const myRoleIds = (guild.members || []).find((m) => m.userId === me.id)?.roles || [];
  return guild.roles.some(
    (r) =>
      myRoleIds.includes(r.id) &&
      Array.isArray(r.permissions) &&
      (r.permissions.includes("ADMINISTRATOR") || r.permissions.includes("MANAGE_GUILD"))
  );
}

function renderServerOverview(guild, me) {
  const editable = canManageGuild(guild, me);
  const disabled = editable ? "" : "disabled";
  return `
    <h2 style="color:var(--header-primary);margin-bottom:16px;">Visão Geral do Servidor</h2>
    ${editable ? "" : `<div class="form-hint" style="margin-bottom:12px;">Você não tem permissão para editar este servidor.</div>`}
    <div style="background:var(--bg-channels);padding:16px;border-radius:8px;display:flex;flex-direction:column;gap:18px;" data-testid="server-overview">
      <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
          <div class="guild-icon-preview" style="background-color:${escapeHtml(guild.iconColor)};" data-testid="guild-icon-preview">
            ${guild.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="Ícone do servidor" />` : escapeHtml(guild.shortName)}
          </div>
          ${
            editable
              ? `<label class="btn btn-primary" style="height:30px;font-size:12px;cursor:pointer;">
                   Alterar Ícone
                   <input type="file" id="guild-icon-upload-input" data-testid="guild-icon-upload-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
                 </label>
                 ${guild.iconUrl ? `<button type="button" class="btn btn-secondary" style="height:30px;font-size:12px;" data-action="remove-guild-icon">Remover</button>` : ""}`
              : ""
          }
          <div style="font-size:11px;color:var(--text-muted);text-align:center;max-width:140px;">PNG, JPG, WEBP ou GIF animado</div>
        </div>
        <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:8px;">
          <label class="form-label" for="guild-name-input">Nome do Servidor</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="guild-name-input" class="form-input" style="flex:1;" maxlength="100" value="${escapeHtml(guild.name)}" data-testid="guild-name-input" ${disabled} />
            ${editable ? `<button type="button" class="btn btn-primary" style="height:36px;" data-action="save-guild-name" data-testid="save-guild-name-btn">Salvar</button>` : ""}
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:6px;">Membros: ${(guild.memberIds || []).length}</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <div class="form-label">Banner do Servidor</div>
        <div class="guild-banner-preview" data-testid="guild-banner-preview">
          ${guild.bannerUrl ? `<img src="${escapeHtml(guild.bannerUrl)}" alt="Banner do servidor" />` : `<span>Nenhum banner definido</span>`}
        </div>
        ${
          editable
            ? `<div style="display:flex;gap:8px;">
                 <label class="btn btn-primary" style="height:30px;font-size:12px;cursor:pointer;">
                   ${guild.bannerUrl ? "Alterar Banner" : "Enviar Banner"}
                   <input type="file" id="guild-banner-upload-input" data-testid="guild-banner-upload-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
                 </label>
                 <button type="button" class="btn btn-secondary btn-icon-text" style="height:30px;font-size:12px;" data-action="open-gif-picker" data-target="guild-banner" data-testid="guild-banner-gif-btn">
                   ${Icons.sparkles}<span>Adicionar GIF</span>
                 </button>
                 ${guild.bannerUrl ? `<button type="button" class="btn btn-secondary" style="height:30px;font-size:12px;" data-action="remove-guild-banner">Remover Banner</button>` : ""}
               </div>`
            : ""
        }
        <div style="font-size:11px;color:var(--text-muted);">Aparece no topo da lista de canais. Recomendado: 960×540 (16:9).</div>
      </div>

      <div class="setting-row" data-testid="guild-visibility-row">
        <div>
          <div class="setting-title">Servidor público</div>
          <div class="setting-desc">${guild.isPublic ? "Aparece em Explorar servidores e qualquer pessoa pode entrar sem convite." : "Privado: só entra quem recebe um convite. Ative para ele aparecer em Explorar servidores."}</div>
        </div>
        ${editable ? renderToggle({ on: Boolean(guild.isPublic), action: "toggle-guild-public", label: "Servidor público" }) : `<span class="setting-desc">${guild.isPublic ? "Público" : "Privado"}</span>`}
      </div>
      ${
        editable && guild.isPublic
          ? `<div style="display:flex;flex-direction:column;gap:8px;">
               <label class="form-label" for="guild-description-input">Descrição em Explorar servidores</label>
               <div style="display:flex;gap:8px;">
                 <input type="text" id="guild-description-input" class="form-input" style="flex:1;" maxlength="300" value="${escapeHtml(guild.description || "")}" placeholder="Sobre o que é o servidor?" />
                 <button type="button" class="btn btn-primary" style="height:36px;" data-action="save-guild-description">Salvar</button>
               </div>
             </div>`
          : ""
      }

      <div class="invite-cta-card">
        <div>
          <div class="invite-cta-title">Convide pessoas para ${escapeHtml(guild.name)}</div>
          <div class="invite-cta-sub">Gere um link do ${escapeHtml(getAppName())}, defina validade e limite de usos ou revogue convites ativos.</div>
        </div>
        <button class="btn btn-primary btn-lg" data-action="open-invite-modal" data-testid="overview-invite-btn">
          ${Icons.userPlus}
          Convidar Pessoas
        </button>
      </div>

      ${
        guild.ownerId === me.id
          ? `<div class="danger-zone">
               <div>
                 <div class="danger-zone-title">Apagar servidor</div>
                 <div class="danger-zone-sub">Remove o servidor para todos: canais, mensagens, cargos e convites. Não dá para desfazer.</div>
               </div>
               <button type="button" class="btn btn-danger" data-action="delete-guild" data-guild-id="${escapeHtml(guild.id)}" data-testid="delete-guild-btn">Apagar Servidor</button>
             </div>`
          : ""
      }
    </div>
  `;
}

// ==========================================================================
// Profile photo lightbox & incoming DM call card
// ==========================================================================
function renderExpandableAvatar(user) {
  const avatar = renderAvatar(user, "xl", true, "", { animate: true });
  if (!user?.avatarUrl) return avatar;
  return `
    <div class="avatar-expandable" data-action="expand-avatar" data-url="${escapeHtml(user.avatarUrl)}" data-name="${escapeHtml(user.displayName || "")}" title="Ver foto inteira" data-testid="expand-avatar-btn">
      ${avatar}
    </div>
  `;
}

function renderAvatarLightbox() {
  const lb = uiState.avatarLightbox;
  if (!lb) return "";
  return `
    <div class="modal-backdrop avatar-lightbox" data-action="close-avatar-lightbox" data-testid="avatar-lightbox">
      <img src="${escapeHtml(lb.url)}" alt="${escapeHtml(lb.name)}" />
    </div>
  `;
}

function renderIncomingCall(state) {
  const call = state.incomingCall;
  if (!call) return "";
  const caller = state.users[call.callerId];
  return `
    <div class="incoming-call-card" data-testid="incoming-call-card">
      ${renderAvatar(caller || { displayName: "?" }, "xl")}
      <div style="font-weight:700;color:var(--header-primary);font-size:16px;">${escapeHtml(caller?.displayName || "Alguém")}</div>
      <div style="font-size:12px;color:var(--text-muted);">está te ligando...</div>
      <div style="display:flex;gap:16px;margin-top:6px;">
        <button class="call-round-btn decline" data-action="decline-incoming-call" title="Recusar" data-testid="decline-call-btn">${Icons.phoneOff}</button>
        <button class="call-round-btn accept" data-action="accept-incoming-call" title="Atender" data-testid="accept-call-btn">${Icons.phone}</button>
      </div>
    </div>
  `;
}

// ==========================================================================
// Fullscreen Settings Overlay (Phases 3, 5, 6, 8)
// ==========================================================================
// ==========================================================================
// Settings panels: Voice, Profile & Account
// ==========================================================================
function renderToggle({ on, action, key = "", testid = "", label }) {
  return `
    <button
      type="button"
      class="toggle-switch ${on ? "on" : ""}"
      role="switch"
      aria-checked="${on ? "true" : "false"}"
      aria-label="${escapeHtml(label)}"
      title="${on ? "Ativado" : "Desativado"}"
      data-action="${action}"
      ${key ? `data-key="${key}"` : ""}
      ${testid ? `data-testid="${testid}"` : ""}
    ><span class="toggle-knob"></span></button>
  `;
}

function renderSettingsSlider({ id, labelId, label, value }) {
  return `
    <div class="settings-slider">
      <div class="settings-slider-head">
        <label class="form-label" for="${id}">${label}</label>
        <span class="settings-slider-value" id="${labelId}">${value}%</span>
      </div>
      <input type="range" class="range-input" id="${id}" data-testid="${id}" min="0" max="100" value="${value}" />
    </div>
  `;
}

// One row per system sound: title, preset picker, preview, upload and on/off
function renderSoundRow(s, { type, title, desc, previewLabel }) {
  const enabledKey = `${type}SoundEnabled`;
  const enabled = s[enabledKey] !== false;
  const preset = s[`${type}SoundPreset`];
  const customName = s[`${type}SoundCustomName`];
  return `
    <div class="sound-row ${enabled ? "" : "is-off"}">
      <div class="sound-row-main">
        <div class="sound-row-text">
          <div class="setting-title">${title}</div>
          <div class="setting-desc">${desc}</div>
        </div>
        ${renderToggle({ on: enabled, action: "toggle-setting", key: enabledKey, testid: `toggle-${type}-sound-btn`, label: title })}
      </div>
      <div class="sound-row-controls">
        <select class="form-input sound-select" id="${type}-sound-preset-select" data-testid="${type}-sound-preset-select" aria-label="Som: ${title}">
          ${SOUND_PRESETS.map((p) => `<option value="${p.id}" ${preset === p.id ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-secondary btn-icon-text" data-action="preview-${type}-sound" data-testid="preview-${type}-sound-btn" title="${previewLabel}">
          ${Icons.play}<span>Ouvir</span>
        </button>
        <label class="btn btn-secondary btn-icon-text" title="Enviar áudio .mp3, .wav ou .ogg">
          ${Icons.upload}<span>Enviar</span>
          <input type="file" id="${type}-sound-file-input" accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,.mp3,.wav,.ogg" style="display:none;" />
        </label>
      </div>
      ${customName ? `<div class="sound-row-file">Arquivo ativo: <strong>${escapeHtml(customName)}</strong></div>` : ""}
    </div>
  `;
}

// ==========================================================================
// Mute shortcut (global: works with the app in the background, e.g. in a game)
// ==========================================================================
function readMuteHotkey() {
  return window.DiscordNative?.hotkeys?.getMuteHotkey?.() || { accelerator: "", active: false };
}

// "CommandOrControl+Shift+M" -> ["Ctrl", "Shift", "M"]
function hotkeyParts(accelerator) {
  return String(accelerator || "")
    .split("+")
    .filter(Boolean)
    .map((p) => ({ CommandOrControl: "Ctrl", Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win", Space: "Espaço" })[p] || p);
}

// A keydown -> Electron accelerator ("" while only modifiers are held)
function acceleratorFromEvent(e) {
  const code = e.code || "";
  let key = "";
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (/^Numpad[0-9]$/.test(code)) key = "num" + code.slice(6);
  else {
    key = {
      Space: "Space",
      Backquote: "`",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Insert: "Insert",
      Delete: "Delete",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Pause: "Pause",
      CapsLock: "Capslock",
      PrintScreen: "PrintScreen",
      NumpadDecimal: "numdec",
      ScrollLock: "Scrolllock",
      NumpadAdd: "numadd",
      NumpadSubtract: "numsub",
      NumpadMultiply: "nummult",
      NumpadDivide: "numdiv"
    }[code] || "";
  }
  if (!key) return "";
  const mods = [];
  if (e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  // A single key alone is fine too (e.g. F8, Insert, or even a letter)
  return [...mods, key].join("+");
}

// A single key that is used for typing (letter, number, space...) stops
// typing in other programs while the app is open: worth a warning
function hotkeyTakesTypingKey(accelerator) {
  const parts = String(accelerator || "").split("+").filter(Boolean);
  return parts.length === 1 && !/^(F\d+|Pause|Scrolllock|Insert|Capslock|PrintScreen|Home|End|PageUp|PageDown|Delete)$/.test(parts[0]);
}

function renderMuteHotkeyCard() {
  const { accelerator } = readMuteHotkey();
  const recording = uiState.recordingMuteHotkey;
  const keys = hotkeyParts(accelerator);
  return `
    <section class="settings-card" data-testid="mute-hotkey-card">
      <div class="settings-card-head">
        <div>
          <h3>Atalho para mutar o microfone</h3>
          <p>Liga e desliga o microfone de qualquer lugar, mesmo com o app em segundo plano (por exemplo, num jogo). Pode ser uma tecla só (como F8 ou Insert) ou uma combinação (como Ctrl + Shift + M).</p>
        </div>
      </div>
      <div class="hotkey-row">
        <div class="hotkey-display ${recording ? "recording" : ""}" data-testid="mute-hotkey-display">
          ${
            recording
              ? `<span class="hotkey-hint">Pressione uma tecla ou uma combinação... (Esc cancela)</span>`
              : keys.length
                ? keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('<span class="hotkey-plus">+</span>')
                : `<span class="hotkey-hint">Sem atalho</span>`
          }
        </div>
        ${
          recording
            ? `<button type="button" class="btn btn-secondary btn-sm" data-action="cancel-mute-hotkey">Cancelar</button>`
            : `<button type="button" class="btn btn-primary btn-sm" data-action="record-mute-hotkey" data-testid="change-mute-hotkey-btn">Alterar atalho</button>
               ${accelerator ? `<button type="button" class="btn btn-secondary btn-sm" data-action="clear-mute-hotkey">Remover</button>` : ""}`
        }
      </div>
      ${
        !recording && hotkeyTakesTypingKey(accelerator)
          ? `<div class="inline-feedback warn" data-testid="mute-hotkey-warning">Uma tecla de digitação sozinha para de escrever em outros programas enquanto o app estiver aberto. Prefira F1–F12, Insert ou Pause.</div>`
          : ""
      }
      ${uiState.muteHotkeyError ? `<div class="inline-feedback err">${escapeHtml(uiState.muteHotkeyError)}</div>` : ""}
    </section>
  `;
}

function saveMuteHotkey(accelerator) {
  const res = window.DiscordNative?.hotkeys?.setMuteHotkey?.(accelerator) || { ok: false, error: "Disponível só no app instalado." };
  uiState.recordingMuteHotkey = false;
  uiState.muteHotkeyError = res.ok ? "" : res.error;
  renderApp();
  if (res.ok) showToast(accelerator ? `Atalho de mutar: ${hotkeyParts(accelerator).join(" + ")}` : "Atalho de mutar removido.");
}

// While recording, the next key combination becomes the shortcut
document.addEventListener(
  "keydown",
  (e) => {
    if (!uiState.recordingMuteHotkey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      uiState.recordingMuteHotkey = false;
      uiState.muteHotkeyError = "";
      renderApp();
      return;
    }
    const accelerator = acceleratorFromEvent(e);
    if (accelerator === "") return; // only modifiers so far
    saveMuteHotkey(accelerator);
  },
  true
);

function renderVoiceSettingsPanel(state) {
  const s = state.settings;
  const inputs = uiState.audioInputDevices.length > 0
    ? uiState.audioInputDevices
    : [{ deviceId: "default", label: "Microfone padrão do sistema" }];
  const outputs = uiState.audioOutputDevices.length > 0
    ? uiState.audioOutputDevices
    : [{ deviceId: "default", label: "Alto-falantes / fones padrão" }];

  return `
    <div class="settings-page-head">
      <h2>Voz, Vídeo & Sons</h2>
      <p>Escolha seus dispositivos, teste o microfone e personalize os sons de chamada.</p>
    </div>

    ${renderMuteHotkeyCard()}

    <section class="settings-card" data-testid="audio-devices-config-panel">
      <div class="settings-card-head">
        <h3>Dispositivos</h3>
      </div>
      <div class="settings-grid-2">
        <div class="form-group">
          <label class="form-label" for="audio-input-device-select">Entrada (microfone)</label>
          <select class="form-input" id="audio-input-device-select" data-testid="audio-input-device-select">
            ${inputs.map((d) => `<option value="${d.deviceId}" ${s.voiceInputDeviceId === d.deviceId || uiState.selectedAudioInput === d.deviceId ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="audio-output-device-select">Saída (alto-falantes / fones)</label>
          <select class="form-input" id="audio-output-device-select" data-testid="audio-output-device-select">
            ${outputs.map((d) => `<option value="${d.deviceId}" ${s.voiceOutputDeviceId === d.deviceId || uiState.selectedAudioOutput === d.deviceId ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="mic-test-box">
        <div class="mic-test-head">
          <div>
            <div class="setting-title">Teste de microfone</div>
            <div class="setting-desc">Fale normalmente: a barra mostra o volume captado em tempo real.</div>
          </div>
          <div class="btn-row">
            <button
              type="button"
              class="btn ${uiState.isTestingMic ? "btn-danger" : "btn-primary"} btn-sm"
              data-action="toggle-mic-test"
              data-testid="toggle-mic-test-btn"
            >${uiState.isTestingMic ? "Parar teste" : "Testar microfone"}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="test-output-device" data-testid="test-output-device-btn">
              Testar saída
            </button>
          </div>
        </div>
        <div class="mic-meter-track ${uiState.isTestingMic ? "live" : ""}" data-testid="mic-meter-track">
          <div id="mic-test-meter-fill" class="mic-meter-fill" data-testid="mic-meter-fill" style="width:${uiState.micTestLevel || 0}%;"></div>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-title">Supressão de ruído</div>
          <div class="setting-desc">Filtro inteligente (RNNoise) que tira teclado, ventilador, barulho de rua e outros sons de fundo, deixando só a voz. Vale para o seu microfone e para o que você ouve dos outros.</div>
        </div>
        ${renderToggle({ on: state.voice.noiseSuppression, action: "toggle-krisp", label: "Supressão de ruído" })}
      </div>
    </section>

    <section class="settings-card" data-testid="call-sounds-config-panel">
      <div class="settings-card-head">
        <div>
          <h3>Sons de chamada</h3>
          <p>Tocados quando você entra na call e quando você ou outra pessoa sai dela.</p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="restore-default-sounds" data-testid="restore-default-sounds-btn">Restaurar padrão</button>
      </div>
      ${renderSettingsSlider({ id: "call-sound-volume-slider", labelId: "call-sound-vol-label", label: "Volume dos sons de chamada", value: Number(s.callSoundVolume ?? 80) })}
      <div class="sound-list">
        ${renderSoundRow(s, { type: "join", title: "Entrar na chamada", desc: "Quando você se conecta a um canal de voz", previewLabel: "Ouvir som de entrada" })}
        ${renderSoundRow(s, { type: "leave", title: "Sair da chamada", desc: "Quando você ou outra pessoa sai da call", previewLabel: "Ouvir som de saída" })}
      </div>
    </section>

    <section class="settings-card" data-testid="mute-sounds-config-panel">
      <div class="settings-card-head">
        <div>
          <h3>Sons do microfone</h3>
          <p>Alerta curto ao mutar e desmutar (cliques repetidos em menos de 200 ms são ignorados).</p>
        </div>
      </div>
      ${renderSettingsSlider({ id: "mute-sound-volume-slider", labelId: "mute-sound-vol-label", label: "Volume dos sons de mute", value: Number(s.muteSoundVolume ?? 80) })}
      <div class="sound-list">
        ${renderSoundRow(s, { type: "mute", title: "Silenciar microfone", desc: "Quando você muta seu microfone", previewLabel: "Ouvir som de mute" })}
        ${renderSoundRow(s, { type: "unmute", title: "Ativar microfone", desc: "Quando você desmuta seu microfone", previewLabel: "Ouvir som de unmute" })}
      </div>
    </section>
  `;
}

function renderStagedMediaBar({ label, confirmAction, cancelAction, confirmTestid }) {
  return `
    <div class="staged-bar">
      <span>${label}</span>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary btn-sm" data-action="${cancelAction}">Cancelar</button>
        <button type="button" class="btn btn-success btn-sm" data-action="${confirmAction}" data-testid="${confirmTestid}">Salvar</button>
      </div>
    </div>
  `;
}

function renderProfileSettingsPanel(me) {
  const previewUser = {
    ...me,
    avatarUrl: uiState.stagedAvatar ? uiState.stagedAvatar.url : me.avatarUrl,
    bannerUrl: uiState.stagedBanner !== null ? uiState.stagedBanner.url : me.bannerUrl,
    bannerColor: uiState.stagedBannerColor || me.bannerColor || "#5865f2",
    bannerPositionY: uiState.stagedBannerPosY !== null ? uiState.stagedBannerPosY : me.bannerPositionY ?? 50
  };
  const bannerMode = uiState.bannerEditorMode || (previewUser.bannerUrl ? "image" : "color");

  const avatarSection = `
    <section class="settings-card" data-testid="media-customization-section">
      <div class="settings-card-head">
        <div>
          <h3>Foto de perfil</h3>
          <p>PNG, JPG, WEBP ou GIF animado.</p>
        </div>
      </div>
      <div class="media-editor-row">
        <div class="media-thumb round">${renderAvatar(previewUser, "", false, "width:56px;height:56px;min-width:56px;font-size:20px;")}</div>
        <div class="btn-row wrap">
          <label class="btn btn-primary btn-sm btn-icon-text" style="cursor:pointer;">
            ${Icons.upload}<span>Enviar foto</span>
            <input type="file" id="avatar-upload-input" data-testid="avatar-upload-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
          </label>
          <button type="button" class="btn btn-secondary btn-sm btn-icon-text" data-action="open-gif-picker" data-target="avatar" data-testid="open-gif-picker-avatar-btn">
            ${Icons.sparkles}<span>GIFs</span>
          </button>
          ${
            previewUser.avatarUrl
              ? `<button type="button" class="icon-square-btn" data-action="open-media-editor" data-target="avatar" data-url="${escapeHtml(previewUser.avatarUrl)}" data-testid="open-media-editor-avatar-btn" title="Enquadrar e zoom" aria-label="Enquadrar e zoom">${Icons.crop}</button>`
              : ""
          }
          ${
            me.avatarUrl
              ? `<button type="button" class="icon-square-btn danger" data-action="remove-avatar" data-testid="remove-avatar-btn" title="Remover foto" aria-label="Remover foto">${Icons.trash}</button>`
              : ""
          }
        </div>
      </div>
      ${uiState.stagedAvatar ? renderStagedMediaBar({ label: "Nova foto pronta para salvar.", confirmAction: "confirm-staged-avatar", cancelAction: "cancel-staged-avatar", confirmTestid: "confirm-avatar-btn" }) : ""}
    </section>
  `;

  const bannerColorEditor = `
    <div class="color-swatch-row">
      ${BANNER_SWATCHES.map(
        (c) => `
        <button
          type="button"
          class="color-swatch-btn ${previewUser.bannerColor === c ? "active" : ""}"
          style="background:${c};"
          data-action="select-banner-swatch"
          data-color="${c}"
          data-testid="banner-swatch-${c.replace("#", "")}"
          title="${c}"
          aria-label="Cor ${c}"
        ></button>
      `
      ).join("")}
      <label class="color-custom-btn" title="Cor personalizada">
        <input type="color" id="custom-banner-color-picker" data-testid="custom-banner-color-picker" value="${escapeHtml(previewUser.bannerColor)}" />
        <span>+</span>
      </label>
    </div>
    <button type="button" class="link-btn" data-action="restore-default-banner-color">Restaurar cor padrão</button>
  `;

  const bannerImageEditor = `
    <div class="btn-row wrap">
      <label class="btn btn-primary btn-sm btn-icon-text" style="cursor:pointer;">
        ${Icons.upload}<span>${previewUser.bannerUrl ? "Trocar imagem" : "Enviar imagem"}</span>
        <input type="file" id="banner-upload-input" data-testid="banner-upload-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
      </label>
      <button type="button" class="btn btn-secondary btn-sm btn-icon-text" data-action="open-gif-picker" data-target="banner" data-testid="open-gif-picker-banner-btn">
        ${Icons.sparkles}<span>GIFs</span>
      </button>
      ${
        previewUser.bannerUrl
          ? `<button type="button" class="icon-square-btn" data-action="open-media-editor" data-target="banner" data-url="${escapeHtml(previewUser.bannerUrl)}" data-testid="open-media-editor-banner-btn" title="Enquadrar e zoom" aria-label="Enquadrar e zoom">${Icons.crop}</button>`
          : ""
      }
      ${
        me.bannerUrl
          ? `<button type="button" class="icon-square-btn danger" data-action="remove-banner-image" data-testid="remove-banner-btn" title="Remover imagem do banner" aria-label="Remover imagem do banner">${Icons.trash}</button>`
          : ""
      }
    </div>
    ${uiState.stagedBanner ? renderStagedMediaBar({ label: "Nova imagem de banner pronta para salvar.", confirmAction: "confirm-staged-banner", cancelAction: "cancel-staged-banner", confirmTestid: "confirm-banner-btn" }) : ""}
    ${
      previewUser.bannerUrl
        ? `<div class="settings-slider">
            <div class="settings-slider-head">
              <label class="form-label" for="banner-pos-slider">Posição vertical</label>
              <span class="settings-slider-value" id="banner-pos-label">${Number(previewUser.bannerPositionY)}%</span>
            </div>
            <input type="range" class="range-input" id="banner-pos-slider" data-testid="banner-pos-slider" min="0" max="100" value="${Number(previewUser.bannerPositionY)}" />
          </div>`
        : `<div class="setting-desc">Sem imagem, o banner usa a cor escolhida na aba “Cor”.</div>`
    }
  `;

  const bannerSection = `
    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h3>Banner</h3>
          <p>Use uma cor sólida ou uma imagem/GIF.</p>
        </div>
        <div class="segmented" role="tablist">
          <button type="button" role="tab" aria-selected="${bannerMode === "color"}" class="${bannerMode === "color" ? "active" : ""}" data-action="set-banner-editor-mode" data-mode="color">Cor</button>
          <button type="button" role="tab" aria-selected="${bannerMode === "image"}" class="${bannerMode === "image" ? "active" : ""}" data-action="set-banner-editor-mode" data-mode="image">Imagem / GIF</button>
        </div>
      </div>
      ${bannerMode === "color" ? bannerColorEditor : bannerImageEditor}
    </section>
  `;

  const infoSection = `
    <form id="user-profile-form" class="settings-card">
      <div class="settings-card-head"><h3>Sobre você</h3></div>
      <div class="form-group">
        <label class="form-label" for="profile-display-name">Nome de exibição</label>
        <input class="form-input" id="profile-display-name" name="displayName" maxlength="32" value="${escapeHtml(me.displayName)}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="profile-custom-status">Status personalizado</label>
        <input class="form-input" id="profile-custom-status" name="customStatus" maxlength="128" placeholder="O que você está fazendo?" value="${escapeHtml(me.customStatus || "")}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="profile-about-me">Sobre mim</label>
        <textarea class="form-input form-textarea" id="profile-about-me" name="aboutMe" maxlength="190" rows="3" placeholder="Conte um pouco sobre você">${escapeHtml(me.aboutMe || "")}</textarea>
      </div>
      <div class="btn-row end">
        <button type="submit" class="btn btn-success">Salvar alterações</button>
      </div>
    </form>
  `;

  const previewCard = `
    <aside class="profile-preview-col">
      <div class="form-label" style="margin-bottom:8px;">Pré-visualização</div>
      <div class="profile-preview-card" data-testid="profile-preview-card">
        ${renderBanner(previewUser, 104)}
        <div class="profile-preview-body">
          <div class="profile-preview-avatar">${renderExpandableAvatar(previewUser)}</div>
          <div class="profile-preview-name">${escapeHtml(me.displayName)}</div>
          <div class="profile-preview-username" data-testid="settings-current-username">@${escapeHtml(me.username)}</div>
          ${me.customStatus ? `<div class="profile-preview-status">${escapeHtml(me.customStatus)}</div>` : ""}
          ${
            me.aboutMe
              ? `<div class="profile-preview-divider"></div>
                 <div class="form-label" style="margin-bottom:4px;">Sobre mim</div>
                 <div class="profile-preview-about">${escapeHtml(me.aboutMe)}</div>`
              : ""
          }
        </div>
      </div>
    </aside>
  `;

  return `
    <div class="settings-page-head">
      <h2>Perfil</h2>
      <p>Como as outras pessoas veem você. As alterações aparecem na pré-visualização ao lado.</p>
    </div>
    <div class="profile-settings-layout">
      <div class="profile-settings-main">
        ${avatarSection}
        ${bannerSection}
        ${infoSection}
      </div>
      ${previewCard}
    </div>
  `;
}

function formatDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderAccountFeedback(scope) {
  const parts = [];
  const fb = uiState.accountFeedback;
  if (fb && fb.scope === scope) {
    parts.push(`<div class="inline-feedback ${fb.ok ? "ok" : "err"}" role="status">${escapeHtml(fb.msg)}</div>`);
  }
  const dev = uiState.accountDevCode;
  if (dev && dev.scope === scope) {
    parts.push(`
      <div class="dev-code-note" data-testid="account-dev-code">
        <strong>Modo desenvolvimento:</strong> envio de e-mail não configurado, então o código não foi enviado.
        Use <code>${escapeHtml(dev.code)}</code> para testar.
      </div>
    `);
  }
  return parts.join("");
}

function renderCodeForm({ purpose, sentTo, scope, allowResend, changeLabel }) {
  return `
    <form class="account-editor" data-account-form="code" data-purpose="${purpose}" data-scope="${scope}">
      <div class="setting-desc">Digite o código de 6 dígitos enviado para <strong>${escapeHtml(sentTo)}</strong>. Ele expira em 10 minutos.</div>
      <div class="code-input-row">
        <input class="form-input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000" aria-label="Código de verificação" required />
        <button type="submit" class="btn btn-primary" ${uiState.accountBusy ? "disabled" : ""}>Confirmar</button>
      </div>
      <div class="btn-row">
        ${allowResend ? `<button type="button" class="link-btn" data-action="account-resend-email-verify">Reenviar código</button>` : ""}
        <button type="button" class="link-btn" data-action="account-cancel-pending" data-purpose="${purpose}">${changeLabel}</button>
      </div>
      ${renderAccountFeedback(scope)}
    </form>
  `;
}

function renderAccountSettingsPanel(me) {
  const sec = uiState.accountSecurity;
  const panel = uiState.accountPanel;

  // @username editor (availability is checked live while typing)
  const currentDraft = uiState.usernameDraft !== null ? uiState.usernameDraft : me.username;
  const avail = uiState.usernameAvailability;
  let availBadgeHtml = "";
  if (avail) {
    if (avail.checking) {
      availBadgeHtml = `<span class="availability-badge checking" data-testid="username-availability-badge">Verificando...</span>`;
    } else if (avail.available) {
      availBadgeHtml = `<span class="availability-badge ok" data-testid="username-availability-badge">✓ @${escapeHtml(avail.normalized)} disponível</span>`;
    } else {
      availBadgeHtml = `<span class="availability-badge err" data-testid="username-availability-badge">✕ ${escapeHtml(avail.message || "Indisponível")}</span>`;
    }
  }

  const usernameRow = `
    <div class="account-row" data-testid="username-editor-section">
      <div class="account-row-icon">${Icons.at}</div>
      <div class="account-row-body">
        <div class="setting-title">Nome de usuário</div>
        <div class="account-row-value">@${escapeHtml(me.username)}</div>
        ${
          panel === "username"
            ? `<form id="username-update-form" class="account-editor">
                <div class="setting-desc">Letras minúsculas, números, ponto (.) e sublinhado (_), de 3 a 32 caracteres.</div>
                <div class="prefixed-input">
                  <span>@</span>
                  <input type="text" id="settings-username-input" data-testid="settings-username-input" name="newUsername" value="${escapeHtml(currentDraft)}" autocomplete="off" required />
                </div>
                <div class="btn-row space">
                  ${availBadgeHtml || "<span></span>"}
                  <button type="submit" class="btn btn-primary btn-sm" data-testid="save-username-btn">Salvar</button>
                </div>
                ${
                  uiState.usernameSaveStatus
                    ? `<div data-testid="username-save-feedback" class="inline-feedback ${uiState.usernameSaveStatus.ok ? "ok" : "err"}">${escapeHtml(uiState.usernameSaveStatus.msg)}</div>`
                    : ""
                }
              </form>`
            : ""
        }
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="account-toggle-panel" data-panel="username" data-testid="edit-username-btn">${panel === "username" ? "Fechar" : "Editar"}</button>
    </div>
  `;

  if (!sec) {
    return `
      <div class="settings-page-head">
        <h2>Minha Conta</h2>
        <p>E-mail e senha usados para entrar e proteger sua conta.</p>
      </div>
      <section class="settings-card account-list">${usernameRow}</section>
      <section class="settings-card"><div class="setting-desc">Carregando dados de segurança da conta...</div></section>
    `;
  }

  // E-mail
  let emailEditor = "";
  if (sec.pendingEmailChange) {
    emailEditor = renderCodeForm({ purpose: "email_change", sentTo: sec.pendingEmailChange.masked, scope: "email", allowResend: false, changeLabel: "Usar outro e-mail" });
  } else if (sec.pendingEmailVerify) {
    emailEditor = renderCodeForm({ purpose: "email_verify", sentTo: sec.pendingEmailVerify.masked, scope: "email", allowResend: true, changeLabel: "Cancelar verificação" });
  } else if (panel === "email") {
    emailEditor = `
      <form class="account-editor" data-account-form="email-change">
        <div class="form-group">
          <label class="form-label" for="account-new-email">Novo e-mail</label>
          <input class="form-input" id="account-new-email" name="newEmail" type="email" autocomplete="email" placeholder="voce@exemplo.com" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="account-email-password">Senha atual</label>
          <input class="form-input" id="account-email-password" name="currentPassword" type="password" autocomplete="current-password" required />
        </div>
        <div class="btn-row end">
          <button type="submit" class="btn btn-primary btn-sm" ${uiState.accountBusy ? "disabled" : ""}>Enviar código de confirmação</button>
        </div>
        ${renderAccountFeedback("email")}
      </form>
    `;
  } else {
    emailEditor = renderAccountFeedback("email");
  }
  const emailPending = sec.pendingEmailChange || sec.pendingEmailVerify;
  const emailRow = `
    <div class="account-row" data-testid="account-email-row">
      <div class="account-row-icon">${Icons.mail}</div>
      <div class="account-row-body">
        <div class="setting-title">
          E-mail
          <span class="status-pill ${sec.emailVerified ? "ok" : "warn"}">${sec.emailVerified ? "Verificado" : "Não verificado"}</span>
        </div>
        <div class="account-row-value">${escapeHtml(sec.email)}</div>
        ${emailEditor}
      </div>
      <div class="btn-row">
        ${!sec.emailVerified && !emailPending ? `<button type="button" class="btn btn-primary btn-sm" data-action="account-request-email-verify" data-testid="verify-email-btn">Verificar</button>` : ""}
        ${!emailPending ? `<button type="button" class="btn btn-secondary btn-sm" data-action="account-toggle-panel" data-panel="email" data-testid="change-email-btn">${panel === "email" ? "Fechar" : "Alterar"}</button>` : ""}
      </div>
    </div>
  `;

  // Password
  const passwordRow = `
    <div class="account-row" data-testid="account-password-row">
      <div class="account-row-icon">${Icons.lock}</div>
      <div class="account-row-body">
        <div class="setting-title">Senha</div>
        <div class="account-row-value muted">${sec.passwordUpdatedAt ? `Alterada em ${escapeHtml(formatDateTime(sec.passwordUpdatedAt))}` : "••••••••••"}</div>
        ${
          panel === "password"
            ? `<form class="account-editor" data-account-form="password">
                <div class="form-group">
                  <label class="form-label" for="account-current-password">Senha atual</label>
                  <input class="form-input" id="account-current-password" name="currentPassword" type="password" autocomplete="current-password" required />
                </div>
                <div class="settings-grid-2">
                  <div class="form-group">
                    <label class="form-label" for="account-new-password">Nova senha</label>
                    <input class="form-input" id="account-new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="account-confirm-password">Confirmar nova senha</label>
                    <input class="form-input" id="account-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
                  </div>
                </div>
                <div class="setting-desc">Mínimo de 8 caracteres, com letras e números.</div>
                <div class="btn-row end">
                  <button type="submit" class="btn btn-primary btn-sm" ${uiState.accountBusy ? "disabled" : ""}>Alterar senha</button>
                </div>
                ${renderAccountFeedback("password")}
              </form>`
            : renderAccountFeedback("password")
        }
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="account-toggle-panel" data-panel="password" data-testid="change-password-btn">${panel === "password" ? "Fechar" : "Alterar"}</button>
    </div>
  `;

  const providerNote = !sec.providers.email
    ? `<div class="provider-note">
        ${Icons.alert}
        <div>
          <strong>Envio de e-mail não configurado.</strong>
          Os códigos de verificação aparecem aqui na tela em vez de serem enviados.
          Para enviar por e-mail, preencha <code>supabase</code> no <code>app.config.json</code> (passo a passo no README).
        </div>
      </div>`
    : "";

  return `
    <div class="settings-page-head">
      <h2>Minha Conta</h2>
      <p>E-mail e senha usados para entrar e proteger sua conta.</p>
    </div>

    <section class="account-summary">
      ${renderAvatar(me, "", false, "width:64px;height:64px;min-width:64px;font-size:22px;")}
      <div style="min-width:0;flex:1;">
        <div class="account-summary-name">${escapeHtml(me.displayName)}</div>
        <div class="account-summary-sub">@${escapeHtml(me.username)}</div>
      </div>
      <div class="account-summary-security ${sec.emailVerified ? "ok" : ""}" data-testid="account-security-badge">
        ${Icons.shieldCheck}
        <span>${sec.emailVerified ? "E-mail verificado" : "E-mail não verificado"}</span>
      </div>
    </section>

    ${providerNote}

    <section class="settings-card account-list">
      ${usernameRow}
      ${emailRow}
      ${passwordRow}
    </section>

    <section class="settings-card" style="margin-top:16px;" data-testid="account-startup-card">
      <div class="settings-card-head">
        <div>
          <h3>Inicialização do Sistema</h3>
          <p>Inicie o ${escapeHtml(getAppName())} automaticamente quando o Windows ligar.</p>
        </div>
        <button
          type="button"
          class="btn ${NativeBridge.getOpenOnStartup() ? "btn-success" : "btn-secondary"} btn-sm"
          data-action="toggle-open-on-startup"
          data-testid="account-open-on-startup-toggle"
        >
          ${NativeBridge.getOpenOnStartup() ? "✓ Iniciar com o Windows (Ativo)" : "Ativar Iniciar com o Windows"}
        </button>
      </div>
    </section>
  `;
}

function renderSettingsOverlay(state) {
  if (!uiState.settingsOverlay) return "";
  const { type, tab } = uiState.settingsOverlay;

  if (type === "server") {
    const guild = store.getActiveGuild();
    if (!guild) return "";
    const me = store.getCurrentUser();
    return `
      <div class="settings-overlay" data-testid="server-settings-overlay">
        <div class="settings-sidebar">
          <div class="settings-nav">
            <div class="settings-section-label">${escapeHtml(guild.name)}</div>
            <button class="settings-nav-item ${tab === "overview" ? "active" : ""}" data-action="settings-tab" data-type="server" data-tab="overview">Visão Geral</button>
            <button class="settings-nav-item ${tab === "roles" ? "active" : ""}" data-action="settings-tab" data-type="server" data-tab="roles" data-testid="server-settings-roles-tab">Cargos (${guild.roles.length})</button>
            ${store.can("VIEW_AUDIT_LOG", guild) ? `<button class="settings-nav-item ${tab === "audit" ? "active" : ""}" data-action="settings-tab" data-type="server" data-tab="audit">Registro de Auditoria (${guild.auditLog.length})</button>` : ""}
          </div>
        </div>
        <div class="settings-content-wrap">
          <div class="settings-main-panel">
            ${
              tab === "roles"
                ? renderServerRolesManager(guild, me)
                : tab === "audit"
                  ? `
                <h2 style="color:var(--header-primary);margin-bottom:16px;">Registro de Auditoria</h2>
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${guild.auditLog
                    .map(
                      (a) => `
                    <div style="background:var(--bg-channels);padding:12px 16px;border-radius:6px;display:flex;justify-content:space-between;">
                      <div>
                        <strong style="color:var(--header-primary);">${escapeHtml(a.actor)}</strong>
                        <span style="color:var(--text-normal);margin-left:6px;">${escapeHtml(a.action)}</span>
                      </div>
                      <span style="font-size:12px;color:var(--text-muted);">${escapeHtml(a.time)}</span>
                    </div>
                  `
                    )
                    .join("")}
                </div>
              `
                  : `
                ${renderServerOverview(guild, me)}
              `
            }
          </div>
          <div class="esc-close-col">
            <button class="esc-circle-btn" data-action="close-settings-overlay">${Icons.close}</button>
            <span style="font-size:11px;font-weight:700;color:var(--text-muted);">ESC</span>
          </div>
        </div>
      </div>
    `;
  }

  // User Settings Overlay
  const me = store.getCurrentUser();
  const s = state.settings;

  let panelHtml = "";

  // Phase 8: 10 Preset Themes in Appearance
  if (tab === "appearance") {
    panelHtml = `
      <h2 style="color:var(--header-primary);margin-bottom:6px;">Aparência</h2>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">
        Escolha entre ${AVAILABLE_THEMES.length} temas predefinidos (incluindo o novo tema Kamui abissal) com aplicação imediata e persistência automática.
      </p>
      <div style="background:var(--bg-channels);padding:18px;border-radius:8px;display:flex;flex-direction:column;gap:20px;">
        <div>
          <div class="form-label" style="margin-bottom:10px;">Temas do Aplicativo (${AVAILABLE_THEMES.length} Opções)</div>
          <div class="theme-grid" data-testid="theme-selector-grid">
            ${AVAILABLE_THEMES.map((t) => {
              const isActive = s.theme === t.id || (s.theme === "onyx" && t.id === "oled");
              return `
                <button
                  class="theme-card ${isActive ? "active" : ""}"
                  data-action="set-theme"
                  data-theme="${t.id}"
                  data-testid="theme-card-${t.id}"
                >
                  <div class="theme-swatch-preview">
                    ${t.colors
                      .map((c) => `<div style="flex:1;height:100%;background:${c};"></div>`)
                      .join("")}
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                    <strong style="font-size:13px;color:var(--header-primary);">${escapeHtml(t.name)}</strong>
                    ${isActive ? `<span style="font-size:11px;color:var(--status-green);font-weight:700;">✓</span>` : ""}
                  </div>
                  <span style="font-size:11px;color:var(--text-muted);line-height:1.3;">${escapeHtml(t.description)}</span>
                </button>
              `;
            }).join("")}
          </div>
        </div>
        ${s.theme === "kamui" ? renderKamuiAccentPicker() : ""}
        <div class="scale-settings">
          <div class="settings-slider">
            <div class="settings-slider-head">
              <label class="form-label" for="ui-zoom-range">Tamanho da interface (tudo: textos, ícones e botões)</label>
              <span class="settings-slider-value" id="ui-zoom-label">${Math.round((window.DiscordNative?.app?.getZoomFactor?.() || 1) * 100)}%</span>
            </div>
            <input type="range" class="range-input" id="ui-zoom-range" data-testid="ui-zoom-range" min="70" max="150" step="5" value="${Math.round((window.DiscordNative?.app?.getZoomFactor?.() || 1) * 100)}" />
          </div>
          <div class="settings-slider">
            <div class="settings-slider-head">
              <label class="form-label" for="font-scale-range">Tamanho do texto das mensagens</label>
              <span class="settings-slider-value" id="font-scale-label">${Math.round((s.fontScale || 1) * 100)}%</span>
            </div>
            <input type="range" class="range-input" id="font-scale-range" data-testid="font-scale-range" min="80" max="160" step="5" value="${Math.round((s.fontScale || 1) * 100)}" />
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="reset-ui-scale">Voltar ao padrão</button>
        </div>
        <div>
          <div class="form-label" style="margin-bottom:8px;">Densidade das Mensagens</div>
          <div style="display:flex;gap:10px;">
            <button class="btn ${s.messageDisplay === "cozy" ? "btn-primary" : "btn-secondary"}" data-action="set-density" data-density="cozy">Confortável (Avatares Visíveis)</button>
            <button class="btn ${s.messageDisplay === "compact" ? "btn-primary" : "btn-secondary"}" data-action="set-density" data-density="compact">Compacto (Estilo IRC)</button>
          </div>
        </div>
      </div>
    `;
  } else if (tab === "voice") {
    panelHtml = renderVoiceSettingsPanel(state);
  } else if (tab === "windows") {
    const openOnStartup = NativeBridge.getOpenOnStartup();
    const checkboxRow = ({ id, checked, title, desc, testid }) => `
      <label class="checkbox-row" for="${id}">
        <input type="checkbox" class="checkbox-input" id="${id}" data-testid="${testid}" ${checked ? "checked" : ""} />
        <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
        <span class="checkbox-text">
          <span class="setting-title">${title}</span>
          <span class="setting-desc">${desc}</span>
        </span>
      </label>
    `;
    panelHtml = `
      <div class="settings-page-head">
        <h2>Windows & Memória</h2>
        <p>Como o ${escapeHtml(getAppName())} inicia, fecha e usa a memória do computador.</p>
      </div>
      <section class="settings-card" data-testid="updates-card">
        <div class="settings-card-head">
          <div>
            <h3>Atualizações</h3>
            <p>Versão instalada: <strong>${escapeHtml(window.DiscordNative?.app?.getVersion?.() || "")}</strong>${
              uiState.updateInfo?.ok
                ? uiState.updateInfo.available
                  ? ` · Nova versão disponível: <strong>${escapeHtml(uiState.updateInfo.latest)}</strong>`
                  : " · Você está na versão mais recente."
                : uiState.updateInfo?.error
                  ? ` · ${escapeHtml(uiState.updateInfo.error)}`
                  : ""
            }</p>
          </div>
          ${
            uiState.updatingApp
              ? `<button class="btn btn-success btn-sm" disabled>Baixando...</button>`
              : uiState.updateInfo?.available
                ? `<button class="btn btn-success btn-sm" data-action="install-update" data-testid="install-update-btn">Atualizar agora</button>`
                : `<button class="btn btn-primary btn-sm" data-action="check-updates" data-testid="check-updates-btn" ${uiState.checkingUpdates ? "disabled" : ""}>${uiState.checkingUpdates ? "Verificando..." : "Verificar atualizações"}</button>`
          }
        </div>
        ${
          uiState.updatingApp
            ? `<div class="update-progress" data-testid="update-progress">
                <div class="update-progress-track"><div class="update-progress-fill js-update-fill" id="update-progress-fill" style="width:${uiState.updatePercent || 0}%;"></div></div>
                <span class="js-update-label" id="update-progress-label">${escapeHtml(uiState.updateLabel || "Preparando o download...")}</span>
              </div>`
            : ""
        }
        ${uiState.updateInfo?.available && uiState.updateInfo.notes ? `<p class="setting-desc update-notes">${escapeHtml(uiState.updateInfo.notes)}</p>` : ""}
      </section>
      <section class="settings-card">
        <div class="settings-card-head"><h3>Inicialização e encerramento</h3></div>
        ${checkboxRow({
          id: "setting-open-on-startup",
          checked: openOnStartup,
          title: "Iniciar junto com o Windows",
          desc: "Abre automaticamente ao entrar no Windows, minimizado na bandeja do sistema.",
          testid: "open-on-startup-checkbox"
        })}
        ${checkboxRow({
          id: "setting-quit-on-close",
          checked: s.minimizeToTray === false,
          title: "Encerrar processos ao fechar o app",
          desc: "Fechar a janela encerra o app por completo. Desmarcado, ele continua rodando na bandeja do sistema.",
          testid: "quit-on-close-checkbox"
        })}
      </section>
      <section class="settings-card">
        <div class="settings-card-head">
          <div>
            <h3>Memória</h3>
            <p>Em uso agora: <strong id="memory-usage-label">${escapeHtml(uiState.memoryUsageLabel || "medindo...")}</strong></p>
          </div>
          <button class="btn btn-primary btn-sm" data-action="purge-memory-now">Liberar memória agora</button>
        </div>
        ${checkboxRow({
          id: "setting-hardware-acceleration",
          checked: NativeBridge.getGpuAcceleration(),
          title: "Aceleração de hardware (GPU)",
          desc: "Deixa vídeo e compartilhamento de tela mais fluidos, mas usa cerca de 100 MB a mais. Vale após reiniciar o app.",
          testid: "hardware-acceleration-checkbox"
        })}
        ${checkboxRow({
          id: "setting-memory-saver",
          checked: Boolean(window.DiscordNative?.processUtils?.getMemorySaver?.()),
          title: "Modo economia de memória",
          desc: "Mantém o app abaixo de ~80 MB com um limite imposto pelo Windows. Em troca, podem aparecer travadas ao abrir, em carregamentos e nas transmissões.",
          testid: "memory-saver-checkbox"
        })}
      </section>
    `;
  } else if (tab === "activity") {
    const toggle = ({ id, checked, title, desc, testid }) => `
      <label class="checkbox-row" for="${id}">
        <input type="checkbox" class="checkbox-input" id="${id}" data-testid="${testid}" ${checked ? "checked" : ""} />
        <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
        <span class="checkbox-text">
          <span class="setting-title">${title}</span>
          <span class="setting-desc">${desc}</span>
        </span>
      </label>`;
    const myCards = renderLiveActivityCards(me.id);
    panelHtml = `
      <div class="settings-page-head">
        <h2>Atividade</h2>
        <p>O que aparece no seu perfil e em "Ativo agora" para seus amigos.</p>
      </div>
      <section class="settings-card">
        <div class="settings-card-head"><h3>Jogos</h3></div>
        ${toggle({
          id: "setting-show-game-activity",
          checked: NativeBridge.getSettingSync("SHOW_GAME_ACTIVITY", true) !== false,
          title: "Mostrar o jogo que estou jogando",
          desc: "O app reconhece o jogo pela janela aberta e mostra o nome, o ícone e há quanto tempo você está jogando.",
          testid: "show-game-activity-checkbox"
        })}
      </section>
      <section class="settings-card">
        <div class="settings-card-head"><h3>${SPOTIFY_ICON} Spotify</h3></div>
        ${toggle({
          id: "setting-spotify-sync",
          checked: Boolean(NativeBridge.getSettingSync("SPOTIFY_SYNC", false)),
          title: "Sincronizar com o Spotify",
          desc: "Mostra a música que está tocando no app do Spotify deste PC (nome, artista, capa e tempo) no seu card de perfil. Não precisa entrar com a conta do Spotify.",
          testid: "spotify-sync-checkbox"
        })}
      </section>
      <section class="settings-card">
        <div class="settings-card-head"><h3>Agora</h3></div>
        ${myCards ? `<div class="activity-card-list">${myCards}</div>` : `<p class="setting-desc">Nenhuma atividade detectada agora. Abra um jogo ou dê play no Spotify.</p>`}
      </section>
    `;
  } else if (tab === "profile") {
    panelHtml = renderProfileSettingsPanel(me);
  } else {
    panelHtml = renderAccountSettingsPanel(me);
  }

  return `
    <div class="settings-overlay" data-testid="user-settings-overlay">
      <div class="settings-sidebar">
        <div class="settings-nav">
          <div class="settings-section-label">Configurações de Usuário</div>
          <button class="settings-nav-item ${tab === "account" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="account" data-testid="settings-tab-account">Minha Conta</button>
          <button class="settings-nav-item ${tab === "profile" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="profile" data-testid="settings-tab-profile">Perfil</button>
          <button class="settings-nav-item ${tab === "activity" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="activity" data-testid="settings-tab-activity">Atividade</button>
          <div class="settings-section-label">Configurações do App</div>
          <button class="settings-nav-item ${tab === "appearance" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="appearance" data-testid="settings-tab-appearance">Aparência (${AVAILABLE_THEMES.length} Temas)</button>
          <button class="settings-nav-item ${tab === "voice" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="voice" data-testid="settings-tab-voice">Voz, Vídeo & Sons</button>
          <button class="settings-nav-item ${tab === "windows" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="windows" data-testid="settings-tab-windows">Windows & Memória</button>
          <div style="height:1px;background:var(--divider-subtle);margin:8px 0;"></div>
          <button class="settings-nav-item danger" data-action="logout">Sair da Conta</button>
        </div>
      </div>
      <div class="settings-content-wrap">
        <div class="settings-main-panel">
          ${panelHtml}
        </div>
        <div class="esc-close-col">
          <button class="esc-circle-btn" data-action="close-settings-overlay" data-testid="close-settings-btn">${Icons.close}</button>
          <span style="font-size:11px;font-weight:700;color:var(--text-muted);">ESC</span>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// Full profile view: card + "Atividade" (recent games) + quick customization
// ==========================================================================
const PROFILE_ACCENT_SWATCHES = ["#3f4147", "#5865f2", "#23a55a", "#f0b232", "#ed4245", "#eb459e", "#0ea5e9", "#ffffff"];

const PROFILE_THEME_PRESETS = [
  ["#3b3fa8", "#a8434f"],
  ["#5865f2", "#eb459e"],
  ["#0f766e", "#1e3a8a"],
  ["#7c3aed", "#0ea5e9"],
  ["#b45309", "#7f1d1d"],
  ["#14532d", "#0f172a"],
  ["#be185d", "#4c1d95"],
  ["#111827", "#374151"]
];

async function loadProfileActivities(userId) {
  const res = await store.getUserActivities(userId);
  if (uiState.profileView?.userId !== userId) return;
  uiState.profileView.activities = res?.ok ? res.activities : [];
  renderApp();
}

function openProfileView(userId) {
  closeAllFloatingMenus();
  uiState.profileView = { userId, activities: null };
  renderApp();
  loadProfileActivities(userId);
}

function formatRelativeTime(ts) {
  const diff = Math.max(0, Date.now() - Number(ts || 0));
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

function formatPlayTime(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return "menos de 1 min";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

// ==========================================================================
// Live activity: the game being played and the song on Spotify
// ==========================================================================
const SPOTIFY_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path d="M17.3 16.6a.75.75 0 0 1-1 .25c-2.8-1.7-6.3-2.1-10.4-1.2a.75.75 0 1 1-.33-1.46c4.5-1 8.4-.56 11.5 1.36.35.22.46.69.24 1.05zm1.4-3.1a.94.94 0 0 1-1.3.31c-3.2-2-8.1-2.5-11.9-1.4a.94.94 0 1 1-.54-1.8c4.3-1.3 9.7-.68 13.4 1.6.44.27.58.85.31 1.29zm.12-3.2C15 8 8.6 7.8 4.9 8.9a1.13 1.13 0 1 1-.66-2.16c4.3-1.3 11.3-1.05 15.7 1.56a1.13 1.13 0 0 1-1.16 1.95z" fill="#000"/></svg>`;

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// The game's art in a square: the whole (portrait) cover over a blurred copy
// of itself, so nothing is cut off. Without a cover (or if it fails to load)
// the window's own icon, then the initials.
function gameIconHtml(game, size = 40) {
  const style = `width:${size}px;height:${size}px;--game-color:${escapeHtml(game.color || "#5865f2")};`;
  const fallback = game.iconDataUrl
    ? `<img class="activity-app-icon-fallback" src="${escapeHtml(game.iconDataUrl)}" alt="" />`
    : `<span class="activity-app-icon-fallback initials">${escapeHtml(getInitials(game.name))}</span>`;
  if (game.coverUrl) {
    const src = escapeHtml(game.coverUrl);
    return `
      <span class="activity-app-icon cover-box" style="${style}" data-cover-box>
        ${fallback}
        <img class="cover-bg" src="${src}" alt="" referrerpolicy="no-referrer" data-cover-img />
        <img class="cover-fg" src="${src}" alt="" referrerpolicy="no-referrer" data-cover-img />
      </span>`;
  }
  if (game.iconDataUrl) return `<img class="activity-app-icon" style="${style}" src="${escapeHtml(game.iconDataUrl)}" alt="" />`;
  return `<span class="activity-app-icon initials" style="${style}">${escapeHtml(getInitials(game.name))}</span>`;
}

// A cover that does not exist (or did not load): drop it, the fallback under it shows
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-cover-img")) return;
    const box = img.closest("[data-cover-box]");
    if (box) box.querySelectorAll("[data-cover-img]").forEach((el) => el.remove());
    else img.remove();
  },
  true
);

// One line for friend lists and the member list ("Jogando X" / "Ouvindo ...")
function activitySummaryHtml(userId) {
  const live = store.getLiveActivity(userId);
  if (live?.game) return `<span class="activity-line">${Icons.signal}<span>Jogando <strong>${escapeHtml(live.game.name)}</strong></span></span>`;
  if (live?.listening) {
    return `<span class="activity-line spotify">${SPOTIFY_ICON}<span>${escapeHtml(live.listening.artist || live.listening.title)}</span></span>`;
  }
  return "";
}

// "Atividade atual" cards (profile card, full profile, Ativo agora)
function renderLiveActivityCards(userId) {
  const live = store.getLiveActivity(userId);
  if (!live) return "";
  let html = "";
  if (live.game) {
    html += `
      <div class="activity-card" data-testid="activity-card-game">
        <div class="activity-card-label">Jogando</div>
        <div class="activity-card-body">
          ${gameIconHtml(live.game, 56)}
          <div class="activity-card-text">
            <div class="activity-card-title">${escapeHtml(live.game.name)}</div>
            <div class="activity-card-sub" data-activity-since="${Number(live.game.since) || 0}">${escapeHtml(formatPlayTime((Date.now() - live.game.since) / 1000))}</div>
          </div>
        </div>
      </div>`;
  }
  if (live.listening) {
    const t = live.listening;
    const elapsed = Math.min(t.durationMs || Infinity, Date.now() - t.startedAt);
    const pct = t.durationMs ? Math.min(100, (elapsed / t.durationMs) * 100) : 0;
    const searchUrl = `https://open.spotify.com/search/${encodeURIComponent(`${t.title} ${t.artist}`)}`;
    html += `
      <div class="activity-card spotify" data-testid="activity-card-spotify">
        <div class="activity-card-label">Ouvindo Spotify ${SPOTIFY_ICON}</div>
        <div class="activity-card-body">
          ${
            t.albumArtUrl
              ? `<img class="activity-album-art" src="${escapeHtml(t.albumArtUrl)}" alt="" referrerpolicy="no-referrer" />`
              : `<span class="activity-album-art placeholder">${SPOTIFY_ICON}</span>`
          }
          <div class="activity-card-text">
            <div class="activity-card-title">${escapeHtml(t.title)}</div>
            <div class="activity-card-sub">${escapeHtml(t.artist)}</div>
            ${
              t.durationMs
                ? `<div class="activity-progress" data-track-start="${Number(t.startedAt)}" data-track-duration="${Number(t.durationMs)}">
                    <span data-track-elapsed>${formatClock(elapsed)}</span>
                    <div class="activity-progress-bar"><div class="activity-progress-fill" style="width:${pct.toFixed(1)}%;"></div></div>
                    <span>${formatClock(t.durationMs)}</span>
                  </div>`
                : ""
            }
            <div class="activity-card-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-action="open-link" data-url="${escapeHtml(searchUrl)}">Ouvir no Spotify</button>
            </div>
          </div>
        </div>
      </div>`;
  }
  return html;
}

// Song progress and "playing for" times tick in place, without re-rendering
setInterval(() => {
  const now = Date.now();
  for (const el of document.querySelectorAll("[data-track-start]")) {
    const start = Number(el.getAttribute("data-track-start"));
    const duration = Number(el.getAttribute("data-track-duration"));
    const elapsed = Math.min(duration, now - start);
    const label = el.querySelector("[data-track-elapsed]");
    const fill = el.querySelector(".activity-progress-fill");
    if (label) label.textContent = formatClock(elapsed);
    if (fill) fill.style.width = `${Math.min(100, (elapsed / duration) * 100).toFixed(1)}%`;
  }
  for (const el of document.querySelectorAll("[data-activity-since]")) {
    const since = Number(el.getAttribute("data-activity-since"));
    if (since) el.textContent = formatPlayTime((now - since) / 1000);
  }
}, 1000);

function renderActivityList(activities) {
  if (activities === null) return `<div class="profile-activity-empty">Carregando atividades...</div>`;
  if (!activities.length) {
    return `<div class="profile-activity-empty">Nenhum jogo detectado ainda.<br />Abra um jogo com o app aberto e ele aparece aqui.</div>`;
  }
  return `
    <div class="profile-activity-grid">
      ${activities
        .map(
          (a) => `
        <div class="profile-activity-card ${a.playingNow ? "playing" : ""}" title="${escapeHtml(a.name)}">
          <div class="profile-activity-cover" style="--game-color:${escapeHtml(a.color || "#5865f2")};">
            <span class="profile-activity-initials">${escapeHtml(getInitials(a.name))}</span>
            ${a.iconDataUrl ? `<img class="contain" src="${escapeHtml(a.iconDataUrl)}" alt="" />` : ""}
            ${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-img />` : ""}
            ${a.playingNow ? `<span class="profile-activity-live">Jogando</span>` : ""}
          </div>
          <div class="profile-activity-name">${escapeHtml(a.name)}</div>
          <div class="profile-activity-meta">${a.playingNow ? `Agora · ${escapeHtml(formatPlayTime((Date.now() - a.playingSince) / 1000))}` : escapeHtml(formatRelativeTime(a.lastPlayedAt))}</div>
          <div class="profile-activity-meta">${escapeHtml(formatPlayTime(a.totalSeconds))} no total</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function profileThemeStyle(user) {
  const border = user?.profileBorderEnabled === false ? "" : `--profile-border:${escapeHtml(user?.profileBorderColor || "#3f4147")};`;
  if (!user?.profileThemeEnabled) return border;
  return `${border}--theme-primary:${escapeHtml(user.profileThemePrimary || "#5865f2")};--theme-accent:${escapeHtml(user.profileThemeAccent || "#eb459e")};`;
}

// Classes shared by the full profile card and the member popout
function profileCardClasses(user) {
  return [user?.profileThemeEnabled ? "themed" : "", user?.profileBorderEnabled === false ? "" : "has-border"].filter(Boolean).join(" ");
}

function renderProfileCustomizer(me) {
  const themeOn = Boolean(me.profileThemeEnabled);
  const primary = me.profileThemePrimary || "#5865f2";
  const accent = me.profileThemeAccent || "#eb459e";
  return `
    <aside class="profile-customizer" data-testid="profile-customizer">
      <div class="profile-customizer-head">
        <h3>Customização de perfil</h3>
        <p>Mudanças rápidas, salvas na hora.</p>
      </div>
      <button class="btn btn-secondary btn-sm profile-customizer-surprise" data-action="surprise-profile-theme">🎲 Surpreenda-me!</button>

      <section class="profile-customizer-section">
        <div class="form-label">Foto de perfil</div>
        <div class="btn-row wrap">
          <label class="btn btn-primary btn-sm btn-icon-text" style="cursor:pointer;">
            ${Icons.upload}<span>Enviar foto</span>
            <input type="file" id="avatar-upload-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
          </label>
          <button type="button" class="btn btn-secondary btn-sm btn-icon-text" data-action="open-gif-picker" data-target="avatar">${Icons.sparkles}<span>GIFs</span></button>
        </div>
        ${uiState.stagedAvatar ? renderStagedMediaBar({ label: "Nova foto pronta.", confirmAction: "confirm-staged-avatar", cancelAction: "cancel-staged-avatar", confirmTestid: "profile-confirm-avatar-btn" }) : ""}
      </section>

      <section class="profile-customizer-section">
        <div class="form-label">Banner do perfil</div>
        <div class="btn-row wrap">
          <label class="btn btn-primary btn-sm btn-icon-text" style="cursor:pointer;">
            ${Icons.image}<span>Enviar imagem</span>
            <input type="file" id="banner-upload-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
          </label>
          <button type="button" class="btn btn-secondary btn-sm btn-icon-text" data-action="open-gif-picker" data-target="banner">${Icons.sparkles}<span>GIFs</span></button>
          ${me.bannerUrl ? `<button type="button" class="icon-square-btn danger" data-action="remove-banner-image" title="Remover imagem do banner" aria-label="Remover imagem do banner">${Icons.trash}</button>` : ""}
        </div>
        ${uiState.stagedBanner ? renderStagedMediaBar({ label: "Novo banner pronto.", confirmAction: "confirm-staged-banner", cancelAction: "cancel-staged-banner", confirmTestid: "profile-confirm-banner-btn" }) : ""}
        <div class="color-swatch-row">
          ${BANNER_SWATCHES.map(
            (c) => `<button type="button" class="color-swatch-btn ${me.bannerColor === c ? "active" : ""}" style="background:${c};" data-action="select-banner-swatch" data-color="${c}" aria-label="Cor ${c}"></button>`
          ).join("")}
        </div>
      </section>

      <section class="profile-customizer-section">
        <label class="checkbox-row compact" for="profile-border-toggle">
          <input type="checkbox" class="checkbox-input" id="profile-border-toggle" data-testid="profile-border-toggle" ${me.profileBorderEnabled !== false ? "checked" : ""} />
          <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
          <span class="checkbox-text">
            <span class="setting-title">Borda do perfil</span>
            <span class="setting-desc">Linha fina em volta do cartão e da foto.</span>
          </span>
        </label>
        ${
          me.profileBorderEnabled !== false
            ? `<div class="profile-color-row">
                ${PROFILE_ACCENT_SWATCHES.map(
                  (c) => `<button type="button" class="color-swatch-btn ${(me.profileBorderColor || "#3f4147") === c ? "active" : ""}" style="background:${c};" data-action="set-profile-border-color" data-color="${c}" aria-label="Borda ${c}"></button>`
                ).join("")}
                <label class="color-custom-btn" title="Cor personalizada"><input type="color" id="profile-border-color" value="${escapeHtml(me.profileBorderColor || "#3f4147")}" /><span>+</span></label>
              </div>`
            : ""
        }
      </section>

      <section class="profile-customizer-section">
        <div class="form-label">Cor do seu cartão na call</div>
        <div class="profile-color-row">
          ${PROFILE_ACCENT_SWATCHES.map(
            (c) => `<button type="button" class="color-swatch-btn ${me.callTileColor === c ? "active" : ""}" style="background:${c};" data-action="set-call-tile-color" data-color="${c}" aria-label="Cartão ${c}"></button>`
          ).join("")}
          <label class="color-custom-btn" title="Cor personalizada"><input type="color" id="call-tile-color" value="${escapeHtml(me.callTileColor || "#2b2d31")}" /><span>+</span></label>
        </div>
        <div class="call-tile-preview" style="background:${escapeHtml(me.callTileColor || "#2b2d31")};">${renderAvatar(me, "", false, "width:34px;height:34px;min-width:34px;font-size:13px;")}</div>
        ${me.callTileColor ? `<button type="button" class="link-btn" data-action="set-call-tile-color" data-color="">Usar cor automática</button>` : ""}
      </section>

      <section class="profile-customizer-section">
        <label class="checkbox-row compact" for="profile-theme-toggle">
          <input type="checkbox" class="checkbox-input" id="profile-theme-toggle" data-testid="profile-theme-toggle" ${themeOn ? "checked" : ""} />
          <span class="checkbox-box" aria-hidden="true">${Icons.check}</span>
          <span class="checkbox-text">
            <span class="setting-title">Tema de perfil</span>
            <span class="setting-desc">Aplica um gradiente de duas cores no seu cartão de perfil.</span>
          </span>
        </label>
        ${
          themeOn
            ? `<div class="profile-theme-pickers">
                <label class="profile-theme-color"><span>Principal</span><input type="color" id="profile-theme-primary" value="${escapeHtml(primary)}" /></label>
                <label class="profile-theme-color"><span>Destaque</span><input type="color" id="profile-theme-accent" value="${escapeHtml(accent)}" /></label>
              </div>
              <div class="profile-theme-presets">
                ${PROFILE_THEME_PRESETS.map(
                  ([p, a]) => `<button type="button" class="profile-theme-preset" style="background:linear-gradient(180deg, ${p}, ${a});" data-action="set-profile-theme" data-primary="${p}" data-accent="${a}" aria-label="Tema ${p} e ${a}"></button>`
                ).join("")}
              </div>`
            : ""
        }
      </section>
    </aside>
  `;
}

function renderProfileView(state) {
  const view = uiState.profileView;
  if (!view) return "";
  const user = state.users[view.userId];
  if (!user) return "";
  const isMe = user.id === state.auth.currentUserId;
  const liveCards = renderLiveActivityCards(user.id);

  return `
    <div class="profile-view-backdrop" data-action="close-profile-view-backdrop" data-testid="profile-view">
      <div class="profile-view">
        ${isMe ? renderProfileCustomizer(user) : ""}
        <div class="profile-view-main">
          <article class="profile-view-card ${profileCardClasses(user)}" id="profile-view-card" style="${profileThemeStyle(user)}">
            ${renderBanner(user, 150)}
            <div class="profile-view-body">
              <div class="profile-view-avatar">${renderExpandableAvatar(user)}</div>
              ${user.customStatus ? `<div class="profile-view-bubble">${escapeHtml(user.customStatus)}</div>` : ""}
              <h2 class="profile-view-name">${escapeHtml(user.displayName)}</h2>
              <div class="profile-view-username">@${escapeHtml(user.username)}${user.pronouns ? ` · ${escapeHtml(user.pronouns)}` : ""}</div>
              <div class="btn-row" style="margin-top:14px;">
                ${
                  isMe
                    ? `<button class="btn btn-secondary btn-sm" data-action="open-profile-settings">Editar perfil completo</button>`
                    : `<button class="btn btn-primary btn-sm" data-action="message-friend" data-user-id="${escapeHtml(user.id)}">${Icons.chat}<span>Mensagem</span></button>`
                }
              </div>
              ${user.aboutMe ? `<div class="profile-view-about">${formatMessageMarkdown(user.aboutMe)}</div>` : ""}
              <div class="profile-view-field">
                <div class="profile-view-label">Membro desde</div>
                <div>${escapeHtml(user.memberSince || "")}</div>
              </div>
            </div>
          </article>
          <section class="profile-view-side">
            <div class="profile-view-tabs" role="tablist"><span class="profile-view-tab active" role="tab" aria-selected="true">Atividade</span></div>
            <div class="profile-view-panel">
              ${liveCards ? `<div class="profile-view-panel-title">Atividade atual</div><div class="activity-card-list">${liveCards}</div>` : ""}
              <div class="profile-view-panel-title">Jogou recentemente</div>
              ${renderActivityList(view.activities)}
            </div>
          </section>
        </div>
        <button class="profile-view-close" data-action="close-profile-view" title="Fechar" aria-label="Fechar">${Icons.close}</button>
      </div>
    </div>
  `;
}

// Quick device picker above the account bar (mic arrow = input, headphones arrow = output)
function renderAudioDeviceMenu(state) {
  const kind = uiState.audioMenu;
  if (!kind) return "";
  const isInput = kind === "input";
  const devices = isInput ? uiState.audioInputDevices : uiState.audioOutputDevices;
  const selected = isInput
    ? state.settings.voiceInputDeviceId || uiState.selectedAudioInput || "default"
    : state.settings.voiceOutputDeviceId || uiState.selectedAudioOutput || "default";
  const list = devices.length ? devices : [{ deviceId: "default", label: isInput ? "Microfone padrão do sistema" : "Saída padrão do sistema" }];
  return `
    <div class="floating-popout audio-device-menu ${isInput ? "input" : "output"}" data-testid="audio-device-menu">
      <div class="audio-device-menu-title">${isInput ? "Dispositivo de entrada" : "Dispositivo de saída"}</div>
      <div class="audio-device-list">
        ${list
          .map(
            (d) => `
          <button class="audio-device-item ${d.deviceId === selected ? "selected" : ""}" data-action="pick-audio-device" data-kind="${kind}" data-device-id="${escapeHtml(d.deviceId)}">
            <span class="audio-device-radio" aria-hidden="true"></span>
            <span class="audio-device-label">${escapeHtml(d.label || "Dispositivo sem nome")}</span>
          </button>
        `
          )
          .join("")}
      </div>
      <div class="audio-device-menu-sep"></div>
      <button class="audio-device-item" data-action="open-voice-settings">
        ${Icons.settings}
        <span class="audio-device-label">Configurações de voz</span>
      </button>
    </div>
  `;
}

// Items: { label, sublabel?, icon?, danger?, onClick } | { type: "separator" } |
// { type: "checkbox", label, checked, danger?, onToggle(checked) } (menu stays open) |
// { type: "radio", label, checked, onClick } (menu stays open) |
// { type: "slider", label, value 0-100, onInput(value) } | { type: "submenu", label, sublabel?, items }
function renderContextMenuItems(items, prefix = "") {
  return items
    .map((it, i) => {
      const idx = prefix ? `${prefix}.${i}` : String(i);
      if (it.type === "separator") return `<div class="context-menu-sep" role="separator"></div>`;
      if (it.type === "slider") {
        return `
          <div class="context-menu-slider">
            <div class="context-menu-slider-label">${escapeHtml(it.label)} <span data-context-slider-value="${idx}">${Math.round(it.value)}%</span></div>
            <input type="range" min="0" max="100" value="${Math.round(it.value)}" data-context-slider="${idx}" aria-label="${escapeHtml(it.label)}" />
          </div>`;
      }
      if (it.type === "submenu") {
        return `
          <div class="context-menu-item has-submenu" tabindex="0">
            <span class="context-menu-text">
              <span>${escapeHtml(it.label)}</span>
              ${it.sublabel ? `<span class="context-menu-sublabel">${escapeHtml(it.sublabel)}</span>` : ""}
            </span>${Icons.chevronRight}
            <div class="context-submenu ${it.wide ? "wide" : ""}">${it.items.length ? renderContextMenuItems(it.items, idx) : `<div class="context-menu-empty">Nada aqui</div>`}</div>
          </div>`;
      }
      const check =
        it.type === "checkbox"
          ? `<span class="context-menu-check ${it.checked ? "on" : ""}">${it.checked ? Icons.check : ""}</span>`
          : it.type === "radio"
            ? `<span class="context-menu-radio ${it.checked ? "on" : ""}"></span>`
            : "";
      const role = it.type === "checkbox" ? "menuitemcheckbox" : it.type === "radio" ? "menuitemradio" : "";
      return `
        <button class="context-menu-item ${it.danger ? "danger" : ""}" data-context-idx="${idx}" ${role ? `role="${role}" aria-checked="${it.checked ? "true" : "false"}"` : ""}>
          ${it.icon ? `<span class="context-menu-icon">${it.icon}</span>` : ""}
          <span class="context-menu-text">
            <span>${escapeHtml(it.label)}</span>
            ${it.sublabel ? `<span class="context-menu-sublabel">${escapeHtml(it.sublabel)}</span>` : ""}
          </span>
          ${check}
        </button>`;
    })
    .join("");
}

function findContextItem(path) {
  let list = uiState.contextMenu?.items || [];
  let item = null;
  for (const part of String(path).split(".")) {
    item = list[Number(part)];
    list = item?.items || [];
  }
  return item;
}

function renderContextMenu() {
  if (!uiState.contextMenu) return "";
  const { x, y, items, wide } = uiState.contextMenu;
  return `
    <div class="context-menu ${wide ? "wide" : ""}" style="left:${x}px;top:${y}px;" data-testid="context-menu" role="menu">
      ${renderContextMenuItems(items)}
    </div>
  `;
}

// ==========================================================================
// Master Render Cycle & Form / Media Event Binding
// ==========================================================================

export function renderApp() {
  const state = store.getState();
  const root = document.getElementById("app");
  if (!root) return;

  if (!state.auth.isAuthenticated) {
    morphInnerHTML(root, renderAuthScreen(state));
    bindReplacingDuplicates(bindFormEvents);
    return;
  }

  if (state.auth.emailGate) {
    morphInnerHTML(root, renderEmailGateScreen(state));
    bindReplacingDuplicates(bindFormEvents);
    return;
  }

  // A server that no longer exists (or a brand-new account with no servers) would
  // leave the window without its sidebar and account bar: show the home screen
  if (state.navigation.view === "guild" && !store.getActiveGuild()) {
    state.navigation.view = "home";
    state.navigation.homeSection = "friends";
  }

  let mainStageHtml = "";
  if (state.navigation.view === "discovery") {
    mainStageHtml = renderDiscoveryStage(state);
  } else if (state.navigation.view === "home") {
    // "nitro"/"shop" may still be persisted from older versions; both now fall back to Friends
    if (["friends", "nitro", "shop"].includes(state.navigation.homeSection)) {
      mainStageHtml = renderFriendsStage(state);
    } else {
      mainStageHtml = renderChatStage(state);
    }
  } else {
    const callChannel = getCallChannel(state);
    mainStageHtml = callChannel ? renderCallStage(state, callChannel) : renderChatStage(state);
  }

  morphInnerHTML(root, `
    <div class="app-root" data-theme="${escapeHtml(state.settings.theme)}" style="--font-scale:${state.settings.fontScale || 1};--channels-width:${uiState.channelsWidth}px;--members-width:${uiState.membersWidth}px;">
      ${renderTitlebar(state)}
      ${renderUpdateBanner()}
      <div class="workspace">
        ${renderGuildsRail(state)}
        ${renderSecondarySidebar(state)}
        ${mainStageHtml}
      </div>
      ${renderServerDropdownMenu(state)}
      ${renderPinnedPopover(state)}
      ${renderStatusMenu(state)}
      ${renderUserPopout(state)}
      ${renderEmojiPickerPopover()}
      ${renderActiveModal(state)}
      ${renderSettingsOverlay(state)}
      ${renderContextMenu()}
      ${renderAudioDeviceMenu(state)}
      ${renderProfileView(state)}
      ${renderIncomingCall(state)}
      ${renderAvatarLightbox()}
      ${renderMediaViewer()}
      ${renderConfirmDialog()}
      ${renderSwitchAccountPrompt()}
    </div>
  `);

  bindReplacingDuplicates(bindFormEvents);
  syncEmojiPicker(uiState.emojiPickerForMessageId, uiState.emojiPickerAnchor);
  keepUserPopoutOnScreen();
  attachLiveScreenShareVideo();
  syncMediaEditor(state);
}

// The framing editor lives outside #app: re-rendering the app (a message
// arriving, a toast...) must never replace its sliders, which would cancel a
// drag in progress. It is only rebuilt when a new editing session opens.
const mediaEditorView = { root: null, sessionId: null };

function syncMediaEditor(state) {
  const me = state.mediaEditor;
  if (!me?.isOpen) {
    mediaEditorView.root?.remove();
    mediaEditorView.root = null;
    mediaEditorView.sessionId = null;
    return;
  }
  if (mediaEditorView.root && mediaEditorView.sessionId === me.sessionId) {
    mediaEditorView.root.setAttribute("data-theme", state.settings.theme);
    return;
  }
  mediaEditorView.root?.remove();
  const root = document.createElement("div");
  root.id = "media-editor-root";
  root.className = "app-root theme-layer";
  root.setAttribute("data-theme", state.settings.theme);
  root.innerHTML = renderMediaEditorModal(state);
  document.body.appendChild(root);
  mediaEditorView.root = root;
  mediaEditorView.sessionId = me.sessionId;
  bindMediaEditorSliders(root);
}

function bindMediaEditorSliders(root) {
  const zoomSlider = root.querySelector("#media-editor-zoom-slider");
  const panXSlider = root.querySelector("#media-editor-panx-slider");
  const panYSlider = root.querySelector("#media-editor-pany-slider");
  const previewImg = root.querySelector("#media-editor-preview-img");

  const syncEditorTransform = () => {
    const s = zoomSlider ? Number(zoomSlider.value) : 1;
    const x = panXSlider ? Number(panXSlider.value) : 0;
    const y = panYSlider ? Number(panYSlider.value) : 0;
    if (previewImg) previewImg.style.cssText = `width:100%;height:100%;object-fit:cover;${mediaFramingStyle(s, x, y)}`;
    const zLbl = root.querySelector("#editor-zoom-label");
    if (zLbl) zLbl.textContent = `${s.toFixed(2)}x`;
    const xLbl = root.querySelector("#editor-panx-label");
    if (xLbl) xLbl.textContent = `${framingPercent(x)}%`;
    const yLbl = root.querySelector("#editor-pany-label");
    if (yLbl) yLbl.textContent = `${framingPercent(y)}%`;
    store.updateMediaEditorCoords({ scale: s, cropX: x, cropY: y });
  };

  for (const slider of [zoomSlider, panXSlider, panYSlider]) {
    if (slider) slider.addEventListener("input", syncEditorTransform);
  }
}

// The preview <video> is created once per capture (ScreenShare) and moved into
// the current render's slot: recreating it on every render restarted the
// stream, which made the preview stutter
// Live <video> elements are created once and moved into their slots after
// each render (re-creating them would flash black and restart decoding)
function mountVideo(video, slot) {
  if (!video || !slot) return;
  if (video.parentElement !== slot) slot.replaceChildren(video);
  if (video.paused) video.play().catch(() => {});
  // Who is on this video: "<userId>:screen" slots, or my own preview
  const owner = slot.getAttribute("data-remote-video")?.split(":")[0] || (slot.hasAttribute("data-share-video-slot") ? store.getState().auth.currentUserId : null);
  if (owner && !video.dataset.aspectWatch) {
    video.dataset.aspectWatch = "1";
    const learn = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const ar = video.videoWidth / video.videoHeight;
      const key = video.dataset.aspectOwner;
      if (Math.abs((uiState.streamAspect[key] || 0) - ar) > 0.01) {
        uiState.streamAspect[key] = ar;
        renderApp();
      }
    };
    video.addEventListener("loadedmetadata", learn);
    video.addEventListener("resize", learn);
  }
  video.dataset.aspectOwner = owner || "";
  if (owner && video.videoWidth && !uiState.streamAspect[owner]) uiState.streamAspect[owner] = video.videoWidth / video.videoHeight;
}

function attachLiveScreenShareVideo() {
  mountVideo(ScreenShare.getPreviewElement(), document.querySelector("[data-share-video-slot]"));
  mountVideo(Camera.getPreviewElement(), document.querySelector("[data-local-camera]"));
  for (const slot of document.querySelectorAll("[data-remote-video]")) {
    const [userId, kind] = slot.getAttribute("data-remote-video").split(":");
    mountVideo(Voice.getRemoteVideo(userId, kind), slot);
  }
}

function setShareStat(key, value) {
  for (const el of document.querySelectorAll(`[data-share-stat="${key}"]`)) {
    if (el.textContent !== String(value)) el.textContent = String(value);
  }
}

ScreenShare.onBlackCapture = () => {
  showToast("Sua transmissão parece estar preta. Tente compartilhar a tela inteira em vez da janela (ou o contrário).");
};

// A stream on screen that never produced a picture: asks the sharer to resend it
const streamsWithoutPicture = new Map();
function nudgeStreamsWithoutPicture() {
  const seen = new Set();
  for (const slot of document.querySelectorAll('[data-remote-video$=":screen"]')) {
    const userId = slot.getAttribute("data-remote-video").split(":")[0];
    const video = slot.querySelector("video");
    if (!video || video.videoWidth) continue;
    seen.add(userId);
    const waited = (streamsWithoutPicture.get(userId) || 0) + 1;
    streamsWithoutPicture.set(userId, waited);
    if (waited % 4 === 0) {
      video.play().catch(() => {});
      Voice.requestStreamRefresh(userId);
    }
  }
  for (const userId of streamsWithoutPicture.keys()) {
    if (!seen.has(userId)) streamsWithoutPicture.delete(userId);
  }
}

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("call-fullscreen", Boolean(document.fullscreenElement));
  renderApp();
});
document.addEventListener("input", (e) => {
  if (e.target.matches?.("[data-call-volume]")) Voice.setOutputVolume(e.target.value);
});
document.addEventListener("change", (e) => {
  if (e.target.matches?.("[data-call-volume]")) store.updateSettings({ voiceOutputVolume: Number(e.target.value) });
});

// Live numbers on the stats overlay, updated in place (no re-render)
setInterval(async () => {
  nudgeStreamsWithoutPicture();
  if (document.fullscreenElement && !document.querySelector(".call-stage")) document.exitFullscreen().catch(() => {});
  if (ScreenShare.getStream()) {
    const stats = ScreenShare.getStats();
    setShareStat("capturedFps", stats.capturedFps || "—");
    setShareStat("resolution", stats.resolution || "—");
    const out = await Voice.getOutboundVideoStats("screen");
    setShareStat("sent", out ? `${out.width}x${out.height} @ ${out.fps}` : "—");
    return;
  }
  const slot = document.querySelector('[data-remote-video$=":screen"]');
  if (!slot) return;
  const inbound = await Voice.getInboundVideoStats(slot.getAttribute("data-remote-video").split(":")[0], "screen");
  if (!inbound) return;
  setShareStat("capturedFps", inbound.fps || "—");
  setShareStat("resolution", inbound.width ? `${inbound.width}x${inbound.height}` : "—");
}, 1000);

async function openInviteModalForGuild(guildId, channelId = null) {
  closeAllFloatingMenus();
  uiState.activeModal = "invite";
  uiState.inviteCopiedCode = null;
  renderApp();

  const res = await store.createServerInvite(guildId, {
    channelId,
    expiresInSeconds: uiState.inviteExpiresIn,
    maxUses: uiState.inviteMaxUses
  });
  if (res.ok && res.invite) {
    uiState.currentInvite = res.invite;
  }
  const listRes = await store.getGuildInvites(guildId);
  if (listRes.ok) {
    uiState.guildInvitesList = listRes.invites || [];
  }
  renderApp();
}

function renderScreenSourceCard(src) {
  const isSel = uiState.selectedScreenSourceId === src.id;
  return `
    <button
      type="button"
      class="screen-source-card ${isSel ? "selected" : ""}"
      data-action="select-screen-source"
      data-source-id="${escapeHtml(src.id)}"
      data-source-name="${escapeHtml(src.name)}"
      data-testid="screen-source-item"
      title="${escapeHtml(src.name)}"
    >
      ${
        src.thumbnail
          ? `<img class="screen-source-thumb" src="${src.thumbnail}" alt="" />`
          : `<div class="screen-source-thumb screen-source-thumb-empty">${src.isScreen ? "Tela" : "Janela minimizada"}</div>`
      }
      <div class="screen-source-label">
        ${src.appIcon ? `<img class="screen-source-icon" src="${src.appIcon}" alt="" />` : ""}
        <span>${escapeHtml(src.name)}</span>
      </div>
    </button>
  `;
}

async function openScreenSharePickerModal() {
  closeAllFloatingMenus();
  uiState.activeModal = "screenshare-picker";
  uiState.loadingScreenSources = true;
  renderApp();

  await loadScreenSources();
}

// Windows come and go: keep the selection only if that window is still open
async function loadScreenSources() {
  const sources = await store.getScreenShareSources();
  uiState.screenSources = sources;
  uiState.loadingScreenSources = false;
  const still = sources.find((src) => src.id === uiState.selectedScreenSourceId);
  uiState.selectedScreenSourceId = still ? still.id : sources[0]?.id || null;
  uiState.selectedScreenSourceName = still ? still.name : sources[0]?.name || null;
  renderApp();
}

// Uploads a file chosen from a "+" menu: images become inline pictures, the
// rest a downloadable file card. Returns the staged attachment or null.
async function stageChatFile(file) {
  const isImage = file.type.startsWith("image/");
  const sizeLabel = file.size >= 1024 * 1024 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  const base64Data = await readFileAsBase64(file);
  const up = await store.uploadMedia({ fileName: file.name, mimeType: file.type, base64Data, kind: isImage ? "attachment" : "file" });
  if (!up.ok) {
    showToast(up.error || "Não foi possível enviar o arquivo.");
    return null;
  }
  return { name: file.name, size: sizeLabel, isImage, url: up.url, mimeType: up.mimeType };
}

// All app processes together, as Windows' Task Manager shows it
async function refreshMemoryUsageLabel() {
  const mb = await window.DiscordNative?.processUtils?.getTaskManagerMemoryMB?.().catch(() => null);
  if (mb === null || mb === undefined) return;
  uiState.memoryUsageLabel = `${Math.round(mb)} MB`;
  const label = document.getElementById("memory-usage-label");
  if (label) label.textContent = uiState.memoryUsageLabel;
}

function bindFormEvents() {
  // Login Form
  const loginForm = document.getElementById("auth-login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      const res = await store.login(fd.get("email"), fd.get("password"));
      if (!res.ok) {
        const err = document.getElementById("auth-error-msg");
        if (err) err.textContent = res.error;
      } else {
        showToast(`Bem-vindo(a), @${res.user.username}!`);
      }
    });
  }

  // E-mail verification gate
  const gateForm = document.getElementById("email-gate-form");
  if (gateForm) {
    gateForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await store.confirmEmailGate(new FormData(gateForm).get("code"));
      if (!res.ok) {
        const err = document.getElementById("email-gate-error");
        if (err) err.textContent = res.error;
      } else {
        showToast("E-mail confirmado! Bem-vindo(a).");
      }
    });
  }

  // Register Form
  const regForm = document.getElementById("auth-register-form");
  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(regForm);
      const res = await store.register({
        email: fd.get("email"),
        displayName: fd.get("displayName"),
        username: fd.get("username"),
        password: fd.get("password")
      });
      if (!res.ok) {
        const err = document.getElementById("auth-error-msg");
        if (err) err.textContent = res.error;
      } else {
        showToast(`Conta @${res.user.username} criada no SQLite!`);
      }
    });
  }

  // Message Composer Form & Auto-Scroll / Auto-Focus on Channel/DM Open
  const mainScroller = document.getElementById("messages-scroller");
  const activeCh = store.getActiveChannel();
  if (mainScroller && activeCh) {
    const count = mainScroller.querySelectorAll(".message-row[data-message-id]").length;
    const key = activeCh.id;
    const channelChanged = mainScroller._seenKey !== key;
    if (channelChanged) {
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      scrollChatToBottom(mainScroller);
      requestAnimationFrame(() => {
        const activeTag = document.activeElement?.tagName;
        if (!uiState.activeModal && !uiState.settingsOverlay && activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
          document.getElementById("composer-text-input")?.focus();
        }
      });
    } else if (mainScroller._seenCount !== count && !uiState.isScrolledUp) {
      scrollChatToBottom(mainScroller);
    }
    mainScroller._seenKey = key;
    mainScroller._seenCount = count;

    if (!mainScroller._scrollBound) {
      mainScroller._scrollBound = true;
      // When message media (images, avatars, attachments) loads, keep view pinned to bottom if user hasn't scrolled up
      mainScroller.addEventListener(
        "load",
        () => {
          if (!uiState.isScrolledUp) scrollChatToBottom(mainScroller);
        },
        true
      );
      // One check per frame, and hover effects paused while the list moves
      let scrollFrame = 0;
      let scrollIdleTimer = null;
      mainScroller.addEventListener(
        "scroll",
        () => {
          if (!mainScroller.classList.contains("is-scrolling")) mainScroller.classList.add("is-scrolling");
          clearTimeout(scrollIdleTimer);
          scrollIdleTimer = setTimeout(() => mainScroller.classList.remove("is-scrolling"), 140);
          if (scrollFrame) return;
          scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0;
            const distFromBottom = mainScroller.scrollHeight - mainScroller.scrollTop - mainScroller.clientHeight;
            const scrolledUp = distFromBottom > 120;
            if (scrolledUp !== Boolean(uiState.isScrolledUp)) {
              uiState.isScrolledUp = scrolledUp;
              if (!scrolledUp) uiState.newMessagesWhileScrolledUp = 0;
              syncJumpToPresentBar();
            }
          });
        },
        { passive: true }
      );
    }
  }

  const composerForm = document.getElementById("message-composer-form");
  if (composerForm) {
    composerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("composer-text-input");
      const channel = store.getActiveChannel();
      if (!channel || !input) return;
      const text = input.value;
      if (!text.trim() && !uiState.stagedAttachment) return;

      const replyToId = uiState.replyingToMessageId;
      const attachment = uiState.stagedAttachment;
      uiState.replyingToMessageId = null;
      uiState.stagedAttachment = null;
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      input.value = "";

      // Send optimistically without blocking typing or waiting for HTTP round-trip
      store.sendMessage(channel.id, text, { replyToId, attachment });
      const scroller = document.getElementById("messages-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      document.getElementById("composer-text-input")?.focus();
    });
  }

  const editAttachmentForm = document.getElementById("edit-attachment-form");
  if (editAttachmentForm) {
    editAttachmentForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(editAttachmentForm);
      const key = uiState.modalPayload?.target === "call" ? "callStagedAttachment" : "stagedAttachment";
      if (uiState[key]) uiState[key] = { ...uiState[key], name: String(fd.get("name") || uiState[key].name).trim(), spoiler: fd.get("spoiler") === "on" };
      uiState.activeModal = null;
      renderApp();
    });
  }

  // Ctrl+V of an image or a copied file attaches it (sent with the next message)
  const bindPasteAttach = (input, key) => {
    if (!input) return;
    input.addEventListener("paste", async (e) => {
      const file = [...(e.clipboardData?.files || [])][0];
      if (!file) return;
      e.preventDefault();
      const named = file.name && file.name !== "image.png" ? file : new File([file], `imagem-colada-${Date.now()}.png`, { type: file.type || "image/png" });
      showToast("Anexando...");
      const staged = await stageChatFile(named);
      if (!staged) return;
      uiState[key] = staged;
      renderApp();
      const again = key === "callStagedAttachment" ? document.querySelector("#call-chat-form input[name=message]") : document.getElementById("composer-text-input");
      again?.focus();
    });
  };
  bindPasteAttach(document.getElementById("composer-text-input"), "stagedAttachment");
  bindPasteAttach(document.querySelector("#call-chat-form input[name=message]"), "callStagedAttachment");

  // "@" mentions: the people, @everyone/@all/@todos, and server roles in the channel
  const peopleOfChannel = (channelId) => {
    const st = store.getState();
    const dm = st.dms.find((d) => d.id === channelId);
    if (dm) {
      return [dm.userId, st.auth.currentUserId].map((id) => st.users[id]).filter(Boolean);
    }
    const guild = st.guilds.find((g) => g.channels.some((c) => c.id === channelId));
    if (!guild) return [];
    const specialMentions = [
      {
        id: "mention_todos",
        kind: "group",
        username: "todos",
        insertText: "todos",
        displayName: "@todos",
        subtitle: "Marcar todos os membros do servidor",
        aliases: ["todos", "all", "everyone"]
      },
      {
        id: "mention_all",
        kind: "group",
        username: "all",
        insertText: "all",
        displayName: "@all",
        subtitle: "Marcar todos os membros do servidor",
        aliases: ["all", "todos", "everyone"]
      },
      {
        id: "mention_everyone",
        kind: "group",
        username: "everyone",
        insertText: "everyone",
        displayName: "@everyone",
        subtitle: "Marcar todos os membros do servidor",
        aliases: ["everyone", "all", "todos"]
      }
    ];
    const roleMentions = (guild.roles || [])
      .filter((r) => r && r.name && r.name !== "@everyone")
      .map((r) => ({
        id: `role_${r.id}`,
        kind: "role",
        username: r.name,
        insertText: r.name,
        displayName: r.name,
        color: r.color || "#99aab5",
        subtitle: "Cargo do servidor",
        aliases: [r.name.toLowerCase()]
      }));
    const memberUsers = (guild.memberIds || [])
      .map((id) => st.users[id])
      .filter(Boolean)
      .map((u) => ({ ...u, kind: "user" }));
    return [...specialMentions, ...roleMentions, ...memberUsers];
  };
  const mentionAvatar = (u) => renderAvatar(u, "", false, "width:24px;height:24px;min-width:24px;font-size:10px;");
  attachMentionAutocomplete(document.getElementById("composer-text-input"), () => peopleOfChannel(store.getActiveChannel()?.id), mentionAvatar);
  attachMentionAutocomplete(
    document.querySelector("#call-chat-form input[name=message]"),
    () => peopleOfChannel(document.getElementById("call-chat-form")?.getAttribute("data-channel-id")),
    mentionAvatar
  );

  // Typing pings (throttled in the store)
  const composerInput = document.getElementById("composer-text-input");
  if (composerInput) {
    composerInput.addEventListener("input", () => {
      if (composerInput.value.trim()) store.notifyTyping(store.getActiveChannel()?.id);
    });
  }
  const callChatInput = document.querySelector("#call-chat-form input[name=message]");
  if (callChatInput) {
    callChatInput.addEventListener("input", () => {
      if (callChatInput.value.trim()) store.notifyTyping(document.getElementById("call-chat-form")?.getAttribute("data-channel-id"));
    });
  }

  // File Attachment Input
  const fileInput = document.getElementById("composer-file-input");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      uiState.composerMenu = null;
      if (!file) return renderApp();
      const staged = await stageChatFile(file);
      if (staged) uiState.stagedAttachment = staged;
      renderApp();
      document.getElementById("composer-text-input")?.focus();
    });
  }

  // Phase 10: Real Friend Search & Request Form
  const addFriendInput = document.getElementById("add-friend-username-input");
  if (addFriendInput) {
    addFriendInput.addEventListener("input", () => {
      uiState.friendSearchQuery = addFriendInput.value;
      clearTimeout(friendSearchDebounceTimer);
      friendSearchDebounceTimer = setTimeout(async () => {
        uiState.friendSearchResults = await store.searchUsersByUsername(uiState.friendSearchQuery);
        renderApp();
        const el = document.getElementById("add-friend-username-input");
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 120);
    });
  }

  const addFriendForm = document.getElementById("add-friend-form");
  if (addFriendForm) {
    addFriendForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(addFriendForm);
      const rawUsername = fd.get("username");
      const res = await store.addFriendByUsername(rawUsername);
      uiState.friendSearchFeedback = {
        ok: res.ok,
        msg: res.ok
          ? res.autoAccepted
            ? `Vocês e @${res.targetUser.username} agora são amigos!`
            : `Solicitação de amizade enviada para @${res.targetUser.username}!`
          : res.error
      };
      if (res.ok) {
        uiState.friendSearchQuery = "";
        uiState.friendSearchResults = await store.searchUsersByUsername("");
      }
      renderApp();
    });
  }

  // Phase 3: @username Live Availability & Submit
  const usernameInput = document.getElementById("settings-username-input");
  if (usernameInput) {
    usernameInput.addEventListener("input", () => {
      uiState.usernameDraft = usernameInput.value;
      uiState.usernameSaveStatus = null;
      uiState.usernameAvailability = { checking: true };
      clearTimeout(usernameDebounceTimer);
      usernameDebounceTimer = setTimeout(async () => {
        const check = await store.checkUsernameAvailability(uiState.usernameDraft);
        uiState.usernameAvailability = check;
        renderApp();
        const el = document.getElementById("settings-username-input");
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 150);
    });
  }

  const usernameForm = document.getElementById("username-update-form");
  if (usernameForm) {
    usernameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(usernameForm);
      const candidate = fd.get("newUsername");
      const res = await store.updateUsername(candidate);
      if (res.ok) {
        uiState.usernameDraft = res.user.username;
        uiState.usernameAvailability = { available: true, normalized: res.user.username };
        uiState.usernameSaveStatus = {
          ok: true,
          msg: `Identificador atualizado com sucesso para @${res.user.username}!`
        };
        showToast(`@username alterado para @${res.user.username}!`);
      } else {
        uiState.usernameSaveStatus = {
          ok: false,
          msg: res.error || "Não foi possível alterar o @username."
        };
      }
      renderApp();
    });
  }

  // Phase 5: Avatar Photo Upload
  const avatarInput = document.getElementById("avatar-upload-input");
  if (avatarInput) {
    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files?.[0];
      if (!file) return;
      const base64Data = await readFileAsBase64(file);
      const res = await store.uploadMedia({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        kind: "avatar"
      });
      if (res.ok) {
        uiState.stagedAvatar = { url: res.url, name: file.name };
        showToast("Pré-visualização da foto carregada! Clique em 'Confirmar Foto' para salvar.");
      } else {
        showToast(res.error || "Arquivo de foto inválido.");
      }
      renderApp();
    });
  }

  // Server icon & banner uploads (saved immediately)
  for (const [inputId, kind, field, okMsg] of [
    ["guild-icon-upload-input", "avatar", "iconUrl", "Ícone do servidor atualizado!"],
    ["guild-banner-upload-input", "banner", "bannerUrl", "Banner do servidor atualizado!"]
  ]) {
    const input = document.getElementById(inputId);
    if (!input) continue;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      const guild = store.getActiveGuild();
      if (!file || !guild) return;
      const base64Data = await readFileAsBase64(file);
      const up = await store.uploadMedia({ fileName: file.name, mimeType: file.type, base64Data, kind });
      if (!up.ok) {
        showToast(up.error || "Arquivo de imagem inválido.");
        return;
      }
      const res = await store.updateGuild(guild.id, { [field]: up.url });
      showToast(res.ok ? okMsg : res.error || "Não foi possível salvar.");
    });
  }

  // Phase 5: Banner Image / GIF Upload
  const bannerInput = document.getElementById("banner-upload-input");
  if (bannerInput) {
    bannerInput.addEventListener("change", async () => {
      const file = bannerInput.files?.[0];
      if (!file) return;
      const base64Data = await readFileAsBase64(file);
      const res = await store.uploadMedia({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        kind: "banner"
      });
      if (res.ok) {
        uiState.stagedBanner = { url: res.url, name: file.name };
        showToast("Banner carregado na pré-visualização! Clique em 'Confirmar Banner' para salvar.");
      } else {
        showToast(res.error || "Arquivo de banner inválido.");
      }
      renderApp();
    });
  }

  // Phase 5: Custom Banner Color Picker & Framing Slider
  const bannerColorPicker = document.getElementById("custom-banner-color-picker");
  if (bannerColorPicker) {
    bannerColorPicker.addEventListener("change", async () => {
      uiState.stagedBannerColor = bannerColorPicker.value;
      await store.updateMyProfile({ bannerColor: bannerColorPicker.value });
      showToast(`Cor do banner atualizada para ${bannerColorPicker.value}!`);
    });
  }

  const bannerPosSlider = document.getElementById("banner-pos-slider");
  if (bannerPosSlider) {
    bannerPosSlider.addEventListener("input", () => {
      const val = Number(bannerPosSlider.value);
      uiState.stagedBannerPosY = val;
      const lbl = document.getElementById("banner-pos-label");
      if (lbl) lbl.textContent = `${val}%`;
      const bannerImg = document.querySelector(".profile-banner-img");
      if (bannerImg) bannerImg.style.objectPosition = `center ${val}%`;
    });
    bannerPosSlider.addEventListener("change", async () => {
      const val = Number(bannerPosSlider.value);
      await store.updateMyProfile({ bannerPositionY: val });
      showToast("Enquadramento do banner salvo!");
    });
  }

  // Phase 6: Call Sound Presets, Custom Audio Upload & Volume
  const joinPresetSelect = document.getElementById("join-sound-preset-select");
  if (joinPresetSelect) {
    joinPresetSelect.addEventListener("change", async () => {
      await store.updateSetting("joinSoundPreset", joinPresetSelect.value);
      await store.previewCallSound("join");
    });
  }

  const leavePresetSelect = document.getElementById("leave-sound-preset-select");
  if (leavePresetSelect) {
    leavePresetSelect.addEventListener("change", async () => {
      await store.updateSetting("leaveSoundPreset", leavePresetSelect.value);
      await store.previewCallSound("leave");
    });
  }

  const soundVolSlider = document.getElementById("call-sound-volume-slider");
  if (soundVolSlider) {
    soundVolSlider.addEventListener("input", () => {
      const lbl = document.getElementById("call-sound-vol-label");
      if (lbl) lbl.textContent = `${soundVolSlider.value}%`;
    });
    soundVolSlider.addEventListener("change", async () => {
      await store.updateSetting("callSoundVolume", Number(soundVolSlider.value));
    });
  }

  const joinAudioFile = document.getElementById("join-sound-file-input");
  if (joinAudioFile) {
    joinAudioFile.addEventListener("change", async () => {
      const file = joinAudioFile.files?.[0];
      if (!file) return;
      const base64Data = await readFileAsBase64(file);
      const res = await store.uploadMedia({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        kind: "audio"
      });
      if (res.ok) {
        await store.updateSettings({
          joinSoundPreset: "custom",
          joinSoundCustomUrl: res.url,
          joinSoundCustomName: file.name
        });
        showToast(`Som de entrada personalizado (${file.name}) salvo!`);
      } else {
        showToast(res.error || "Arquivo de áudio inválido.");
      }
    });
  }

  const leaveAudioFile = document.getElementById("leave-sound-file-input");
  if (leaveAudioFile) {
    leaveAudioFile.addEventListener("change", async () => {
      const file = leaveAudioFile.files?.[0];
      if (!file) return;
      const base64Data = await readFileAsBase64(file);
      const res = await store.uploadMedia({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        kind: "audio"
      });
      if (res.ok) {
        await store.updateSettings({
          leaveSoundPreset: "custom",
          leaveSoundCustomUrl: res.url,
          leaveSoundCustomName: file.name
        });
        showToast(`Som de saída personalizado (${file.name}) salvo!`);
      } else {
        showToast(res.error || "Arquivo de áudio inválido.");
      }
    });
  }

  // Phase 7: Real Audio Input & Output Device Selection
  const audioInputSel = document.getElementById("audio-input-device-select");
  if (audioInputSel) {
    audioInputSel.addEventListener("change", async () => {
      uiState.selectedAudioInput = audioInputSel.value;
      await store.updateSettings({ voiceInputDeviceId: audioInputSel.value });
      showToast("Dispositivo de entrada de microfone atualizado!");
    });
  }

  const audioOutputSel = document.getElementById("audio-output-device-select");
  if (audioOutputSel) {
    audioOutputSel.addEventListener("change", async () => {
      uiState.selectedAudioOutput = audioOutputSel.value;
      await store.updateSettings({ voiceOutputDeviceId: audioOutputSel.value });
      showToast("Dispositivo de saída de áudio atualizado!");
    });
  }

  // Phase 3 & 7: Mute & Unmute Sounds Controls
  const mutePresetSelect = document.getElementById("mute-sound-preset-select");
  if (mutePresetSelect) {
    mutePresetSelect.addEventListener("change", async () => {
      await store.updateSetting("muteSoundPreset", mutePresetSelect.value);
      await store.previewCallSound("mute");
    });
  }

  const unmutePresetSelect = document.getElementById("unmute-sound-preset-select");
  if (unmutePresetSelect) {
    unmutePresetSelect.addEventListener("change", async () => {
      await store.updateSetting("unmuteSoundPreset", unmutePresetSelect.value);
      await store.previewCallSound("unmute");
    });
  }

  const muteVolSlider = document.getElementById("mute-sound-volume-slider");
  if (muteVolSlider) {
    muteVolSlider.addEventListener("input", () => {
      const lbl = document.getElementById("mute-sound-vol-label");
      if (lbl) lbl.textContent = `${muteVolSlider.value}%`;
    });
    muteVolSlider.addEventListener("change", async () => {
      await store.updateSetting("muteSoundVolume", Number(muteVolSlider.value));
    });
  }

  const muteAudioFile = document.getElementById("mute-sound-file-input");
  if (muteAudioFile) {
    muteAudioFile.addEventListener("change", async () => {
      const file = muteAudioFile.files?.[0];
      if (!file) return;
      const base64Data = await readFileAsBase64(file);
      const res = await store.uploadMedia({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        kind: "audio"
      });
      if (res.ok) {
        await store.updateSettings({
          muteSoundPreset: "custom",
          muteSoundCustomUrl: res.url,
          muteSoundCustomName: file.name
        });
        showToast(`Som de mute personalizado (${file.name}) salvo!`);
      } else {
        showToast(res.error || "Arquivo de áudio inválido.");
      }
    });
  }

  const unmuteAudioFile = document.getElementById("unmute-sound-file-input");
  if (unmuteAudioFile) {
    unmuteAudioFile.addEventListener("change", async () => {
      const file = unmuteAudioFile.files?.[0];
      if (!file) return;
      const base64Data = await readFileAsBase64(file);
      const res = await store.uploadMedia({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        kind: "audio"
      });
      if (res.ok) {
        await store.updateSettings({
          unmuteSoundPreset: "custom",
          unmuteSoundCustomUrl: res.url,
          unmuteSoundCustomName: file.name
        });
        showToast(`Som de unmute personalizado (${file.name}) salvo!`);
      } else {
        showToast(res.error || "Arquivo de áudio inválido.");
      }
    });
  }

  // Phase 2: Role Editor Form & Color Sync
  const roleForm = document.getElementById("edit-role-form");
  if (roleForm) {
    const colorPicker = document.getElementById("role-color-picker");
    const colorHex = document.getElementById("role-color-hex");
    if (colorPicker && colorHex) {
      colorPicker.addEventListener("input", () => { colorHex.value = colorPicker.value; });
      colorHex.addEventListener("input", () => { colorPicker.value = colorHex.value; });
    }

    for (const swatch of roleForm.querySelectorAll("[data-role-color]")) {
      swatch.addEventListener("click", () => {
        if (colorPicker) colorPicker.value = swatch.getAttribute("data-role-color");
        if (colorHex) colorHex.value = swatch.getAttribute("data-role-color");
      });
    }

    roleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const guildId = roleForm.getAttribute("data-guild-id");
      const roleId = roleForm.getAttribute("data-role-id");
      if (roleForm.getAttribute("data-everyone")) {
        const flags = Array.from(roleForm.querySelectorAll(".role-perm-checkbox:checked")).map((b) => b.getAttribute("data-perm-flag"));
        const res = await store.updateEveryonePermissions(guildId, flags);
        showToast(res.ok ? "Permissões de @everyone salvas!" : res.error || "Não foi possível salvar.");
        renderApp();
        return;
      }
      const name = document.getElementById("role-name-input")?.value || "Cargo";
      const color = colorHex?.value || "#99aab5";
      const hoist = Boolean(document.getElementById("role-hoist-checkbox")?.checked);
      const permBoxes = document.querySelectorAll(".role-perm-checkbox:checked");
      const permissions = Array.from(permBoxes).map((b) => b.getAttribute("data-perm-flag"));

      const res = await store.updateRole(guildId, roleId, { name, color, hoist, permissions });
      if (res.ok) {
        showToast("Cargo salvo com sucesso!");
        renderApp();
      } else {
        showToast(res.error || "Erro ao salvar cargo.");
      }
    });
  }

  // Filters that work while typing (no re-render)
  const rolesSearch = document.getElementById("roles-search-input");
  if (rolesSearch) {
    rolesSearch.addEventListener("input", () => {
      const q = rolesSearch.value.toLowerCase();
      uiState.rolesView = { ...(uiState.rolesView || { mode: "list" }), search: rolesSearch.value };
      for (const row of document.querySelectorAll("[data-role-row]")) row.hidden = Boolean(q) && !row.getAttribute("data-role-name").includes(q);
    });
  }
  const rolePickerSearch = document.getElementById("role-picker-search");
  if (rolePickerSearch) {
    rolePickerSearch.addEventListener("input", () => {
      const q = rolePickerSearch.value.toLowerCase();
      if (uiState.rolePicker) uiState.rolePicker.search = rolePickerSearch.value;
      for (const item of document.querySelectorAll(".role-picker-item")) item.hidden = Boolean(q) && !item.getAttribute("data-role-name").includes(q);
    });
  }

  // Member Role Select in User Popout
  const assignRoleSelect = document.querySelector('[data-action="assign-user-role-select"]');
  if (assignRoleSelect) {
    assignRoleSelect.addEventListener("change", async () => {
      const roleId = assignRoleSelect.value;
      if (!roleId) return;
      const guildId = assignRoleSelect.getAttribute("data-guild-id");
      const targetUserId = assignRoleSelect.getAttribute("data-user-id");
      const res = await store.assignMemberRole(guildId, targetUserId, roleId);
      if (res.ok) {
        showToast("Cargo atribuído com sucesso!");
        renderApp();
      } else {
        showToast(res.error || "Erro ao atribuir cargo.");
      }
    });
  }

  // Create Server & Join Server via Invite Forms
  const createServerForm = document.getElementById("create-server-form");
  if (createServerForm) {
    createServerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(createServerForm);
      uiState.activeModal = null;
      const isPublic = fd.get("isPublic") === "on";
      await store.createGuild({ name: fd.get("name"), iconColor: fd.get("iconColor"), isPublic });
      showToast(isPublic ? "Servidor público criado! Ele já aparece em Explorar servidores." : "Servidor criado!");
    });
  }

  const guildPrivacyForm = document.getElementById("guild-privacy-form");
  if (guildPrivacyForm) {
    guildPrivacyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const allowDms = new FormData(guildPrivacyForm).get("allowDms") === "on";
      const res = await store.updateMyGuildMember(guildPrivacyForm.getAttribute("data-guild-id"), { allowDms });
      if (res.ok) uiState.activeModal = null;
      showToast(res.ok ? "Privacidade salva!" : res.error || "Não foi possível salvar.");
      renderApp();
    });
  }

  const guildNicknameForm = document.getElementById("guild-nickname-form");
  if (guildNicknameForm) {
    guildNicknameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nickname = String(new FormData(guildNicknameForm).get("nickname") || "");
      const res = await store.updateMyGuildMember(guildNicknameForm.getAttribute("data-guild-id"), { nickname });
      if (res.ok) uiState.activeModal = null;
      showToast(res.ok ? (res.nickname ? `Apelido salvo: ${res.nickname}` : "Apelido removido.") : res.error || "Não foi possível salvar.");
      renderApp();
    });
  }

  const joinInviteForm = document.getElementById("join-invite-form");
  if (joinInviteForm) {
    joinInviteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(joinInviteForm);
      const code = fd.get("inviteCode");
      const res = await store.acceptServerInvite(code);
      if (res.ok) {
        uiState.activeModal = null;
        uiState.joinInviteError = "";
        showToast(res.alreadyMember ? "Você já é membro deste servidor!" : "Você entrou no servidor pelo convite!");
        renderApp();
      } else {
        uiState.joinInviteError = res.error || "Convite inválido ou expirado.";
        renderApp();
      }
    });
  }

  // Invite Expiration / MaxUses Selectors
  const invExpSelect = document.getElementById("invite-expires-select");
  if (invExpSelect) {
    invExpSelect.addEventListener("change", () => {
      uiState.inviteExpiresIn = Number(invExpSelect.value);
    });
  }
  const invMaxSelect = document.getElementById("invite-maxuses-select");
  if (invMaxSelect) {
    invMaxSelect.addEventListener("change", () => {
      uiState.inviteMaxUses = Number(invMaxSelect.value);
    });
  }

  // Screen Share Quality Selectors
  const ssRes = document.getElementById("screenshare-res-select");
  if (ssRes) {
    ssRes.addEventListener("change", () => {
      uiState.screenShareResolution = ssRes.value;
    });
  }
  const ssFps = document.getElementById("screenshare-fps-select");
  if (ssFps) {
    ssFps.addEventListener("change", () => {
      uiState.screenShareFps = Number(ssFps.value);
    });
  }
  const ssAudio = document.getElementById("screenshare-audio-check");
  if (ssAudio) {
    ssAudio.addEventListener("change", () => {
      uiState.screenShareAudio = ssAudio.checked;
    });
  }

  // Create Channel Form
  const createChannelForm = document.getElementById("create-channel-form");
  if (createChannelForm) {
    createChannelForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(createChannelForm);
      const guild = store.getActiveGuild();
      const catId = uiState.modalPayload?.categoryId || null;
      uiState.activeModal = null;
      if (guild) {
        await store.createChannel(guild.id, {
          name: fd.get("name"),
          type: fd.get("type"),
          topic: fd.get("topic"),
          categoryId: catId
        });
        showToast("Canal criado!");
      }
    });
  }

  const editChannelForm = document.getElementById("edit-channel-form");
  if (editChannelForm) {
    editChannelForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(editChannelForm);
      const changes = { name: fd.get("name"), categoryId: fd.get("categoryId") };
      if (fd.has("topic")) changes.topic = fd.get("topic");
      const res = await store.updateChannel(store.getActiveGuild()?.id, editChannelForm.getAttribute("data-channel-id"), changes);
      if (res.ok) uiState.activeModal = null;
      showToast(res.ok ? "Canal atualizado!" : res.error || "Não foi possível salvar.");
      renderApp();
    });
  }

  const editCategoryForm = document.getElementById("edit-category-form");
  if (editCategoryForm) {
    editCategoryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = new FormData(editCategoryForm).get("name");
      const guildId = store.getActiveGuild()?.id;
      const catId = editCategoryForm.getAttribute("data-category-id");
      const res = catId ? await store.updateCategory(guildId, catId, name) : await store.createCategory(guildId, name);
      if (res.ok) uiState.activeModal = null;
      showToast(res.ok ? (catId ? "Categoria renomeada!" : "Categoria criada! Use o + dela para adicionar canais.") : res.error || "Não foi possível salvar.");
      renderApp();
    });
  }

  // Custom Status Form
  const customStatusForm = document.getElementById("custom-status-form");
  if (customStatusForm) {
    customStatusForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(customStatusForm);
      uiState.activeModal = null;
      await store.updateMyStatus(null, fd.get("customStatus"));
      showToast("Status personalizado atualizado!");
    });
  }

  // Thread Reply Form
  const threadForm = document.getElementById("thread-reply-form");
  if (threadForm) {
    threadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(threadForm);
      const channel = store.getActiveChannel();
      const parentId = store.getState().navigation.activeThreadMessageId;
      if (channel && parentId) {
        await store.sendThreadReply(channel.id, parentId, fd.get("threadText"));
      }
    });
  }

  // User Profile Settings Form
  const profileForm = document.getElementById("user-profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(profileForm);
      await store.updateMyProfile({
        displayName: fd.get("displayName"),
        customStatus: fd.get("customStatus"),
        aboutMe: fd.get("aboutMe")
      });
      showToast("Perfil salvo no SQLite!");
    });
  }

  // Popout Quick DM Form
  const popoutDmForm = document.getElementById("popout-dm-form");
  if (popoutDmForm) {
    popoutDmForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(popoutDmForm);
      const targetUserId = popoutDmForm.getAttribute("data-target-user");
      const text = fd.get("quickDm");
      closeAllFloatingMenus();
      const dm = await store.openOrCreateDm(targetUserId);
      if (dm) {
        await store.sendMessage(dm.id, text);
      }
    });
  }

  // Live Search Inputs
  const chSearch = document.getElementById("channel-search-input");
  if (chSearch) {
    chSearch.addEventListener("input", () => {
      store.getState().navigation.searchQuery = chSearch.value;
      renderApp();
      const el = document.getElementById("channel-search-input");
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  const frSearch = document.getElementById("friends-search-input");
  if (frSearch) {
    frSearch.addEventListener("input", () => {
      store.getState().navigation.friendsSearchQuery = frSearch.value;
      renderApp();
      const el = document.getElementById("friends-search-input");
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  const qsInput = document.getElementById("quick-switcher-input");
  if (qsInput) {
    qsInput.addEventListener("input", () => {
      uiState.quickSwitcherQuery = qsInput.value;
      renderApp();
      const el = document.getElementById("quick-switcher-input");
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  // User Note Input
  document.querySelectorAll("[data-user-note-id]").forEach((input) => {
    input.addEventListener("change", async () => {
      const uid = input.getAttribute("data-user-note-id");
      await store.saveUserNote(uid, input.value);
      showToast("Nota salva!");
    });
  });

  layoutCallGrid();

  // Context menu: volume slider, and keep the menu (and submenus) on screen
  document.querySelectorAll("[data-context-slider]").forEach((input) => {
    input.addEventListener("input", () => {
      const path = input.getAttribute("data-context-slider");
      const item = findContextItem(path);
      if (item) item.value = Number(input.value);
      const label = document.querySelector(`[data-context-slider-value="${CSS.escape(path)}"]`);
      if (label) label.textContent = `${input.value}%`;
      item?.onInput?.(Number(input.value));
    });
  });
  const ctxMenu = document.querySelector(".context-menu");
  if (ctxMenu) {
    const r = ctxMenu.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) ctxMenu.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
    if (r.right > window.innerWidth - 8) ctxMenu.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.right + 220 > window.innerWidth) ctxMenu.classList.add("submenus-left");
    // A submenu that would run past the bottom of the window opens upwards
    // (measured while hidden: shown off-screen for a moment)
    ctxMenu.querySelectorAll(".context-menu-item.has-submenu > .context-submenu").forEach((sub) => {
      const row = sub.parentElement.getBoundingClientRect();
      sub.style.visibility = "hidden";
      sub.style.display = "block";
      const height = sub.getBoundingClientRect().height;
      sub.style.display = "";
      sub.style.visibility = "";
      if (row.top - 6 + height > window.innerHeight - 8) {
        // CSS bottom B puts the submenu's bottom edge at row.bottom - B
        let b = Math.max(-6, row.bottom - (window.innerHeight - 8));
        if (row.bottom - b - height < 8) b = row.bottom - height - 8; // keep its top on screen
        sub.style.top = "auto";
        sub.style.bottom = `${b}px`;
      }
    });
  }

  // Profile view: border flag/colour and call tile colour
  const borderToggle = document.getElementById("profile-border-toggle");
  if (borderToggle) {
    borderToggle.addEventListener("change", async () => {
      await store.updateMyProfile({ profileBorderEnabled: borderToggle.checked });
    });
  }
  const borderColor = document.getElementById("profile-border-color");
  if (borderColor) {
    borderColor.addEventListener("input", () => {
      document.getElementById("profile-view-card")?.style.setProperty("--profile-border", borderColor.value);
    });
    borderColor.addEventListener("change", async () => {
      await store.updateMyProfile({ profileBorderEnabled: true, profileBorderColor: borderColor.value });
    });
  }
  const tileColor = document.getElementById("call-tile-color");
  if (tileColor) {
    tileColor.addEventListener("change", async () => {
      await store.updateMyProfile({ callTileColor: tileColor.value });
    });
  }

  // Profile view: theme flag and colours (live preview while dragging, saved on release)
  const themeToggle = document.getElementById("profile-theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("change", async () => {
      await store.updateMyProfile({ profileThemeEnabled: themeToggle.checked });
    });
  }
  for (const [id, key, cssVar] of [
    ["profile-theme-primary", "profileThemePrimary", "--theme-primary"],
    ["profile-theme-accent", "profileThemeAccent", "--theme-accent"]
  ]) {
    const input = document.getElementById(id);
    if (!input) continue;
    input.addEventListener("input", () => {
      document.getElementById("profile-view-card")?.style.setProperty(cssVar, input.value);
    });
    input.addEventListener("change", async () => {
      await store.updateMyProfile({ [key]: input.value });
    });
  }

  // Call chat: send to the voice channel's own chat
  const callChatForm = document.getElementById("call-chat-form");
  if (callChatForm) {
    const scroller = document.getElementById("call-chat-scroller");
    // Follows new messages, without pulling back someone reading older ones
    if (scroller) {
      const count = scroller.querySelectorAll("[data-message-id]").length;
      const key = callChatForm.getAttribute("data-channel-id");
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
      if (scroller._seenKey !== key || (scroller._seenCount !== count && nearBottom)) {
        scrollChatToBottom(scroller);
      }
      scroller._seenKey = key;
      scroller._seenCount = count;
    }
    callChatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = callChatForm.querySelector("input[name=message]");
      const text = input.value;
      const attachment = uiState.callStagedAttachment;
      if (!text.trim() && !attachment) return;
      input.value = "";
      uiState.callStagedAttachment = null;
      const replyToId = uiState.callReplyToId;
      uiState.callReplyToId = null;
      await store.sendMessage(callChatForm.getAttribute("data-channel-id"), text, { attachment, replyToId });
      const list = document.getElementById("call-chat-scroller");
      if (list) list.scrollTop = list.scrollHeight;
      document.querySelector("#call-chat-form input[name=message]")?.focus();
    });
  }
  const callFileInput = document.getElementById("call-chat-file-input");
  if (callFileInput) {
    callFileInput.addEventListener("change", async () => {
      const file = callFileInput.files?.[0];
      uiState.composerMenu = null;
      if (!file) return renderApp();
      const staged = await stageChatFile(file);
      if (staged) uiState.callStagedAttachment = staged;
      renderApp();
      document.querySelector("#call-chat-form input[name=message]")?.focus();
    });
  }

  // Poll modal: extra options and publishing
  const pollForm = document.getElementById("create-poll-form");
  if (pollForm) {
    document.getElementById("poll-add-option")?.addEventListener("click", () => {
      const list = document.getElementById("poll-option-inputs");
      if (list.children.length >= 10) return showToast("Máximo de 10 opções.");
      const input = document.createElement("input");
      input.className = "form-input";
      input.name = "option";
      input.maxLength = 80;
      input.placeholder = `Opção ${list.children.length + 1}`;
      list.appendChild(input);
      input.focus();
    });
    pollForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(pollForm);
      const poll = { question: fd.get("question"), options: fd.getAll("option").map((o) => String(o).trim()).filter(Boolean) };
      const res = await store.sendMessage(pollForm.getAttribute("data-channel-id"), "", { poll });
      if (!res || res.error) {
        document.getElementById("poll-error").textContent = res?.error || "Não foi possível publicar a enquete.";
        return;
      }
      uiState.activeModal = null;
      renderApp();
      const scroller = document.getElementById("messages-scroller") || document.getElementById("call-chat-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  // Dragging the line between the call and its chat resizes the chat
  const callResizer = document.querySelector("[data-call-chat-resizer]");
  if (callResizer) {
    callResizer.addEventListener("mousedown", (downEvent) => {
      downEvent.preventDefault();
      const stage = callResizer.closest(".call-stage");
      const startX = downEvent.clientX;
      const startWidth = uiState.callChatWidth;
      document.body.classList.add("is-resizing");
      const onMove = (moveEvent) => {
        const next = Math.min(CALL_CHAT_MAX_WIDTH, Math.max(CALL_CHAT_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)));
        uiState.callChatWidth = Math.round(next);
        stage?.style.setProperty("--call-chat-width", `${uiState.callChatWidth}px`);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("is-resizing");
        try {
          localStorage.setItem("eco_call_chat_width", String(uiState.callChatWidth));
        } catch {}
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // Windows & Memória checkboxes
  const openOnStartupBox = document.getElementById("setting-open-on-startup");
  if (openOnStartupBox) {
    openOnStartupBox.addEventListener("change", () => {
      const applied = NativeBridge.setOpenOnStartup(openOnStartupBox.checked);
      openOnStartupBox.checked = applied;
      showToast(applied ? "O app vai iniciar junto com o Windows." : "Início automático desativado.");
    });
  }
  const quitOnCloseBox = document.getElementById("setting-quit-on-close");
  if (quitOnCloseBox) {
    quitOnCloseBox.addEventListener("change", async () => {
      await store.updateSetting("minimizeToTray", !quitOnCloseBox.checked);
    });
  }
  const zoomRange = document.getElementById("ui-zoom-range");
  if (zoomRange) {
    // Applied on release: zooming while dragging would move the slider under the mouse
    zoomRange.addEventListener("input", () => {
      document.getElementById("ui-zoom-label").textContent = `${zoomRange.value}%`;
    });
    zoomRange.addEventListener("change", () => {
      window.DiscordNative?.app?.setZoomFactor?.(Number(zoomRange.value) / 100);
    });
  }
  const fontRange = document.getElementById("font-scale-range");
  if (fontRange) {
    fontRange.addEventListener("input", () => {
      document.getElementById("font-scale-label").textContent = `${fontRange.value}%`;
      document.querySelector(".app-root")?.style.setProperty("--font-scale", String(Number(fontRange.value) / 100));
    });
    fontRange.addEventListener("change", () => store.updateSettings({ fontScale: Number(fontRange.value) / 100 }));
  }

  const gameActivityBox = document.getElementById("setting-show-game-activity");
  if (gameActivityBox) {
    gameActivityBox.addEventListener("change", () => {
      NativeBridge.setSetting("SHOW_GAME_ACTIVITY", gameActivityBox.checked);
      showToast(gameActivityBox.checked ? "Seus jogos vão aparecer no perfil." : "Seus jogos não vão mais aparecer.");
    });
  }
  const spotifyBox = document.getElementById("setting-spotify-sync");
  if (spotifyBox) {
    spotifyBox.addEventListener("change", () => {
      NativeBridge.setSetting("SPOTIFY_SYNC", spotifyBox.checked);
      if (!spotifyBox.checked) store.reportListening({ kind: "spotify", state: "stopped" });
      showToast(spotifyBox.checked ? "Spotify sincronizado: dê play e a música aparece no seu perfil." : "Spotify desconectado do perfil.");
    });
  }

  const hwAccelBox = document.getElementById("setting-hardware-acceleration");
  if (hwAccelBox) {
    hwAccelBox.addEventListener("change", () => {
      NativeBridge.setGpuAcceleration(hwAccelBox.checked);
      showToast("Reinicie o app para aplicar a mudança na aceleração de hardware.");
    });
  }
  const memorySaverBox = document.getElementById("setting-memory-saver");
  if (memorySaverBox) {
    memorySaverBox.addEventListener("change", async () => {
      const on = window.DiscordNative?.processUtils?.setMemorySaver?.(memorySaverBox.checked);
      uiState.memorySaver = Boolean(on);
      memorySaverBox.checked = Boolean(on);
      if (on) {
        await NativeBridge.purgeMemory();
      }
      renderApp();
      showToast(on ? "Economia de memória ligada (< 100 MB)." : "Economia de memória desligada: o app fica mais fluido.");
      setTimeout(refreshMemoryUsageLabel, 500);
      setTimeout(refreshMemoryUsageLabel, 1500);
    });
  }
  if (document.getElementById("memory-usage-label")) refreshMemoryUsageLabel();

  // Account security forms (e-mail change, password, verification codes)
  document.querySelectorAll("[data-account-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (uiState.accountBusy) return;
      const kind = form.getAttribute("data-account-form");
      const fd = new FormData(form);
      if (kind === "email-change") {
        const ok = await runAccountAction(
          "email",
          () => store.requestEmailChange(fd.get("newEmail"), fd.get("currentPassword")),
          (res) => `Código enviado para ${res.sentTo}.`
        );
        if (ok) document.querySelector('[data-account-form="code"] input[name="code"]')?.focus();
      } else if (kind === "password") {
        if (fd.get("newPassword") !== fd.get("confirmPassword")) {
          applyAccountResult({ ok: false, error: "A confirmação não corresponde à nova senha." }, "password");
          return;
        }
        const ok = await runAccountAction(
          "password",
          () => store.changePassword(fd.get("currentPassword"), fd.get("newPassword")),
          "Senha alterada com sucesso."
        );
        if (ok) {
          uiState.accountPanel = null;
          renderApp();
        }
      } else if (kind === "code") {
        const purpose = form.getAttribute("data-purpose");
        const scope = form.getAttribute("data-scope");
        const code = fd.get("code");
        const confirmFn = {
          email_verify: () => store.confirmEmailVerification(code),
          email_change: () => store.confirmEmailChange(code)
        }[purpose];
        const successMsg = {
          email_verify: "E-mail verificado!",
          email_change: "E-mail alterado e verificado!"
        }[purpose];
        const ok = await runAccountAction(scope, confirmFn, successMsg);
        if (ok) {
          uiState.accountPanel = null;
          uiState.accountDevCode = null;
          renderApp();
          showToast(successMsg);
        }
      }
    });
  });

  // Quick account switch: requires the target account's password
  const switchForm = document.getElementById("switch-account-form");
  if (switchForm) {
    switchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const prompt = uiState.switchAccountPrompt;
      if (!prompt) return;
      const password = document.getElementById("switch-account-password")?.value || "";
      const res = await store.switchAccount(prompt.userId, password);
      if (res.accountRemoved) {
        uiState.switchAccountPrompt = null;
        showToast(res.error);
        renderApp();
        return;
      }
      if (!res.ok) {
        uiState.switchAccountPrompt = { ...prompt, error: res.error || "Senha incorreta." };
        renderApp();
        document.getElementById("switch-account-password")?.focus();
        return;
      }
      uiState.switchAccountPrompt = null;
      uiState.usernameDraft = null;
      uiState.usernameAvailability = null;
      uiState.usernameSaveStatus = null;
      resetAccountUi();
      uiState.accountSecurity = null;
      renderApp();
      showToast(`Alternado para @${store.getCurrentUser().username}`);
    });
  }

  // Confirmation dialog (submit = confirm, so Enter works from the password field)
  const confirmForm = document.getElementById("confirm-dialog-form");
  if (confirmForm) {
    confirmForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pending = uiState.confirmDialog;
      if (!pending) return;
      if (pending.requirePassword) {
        pending.password = document.getElementById("confirm-dialog-password")?.value || "";
      }
      uiState.confirmDialog = null;
      renderApp();
      await replayConfirmedAction(pending);
    });
  }

  // Inline Message Edit Keyboard Handler
  document.querySelectorAll("[data-edit-id]").forEach((input) => {
    input.addEventListener("keydown", async (e) => {
      const msgId = input.getAttribute("data-edit-id");
      const channelId = channelIdOfMessage(msgId);
      if (e.key === "Escape") {
        uiState.editingMessageId = null;
        renderApp();
      } else if (e.key === "Enter" && channelId) {
        await store.editMessage(channelId, msgId, input.value);
        uiState.editingMessageId = null;
        renderApp();
      }
    });
  });
}

// ==========================================================================
// Global Click & Context Menu Delegation (with Phase 4 Outside-Click Dismissal)
// ==========================================================================
// ==========================================================================
// Confirmation dialog for everything that deletes or removes something
// ==========================================================================
const truncate = (text, max = 120) => {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

const DESTRUCTIVE_ACTIONS = {
  "kick-member": (btn) => {
    const u = store.getState().users[btn.getAttribute("data-user-id")];
    return {
      title: "Expulsar membro",
      message: `Expulsar <strong>@${escapeHtml(u?.username || "membro")}</strong> do servidor? A pessoa pode voltar se receber um convite.`,
      confirmLabel: "Expulsar"
    };
  },
  "delete-category": (btn) => {
    const cat = store.getActiveGuild()?.categories.find((c) => c.id === btn.getAttribute("data-category-id"));
    return {
      title: "Excluir categoria",
      message: `Excluir a categoria <strong>${escapeHtml(cat?.name || "")}</strong>? Ela precisa estar vazia (mova ou exclua os canais antes).`,
      confirmLabel: "Excluir Categoria"
    };
  },
  "ban-member": (btn) => {
    const u = store.getState().users[btn.getAttribute("data-user-id")];
    return {
      title: "Banir membro",
      message: `Banir <strong>@${escapeHtml(u?.username || "membro")}</strong> do servidor? A pessoa sai na hora e não consegue voltar por convite.`,
      confirmLabel: "Banir"
    };
  },
  "delete-guild": (btn) => {
    const g = store.getState().guilds.find((x) => x.id === btn.getAttribute("data-guild-id"));
    return {
      title: "Apagar servidor",
      message: `Apagar <strong>${escapeHtml(g?.name || "este servidor")}</strong> para todos os membros? Canais, mensagens, cargos e convites serão perdidos. Esta ação não pode ser desfeita.`,
      confirmLabel: "Apagar Servidor",
      requirePassword: true
    };
  },
  "delete-channel": (btn) => {
    const ch = store.getActiveGuild()?.channels.find((c) => c.id === btn.getAttribute("data-channel-id"));
    return {
      title: "Excluir canal",
      message: `Tem certeza que deseja excluir <strong>${ch?.type === "voice" ? "🔊 " : "#"}${escapeHtml(ch?.name || "canal")}</strong>? Todas as mensagens dele serão perdidas. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir Canal"
    };
  },
  "delete-message": (btn) => {
    const msgChannelId = channelIdOfMessage(btn.getAttribute("data-message-id"));
    const msg = (store.getState().messages[msgChannelId] || []).find((m) => m.id === btn.getAttribute("data-message-id"));
    return {
      title: "Excluir mensagem",
      message: "Tem certeza que deseja excluir esta mensagem? Esta ação não pode ser desfeita.",
      quote: msg?.content ? truncate(msg.content) : msg?.attachment ? "📎 Anexo" : "",
      confirmLabel: "Excluir"
    };
  },
  "delete-role": (btn) => {
    const guild = store.getState().guilds.find((g) => g.id === btn.getAttribute("data-guild-id"));
    const role = guild?.roles.find((r) => r.id === btn.getAttribute("data-role-id"));
    return {
      title: "Excluir cargo",
      message: `Tem certeza que deseja excluir o cargo <strong>${escapeHtml(role?.name || "cargo")}</strong>? Ele será removido de todos os membros.`,
      confirmLabel: "Excluir Cargo"
    };
  },
  "remove-user-role": (btn) => {
    const state = store.getState();
    const guild = state.guilds.find((g) => g.id === btn.getAttribute("data-guild-id"));
    const role = guild?.roles.find((r) => r.id === btn.getAttribute("data-role-id"));
    const user = state.users[btn.getAttribute("data-user-id")];
    return {
      title: "Remover cargo",
      message: `Remover o cargo <strong>${escapeHtml(role?.name || "cargo")}</strong> de <strong>${escapeHtml(user?.displayName || "membro")}</strong>?`,
      confirmLabel: "Remover"
    };
  },
  "revoke-invite": (btn) => ({
    title: "Revogar convite",
    message: `O convite <strong>${escapeHtml(btn.getAttribute("data-code"))}</strong> deixará de funcionar imediatamente para quem ainda não entrou.`,
    confirmLabel: "Revogar"
  }),
  "remove-friend": (btn) => {
    const user = store.getState().users[btn.getAttribute("data-user-id")];
    return {
      title: "Desfazer amizade",
      message: `Tem certeza que deseja remover <strong>${escapeHtml(user?.displayName || "este usuário")}</strong> dos seus amigos?`,
      confirmLabel: "Remover Amigo"
    };
  },
  "leave-guild": (btn) => {
    const guild = store.getState().guilds.find((g) => g.id === btn.getAttribute("data-guild-id"));
    return {
      title: `Sair de ${escapeHtml(guild?.name || "servidor")}`,
      message: `Tem certeza que deseja sair de <strong>${escapeHtml(guild?.name || "este servidor")}</strong>? Você só poderá voltar com um novo convite${guild?.isPublic ? " ou pelo Explorar servidores" : ""}.`,
      confirmLabel: "Sair do servidor"
    };
  },
  "block-friend": (btn) => {
    const user = store.getState().users[btn.getAttribute("data-user-id")];
    return {
      title: "Bloquear usuário",
      message: `Bloquear <strong>${escapeHtml(user?.displayName || "este usuário")}</strong>? Ele será removido dos seus amigos e não poderá mais enviar mensagens para você.`,
      confirmLabel: "Bloquear"
    };
  },
  "remove-avatar": () => ({
    title: "Remover foto de perfil",
    message: "Sua foto de perfil será removida e substituída pelas suas iniciais.",
    confirmLabel: "Remover Foto"
  }),
  "remove-banner-image": () => ({
    title: "Remover imagem do banner",
    message: "A imagem/GIF do banner será removida. A cor do banner continuará aplicada.",
    confirmLabel: "Remover Imagem"
  }),
  "remove-guild-icon": () => ({
    title: "Remover ícone do servidor",
    message: "O ícone será removido e o servidor voltará a exibir as iniciais.",
    confirmLabel: "Remover Ícone"
  }),
  "remove-guild-banner": () => ({
    title: "Remover banner do servidor",
    message: "O banner deixará de aparecer no topo da lista de canais.",
    confirmLabel: "Remover Banner"
  })
};

function openConfirmDialog(action, btn) {
  const spec = DESTRUCTIVE_ACTIONS[action](btn);
  const attrs = {};
  for (const { name, value } of Array.from(btn.attributes)) {
    if (name.startsWith("data-")) attrs[name] = value;
  }
  closeAllFloatingMenus();
  uiState.confirmDialog = { ...spec, attrs };
  renderApp();
  document.getElementById(spec.requirePassword ? "confirm-dialog-password" : "confirm-dialog-accept-btn")?.focus();
}

async function replayConfirmedAction(pending) {
  const el = document.createElement("button");
  for (const [name, value] of Object.entries(pending.attrs)) el.setAttribute(name, value);
  if (pending.password !== undefined) el.setAttribute("data-password", pending.password);
  await handleGlobalClick({ target: el, confirmed: true, stopPropagation() {}, preventDefault() {} });
}

function renderSwitchAccountPrompt() {
  const prompt = uiState.switchAccountPrompt;
  if (!prompt) return "";
  const user = store.getState().users[prompt.userId] || store.getSavedAccounts().find((a) => a.id === prompt.userId);
  if (!user) return "";
  return `
    <div class="modal-backdrop confirm-backdrop" data-action="switch-account-backdrop">
      <form class="modal-card confirm-card" id="switch-account-form" data-testid="switch-account-modal" aria-labelledby="switch-account-title">
        <div class="confirm-body" style="align-items:center;">
          ${renderAvatar(user, "lg")}
          <div style="min-width:0;flex:1;">
            <h2 id="switch-account-title" style="margin-bottom:2px;">Entrar como ${escapeHtml(user.displayName)}</h2>
            <p style="color:var(--text-muted);font-size:13px;">@${escapeHtml(user.username)}</p>
          </div>
        </div>
        <div style="padding:0 20px 20px 20px;display:flex;flex-direction:column;gap:6px;">
          <label class="form-label" for="switch-account-password">Senha desta conta</label>
          <input class="form-input" type="password" id="switch-account-password" autocomplete="current-password" required />
          ${prompt.error ? `<div class="form-error" data-testid="switch-account-error">${escapeHtml(prompt.error)}</div>` : ""}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="cancel-switch-account">Cancelar</button>
          <button type="submit" class="btn btn-primary" data-testid="switch-account-submit">Entrar</button>
        </div>
      </form>
    </div>
  `;
}

function renderConfirmDialog() {
  const d = uiState.confirmDialog;
  if (!d) return "";
  return `
    <div class="modal-backdrop confirm-backdrop" data-action="confirm-dialog-backdrop">
      <form class="modal-card confirm-card" id="confirm-dialog-form" data-testid="confirm-dialog" role="alertdialog" aria-labelledby="confirm-dialog-title">
        <div class="confirm-body">
          <div class="confirm-icon">${Icons.alert}</div>
          <div style="min-width:0;flex:1;">
            <h2 id="confirm-dialog-title">${escapeHtml(d.title)}</h2>
            <p>${d.message}</p>
            ${d.quote ? `<blockquote class="confirm-quote">${escapeHtml(d.quote)}</blockquote>` : ""}
            ${
              d.requirePassword
                ? `<label class="form-label" for="confirm-dialog-password" style="display:block;margin-top:14px;">Senha atual</label>
                   <input class="form-input" style="width:100%;margin-top:6px;" type="password" id="confirm-dialog-password" autocomplete="current-password" required />`
                : ""
            }
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="confirm-dialog-cancel" data-testid="confirm-dialog-cancel">Cancelar</button>
          <button type="submit" class="btn btn-danger" id="confirm-dialog-accept-btn" data-testid="confirm-dialog-accept">${escapeHtml(d.confirmLabel || "Confirmar")}</button>
        </div>
      </form>
    </div>
  `;
}

// ==========================================================================
// Account security helpers
// ==========================================================================
async function loadAccountSecurity() {
  const res = await store.getAccountSecurity();
  if (res.ok) {
    uiState.accountSecurity = res.security;
    renderApp();
  }
}

function resetAccountUi() {
  uiState.accountPanel = null;
  uiState.accountFeedback = null;
  uiState.accountDevCode = null;
  uiState.accountBusy = false;
}

// Applies a response from an account RPC: refreshes the security snapshot,
// shows feedback in the right row and keeps the dev-mode code visible.
function applyAccountResult(res, scope, successMsg) {
  if (res.security) uiState.accountSecurity = res.security;
  uiState.accountBusy = false;
  if (res.ok) {
    uiState.accountDevCode = res.devMode ? { scope, code: res.devCode, channel: res.channel } : null;
    // In dev mode nothing was actually sent, so the dev-code note replaces the "sent" message
    uiState.accountFeedback = successMsg && !res.devMode ? { scope, ok: true, msg: successMsg } : null;
  } else {
    uiState.accountFeedback = { scope, ok: false, msg: res.error || "Não foi possível concluir a ação." };
  }
  renderApp();
  return res.ok;
}

async function runAccountAction(scope, fn, successMsg) {
  uiState.accountBusy = true;
  uiState.accountFeedback = null;
  renderApp();
  const res = await fn();
  return applyAccountResult(res, scope, typeof successMsg === "function" ? successMsg(res) : successMsg);
}

async function handleGlobalClick(e) {
  // 1. Handle Context Menu Item Click or Dismiss
  if (uiState.contextMenu) {
    const ctxIdxBtn = e.target.closest("[data-context-idx]");
    if (ctxIdxBtn) {
      const item = findContextItem(ctxIdxBtn.getAttribute("data-context-idx"));
      if (item?.type === "checkbox") {
        item.checked = !item.checked;
        if (typeof item.onToggle === "function") await item.onToggle(item.checked);
        renderApp();
        return;
      }
      // A choice among siblings: the menu stays open showing the new one
      if (item?.type === "radio") {
        const path = ctxIdxBtn.getAttribute("data-context-idx").split(".");
        path.pop();
        const siblings = path.length ? findContextItem(path.join("."))?.items || [] : uiState.contextMenu.items;
        for (const s of siblings) if (s.type === "radio") s.checked = s === item;
        if (typeof item.onClick === "function") await item.onClick();
        renderApp();
        return;
      }
      uiState.contextMenu = null;
      if (item && typeof item.onClick === "function") await item.onClick();
      renderApp();
      return;
    }
    if (e.target.closest(".context-menu")) return;
    uiState.contextMenu = null;
    renderApp();
  }

  const btn = e.target.closest("[data-action]");
  const clickedInsideFloating = Boolean(e.target.closest(".floating-popout, .composer-plus-menu"));

  // 2. Phase 4: If user clicked outside any open floating popout/menu and did NOT click a trigger button, close all floating menus immediately
  if (!btn && !clickedInsideFloating && hasAnyOpenFloatingMenu()) {
    closeAllFloatingMenus();
    renderApp();
    return;
  }

  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const state = store.getState();

  // Destructive actions go through the confirmation dialog first; on confirm the
  // same action is replayed with e.confirmed set.
  if (!e.confirmed && DESTRUCTIVE_ACTIONS[action]) {
    e.stopPropagation();
    openConfirmDialog(action, btn);
    return;
  }

  switch (action) {
    case "toggle-composer-menu": {
      e.stopPropagation();
      const target = btn.getAttribute("data-target");
      const next = uiState.composerMenu === target ? null : target;
      closeAllFloatingMenus("composerMenu");
      uiState.composerMenu = next;
      renderApp();
      break;
    }
    case "open-poll-modal":
      closeAllFloatingMenus();
      uiState.activeModal = "create-poll";
      uiState.modalPayload = { channelId: btn.getAttribute("data-channel-id") };
      renderApp();
      document.getElementById("poll-question")?.focus();
      break;
    case "vote-poll": {
      const res = await store.votePoll(btn.getAttribute("data-channel-id"), btn.getAttribute("data-message-id"), btn.getAttribute("data-option-id"));
      if (!res.ok) showToast(res.error || "Não foi possível votar.");
      break;
    }
    case "clear-call-attachment":
      uiState.callStagedAttachment = null;
      renderApp();
      break;
    case "focus-call-tile": {
      const uid = btn.getAttribute("data-user-id");
      // Clicking the tile that is already big goes back to the grid
      const isFocused = Boolean(btn.closest(".call-focus"));
      uiState.callFocusUserId = isFocused ? null : uid;
      renderApp();
      break;
    }
    case "call-show-grid":
      e.stopPropagation();
      uiState.callFocusUserId = null;
      renderApp();
      break;
    case "record-mute-hotkey":
      uiState.recordingMuteHotkey = true;
      uiState.muteHotkeyError = "";
      renderApp();
      break;
    case "cancel-mute-hotkey":
      uiState.recordingMuteHotkey = false;
      uiState.muteHotkeyError = "";
      renderApp();
      break;
    case "clear-mute-hotkey":
      saveMuteHotkey("");
      break;
    case "toggle-call-chat":
      uiState.callChatOpen = !uiState.callChatOpen;
      renderApp();
      if (uiState.callChatOpen) document.querySelector("#call-chat-form input")?.focus();
      break;
    case "open-call-view":
      store.openCallView(btn.getAttribute("data-channel-id"));
      break;
    case "stop-watching-stream":
      e.stopPropagation();
      setStreamWatched(btn.getAttribute("data-user-id"), false);
      if (uiState.callFocusUserId === btn.getAttribute("data-user-id")) uiState.callFocusUserId = undefined;
      renderApp();
      break;
    case "toggle-call-strip":
      e.stopPropagation();
      uiState.callStripHidden = !uiState.callStripHidden;
      try {
        localStorage.setItem("eco_call_strip_hidden", uiState.callStripHidden ? "1" : "0");
      } catch {}
      renderApp();
      break;
    case "watch-stream-popup":
      setStreamWatched(btn.getAttribute("data-user-id"), true);
      renderApp();
      break;
    case "watch-stream": {
      e.stopPropagation();
      const sharer = btn.getAttribute("data-user-id");
      setStreamWatched(sharer, true);
      // Watching someone's screen enlarges it
      uiState.callFocusUserId = sharer;
      renderApp();
      break;
    }
    case "toggle-audio-menu": {
      e.stopPropagation();
      const kind = btn.getAttribute("data-kind");
      const next = uiState.audioMenu === kind ? null : kind;
      closeAllFloatingMenus("audioMenu");
      uiState.audioMenu = next;
      renderApp();
      if (next) {
        VoiceDevices.enumerateDevices().then((res) => {
          uiState.audioInputDevices = res.inputDevices || [];
          uiState.audioOutputDevices = res.outputDevices || [];
          if (uiState.audioMenu) renderApp();
        });
      }
      break;
    }
    case "pick-audio-device": {
      const kind = btn.getAttribute("data-kind");
      const deviceId = btn.getAttribute("data-device-id");
      uiState.audioMenu = null;
      if (kind === "input") {
        uiState.selectedAudioInput = deviceId;
        await store.updateSettings({ voiceInputDeviceId: deviceId });
      } else {
        uiState.selectedAudioOutput = deviceId;
        await store.updateSettings({ voiceOutputDeviceId: deviceId });
      }
      const label = (kind === "input" ? uiState.audioInputDevices : uiState.audioOutputDevices).find((d) => d.deviceId === deviceId)?.label;
      showToast(`${kind === "input" ? "Entrada" : "Saída"}: ${label || "dispositivo padrão"}`);
      renderApp();
      break;
    }
    case "open-profile-view":
      e.stopPropagation();
      openProfileView(btn.getAttribute("data-user-id"));
      break;
    case "close-profile-view":
      uiState.profileView = null;
      renderApp();
      break;
    case "close-profile-view-backdrop":
      if (e.target === btn) {
        uiState.profileView = null;
        renderApp();
      }
      break;
    case "open-profile-settings":
      uiState.profileView = null;
      uiState.settingsOverlay = { type: "user", tab: "profile" };
      renderApp();
      break;
    case "set-profile-border-color":
      await store.updateMyProfile({ profileBorderEnabled: true, profileBorderColor: btn.getAttribute("data-color") });
      break;
    case "set-call-tile-color":
      await store.updateMyProfile({ callTileColor: btn.getAttribute("data-color") });
      break;
    case "set-profile-theme":
      await store.updateMyProfile({
        profileThemeEnabled: true,
        profileThemePrimary: btn.getAttribute("data-primary"),
        profileThemeAccent: btn.getAttribute("data-accent")
      });
      break;
    case "surprise-profile-theme": {
      const [primary, accent] = PROFILE_THEME_PRESETS[Math.floor(Math.random() * PROFILE_THEME_PRESETS.length)];
      const bannerColor = BANNER_SWATCHES[Math.floor(Math.random() * BANNER_SWATCHES.length)];
      await store.updateMyProfile({ profileThemeEnabled: true, profileThemePrimary: primary, profileThemeAccent: accent, bannerColor });
      break;
    }
    case "set-banner-editor-mode":
      uiState.bannerEditorMode = btn.getAttribute("data-mode");
      renderApp();
      break;
    case "account-toggle-panel": {
      const panel = btn.getAttribute("data-panel");
      const opening = uiState.accountPanel !== panel;
      uiState.accountPanel = opening ? panel : null;
      uiState.accountFeedback = null;
      if (panel === "username") {
        uiState.usernameDraft = store.getCurrentUser().username;
        uiState.usernameAvailability = null;
        uiState.usernameSaveStatus = null;
      }
      renderApp();
      if (opening) {
        document.querySelector(".account-editor input")?.focus();
      }
      break;
    }
    case "account-request-email-verify":
    case "account-resend-email-verify":
      await runAccountAction("email", () => store.requestEmailVerification(), (res) => `Código enviado para ${res.sentTo}.`);
      document.querySelector('[data-account-form="code"] input[name="code"]')?.focus();
      break;
    case "account-cancel-pending": {
      const purpose = btn.getAttribute("data-purpose");
      const scope = "email";
      const reopen = purpose !== "email_verify";
      await runAccountAction(scope, () => store.cancelPendingVerification(purpose));
      uiState.accountDevCode = null;
      uiState.accountPanel = reopen ? scope : null;
      renderApp();
      break;
    }
    case "confirm-dialog-cancel":
      uiState.confirmDialog = null;
      renderApp();
      break;
    case "confirm-dialog-backdrop":
      if (e.target === btn) {
        uiState.confirmDialog = null;
        renderApp();
      }
      break;
    case "win-minimize":
      NativeBridge.minimizeWindow();
      break;
    case "win-maximize":
      NativeBridge.maximizeWindow();
      break;
    case "win-close":
      NativeBridge.closeWindow();
      break;
    case "open-rea-info":
      closeAllFloatingMenus();
      uiState.activeModal = "rea-info";
      renderApp();
      break;
    case "switch-auth-mode":
      state.auth.mode = btn.getAttribute("data-mode");
      renderApp();
      break;
    case "quick-switch-user": {
      // Accounts that signed in here before switch straight away; others ask for the password
      closeAllFloatingMenus();
      const userId = btn.getAttribute("data-user-id");
      if (userId === store.getState().auth.currentUserId && store.getState().auth.isAuthenticated) break;
      const res = await store.switchAccount(userId);
      if (res.ok) {
        uiState.settingsOverlay = null;
        showToast(`Conectado como @${res.user.username}`);
        renderApp();
        break;
      }
      uiState.switchAccountPrompt = { userId, error: res.needsPassword ? "" : res.error || "" };
      renderApp();
      document.getElementById("switch-account-password")?.focus();
      break;
    }
    case "cancel-switch-account":
      uiState.switchAccountPrompt = null;
      renderApp();
      break;
    case "switch-account-backdrop":
      if (e.target === btn) {
        uiState.switchAccountPrompt = null;
        renderApp();
      }
      break;
    case "email-gate-resend": {
      const res = await store.resendEmailGateCode();
      showToast(res.ok ? `Código enviado para ${res.sentTo}.` : res.error || "Não foi possível enviar o código.");
      break;
    }
    case "logout":
      closeAllFloatingMenus();
      uiState.settingsOverlay = null;
      uiState.toasts = [];
      renderToasts();
      await store.logout();
      break;
    case "select-home":
      closeAllFloatingMenus();
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      store.selectHome("friends");
      break;
    case "home-nav":
      closeAllFloatingMenus();
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      store.selectHome(btn.getAttribute("data-section"));
      break;
    case "open-dm":
      closeAllFloatingMenus();
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      store.selectHome("dm", btn.getAttribute("data-dm-id"));
      requestAnimationFrame(() => {
        scrollChatToBottom(document.getElementById("messages-scroller"));
      });
      break;
    case "select-guild":
      closeAllFloatingMenus();
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      store.selectGuild(btn.getAttribute("data-guild-id"));
      requestAnimationFrame(() => {
        scrollChatToBottom(document.getElementById("messages-scroller"));
      });
      break;
    case "select-channel":
      closeAllFloatingMenus();
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      store.selectChannel(btn.getAttribute("data-channel-id"));
      requestAnimationFrame(() => {
        scrollChatToBottom(document.getElementById("messages-scroller"));
      });
      break;
    case "select-discovery":
      closeAllFloatingMenus();
      store.selectDiscovery();
      break;
    case "join-discoverable":
      closeAllFloatingMenus();
      await store.joinDiscoverableGuild(btn.getAttribute("data-disc-id"));
      showToast("Servidor aberto!");
      break;
    case "friends-tab":
      closeAllFloatingMenus();
      state.navigation.view = "home";
      state.navigation.homeSection = "friends";
      state.navigation.friendsTab = btn.getAttribute("data-tab");
      uiState.friendSearchFeedback = null;
      if (state.navigation.friendsTab === "add") {
        uiState.friendSearchResults = await store.searchUsersByUsername(uiState.friendSearchQuery);
      }
      renderApp();
      break;
    case "open-link": {
      e.preventDefault();
      const url = btn.getAttribute("data-url");
      // Our own invite links join the server right here in the app
      const base = (store.getState().appConfig?.publicUrl || "").replace(/\/+$/, "");
      if (base && url.startsWith(`${base}/convite/`)) {
        const res = await store.acceptServerInvite(url);
        showToast(res.ok ? (res.alreadyMember ? "Você já está nesse servidor." : `Você entrou em ${res.guildName || "um servidor"}!`) : res.error || "Convite inválido.");
        renderApp();
      } else if (/^https?:\/\//i.test(url)) {
        window.open(url, "_blank", "noopener"); // main process opens it in the browser
      }
      break;
    }
    case "check-updates":
      await checkForUpdates({ quiet: false });
      break;
    case "dismiss-update-banner":
      uiState.updateBannerDismissed = uiState.updateInfo?.latest || true;
      renderApp();
      break;
    case "install-update": {
      // Downloads inside the app (progress below the button); closes only when ready
      uiState.updatingApp = true;
      uiState.updatePercent = 0;
      uiState.updateLabel = "Preparando o download...";
      renderApp();
      const res = await window.DiscordNative?.app?.installUpdate?.();
      if (res?.ok) {
        uiState.updateLabel = "Pronto! Instalando... o app fecha e abre de novo sozinho.";
        paintUpdateProgress();
      } else {
        uiState.updatingApp = false;
        renderApp();
        showToast(res?.error || "Não foi possível atualizar.");
      }
      break;
    }
    case "reset-ui-scale":
      window.DiscordNative?.app?.setZoomFactor?.(1);
      await store.updateSettings({ fontScale: 1 });
      renderApp();
      break;
    case "open-media-viewer":
      uiState.mediaViewer = { url: btn.getAttribute("data-url"), name: btn.getAttribute("data-name") };
      renderApp();
      break;
    case "close-media-viewer":
      // Clicks on the image itself or the bar buttons do not close it
      if (e.target.closest("[data-media-viewer-img]") || (e.target.closest(".media-viewer-bar") && btn.getAttribute("data-action") !== "close-media-viewer")) break;
      if (btn.classList.contains("media-viewer") && e.target !== btn) break;
      uiState.mediaViewer = null;
      renderApp();
      break;
    case "download-file": {
      e.stopPropagation();
      const url = btn.getAttribute("data-url");
      if (window.DiscordNative?.settings?.downloadUrl) window.DiscordNative.settings.downloadUrl(url);
      else window.open(url, "_blank");
      break;
    }
    case "reveal-spoiler":
      e.stopPropagation();
      btn.closest(".spoiler")?.classList.remove("spoiler");
      btn.remove();
      break;
    case "edit-staged-attachment":
      uiState.activeModal = "edit-attachment";
      uiState.modalPayload = { target: btn.getAttribute("data-target") };
      renderApp();
      break;
    case "close-dm":
      e.stopPropagation();
      await store.closeDm(btn.getAttribute("data-dm-id"));
      break;
    case "popout-message": {
      const dm = await store.openOrCreateDm(btn.getAttribute("data-user-id"));
      closeAllFloatingMenus();
      uiState.profileView = null;
      if (!dm) showToast("Não foi possível abrir a conversa.");
      renderApp();
      break;
    }
    case "ban-member": {
      const res = await store.banMember(btn.getAttribute("data-guild-id"), btn.getAttribute("data-user-id"));
      closeAllFloatingMenus();
      showToast(res.ok ? "Membro banido do servidor." : res.error || "Não foi possível banir.");
      renderApp();
      break;
    }
    case "delete-guild": {
      const res = await store.deleteGuild(btn.getAttribute("data-guild-id"), btn.getAttribute("data-password") || "");
      closeAllFloatingMenus();
      uiState.settingsOverlay = null;
      showToast(res.ok ? "Servidor apagado." : res.error || "Não foi possível apagar o servidor.");
      renderApp();
      break;
    }
    case "send-friend-req-id": {
      const uid = btn.getAttribute("data-user-id");
      const res = await store.sendFriendRequestToUser(uid);
      uiState.friendSearchFeedback = {
        ok: res.ok,
        msg: res.ok ? `Pedido de amizade enviado para @${res.targetUser.username}!` : res.error
      };
      uiState.friendSearchResults = await store.searchUsersByUsername(uiState.friendSearchQuery);
      renderApp();
      break;
    }
    case "message-friend":
      e.stopPropagation();
      closeAllFloatingMenus();
      await store.openOrCreateDm(btn.getAttribute("data-user-id"));
      break;
    case "accept-friend":
      e.stopPropagation();
      await store.respondFriendRequest(btn.getAttribute("data-user-id"), "accept");
      uiState.friendSearchResults = await store.searchUsersByUsername(uiState.friendSearchQuery);
      showToast("Solicitação de amizade aceita!");
      renderApp();
      break;
    case "decline-friend":
      e.stopPropagation();
      await store.respondFriendRequest(btn.getAttribute("data-user-id"), "decline");
      showToast("Solicitação recusada.");
      break;
    case "cancel-friend-req":
      e.stopPropagation();
      await store.respondFriendRequest(btn.getAttribute("data-user-id"), "cancel");
      uiState.friendSearchResults = await store.searchUsersByUsername(uiState.friendSearchQuery);
      showToast("Solicitação cancelada.");
      renderApp();
      break;
    case "remove-friend":
      e.stopPropagation();
      await store.removeOrBlockFriend(btn.getAttribute("data-user-id"), "remove");
      showToast("Amigo removido.");
      break;
    case "leave-guild": {
      e.stopPropagation();
      const res = await store.leaveGuild(btn.getAttribute("data-guild-id"));
      showToast(res.ok ? "Você saiu do servidor." : res.error || "Não foi possível sair do servidor.");
      break;
    }
    case "block-friend":
      e.stopPropagation();
      await store.removeOrBlockFriend(btn.getAttribute("data-user-id"), "block");
      showToast("Usuário bloqueado.");
      break;
    case "unblock-friend":
      e.stopPropagation();
      await store.removeOrBlockFriend(btn.getAttribute("data-user-id"), "unblock");
      showToast("Usuário desbloqueado.");
      break;
    case "leave-voice":
      closeAllFloatingMenus();
      uiState.callFocusUserId = undefined;
      await store.leaveVoiceChannel();
      showToast("Desconectado do canal de voz.");
      break;
    case "toggle-mute":
      store.toggleMute();
      break;
    case "toggle-deafen":
      store.toggleDeafen();
      break;
    case "toggle-video": {
      const res = await store.toggleCamera();
      if (!res.ok) showToast(res.error);
      break;
    }
    case "toggle-screenshare":
      if (state.voice.screenShareEnabled) {
        await store.stopScreenShare();
        showToast("Compartilhamento de tela encerrado.");
      } else {
        await openScreenSharePickerModal();
      }
      break;
    case "refresh-screen-sources":
      uiState.loadingScreenSources = true;
      await loadScreenSources();
      break;
    case "select-screen-source":
      uiState.selectedScreenSourceId = btn.getAttribute("data-source-id");
      uiState.selectedScreenSourceName = btn.getAttribute("data-source-name");
      renderApp();
      break;
    case "confirm-start-screenshare": {
      const srcId = uiState.selectedScreenSourceId || uiState.screenSources[0]?.id || "screen:0:0";
      const srcName = uiState.selectedScreenSourceName || uiState.screenSources[0]?.name || "Tela Principal";
      uiState.activeModal = null;
      const res = await store.startScreenShare(srcId, {
        sourceName: srcName,
        resolution: uiState.screenShareResolution,
        fps: uiState.screenShareFps,
        includeAudio: uiState.screenShareAudio
      });
      if (res.ok) {
        showToast(`Transmitindo "${srcName}" ao vivo!`);
        renderApp();
      } else {
        showToast(res.error || "Falha ao iniciar captura de tela.");
      }
      break;
    }
    case "stop-screenshare":
      await store.stopScreenShare();
      showToast("Transmissão de tela encerrada.");
      break;
    case "preview-join-sound":
      await store.previewCallSound("join");
      break;
    case "preview-leave-sound":
      await store.previewCallSound("leave");
      break;
    case "preview-mute-sound":
      await store.previewCallSound("mute");
      break;
    case "preview-unmute-sound":
      await store.previewCallSound("unmute");
      break;
    case "toggle-mic-test":
      if (uiState.isTestingMic) {
        VoiceDevices.stopMicTest();
        uiState.isTestingMic = false;
        uiState.micTestLevel = 0;
        renderApp();
      } else {
        uiState.isTestingMic = true;
        renderApp();
        VoiceDevices.startMicTest(uiState.selectedAudioInput, (level) => {
          uiState.micTestLevel = level;
          const fill = document.getElementById("mic-test-meter-fill");
          if (fill) fill.style.width = level + "%";
        });
      }
      break;
    case "test-output-device":
      await VoiceDevices.testOutput(uiState.selectedAudioOutput, store.getState().settings.callSoundVolume);
      showToast("Reproduzindo áudio de teste de saída!");
      break;
    case "open-gif-picker":
      uiState.composerMenu = null;
      store.openGifPicker(btn.getAttribute("data-target") || "avatar");
      break;
    case "close-gif-picker":
      store.closeGifPicker();
      break;
    case "close-gif-picker-backdrop":
      if (e.target === btn) store.closeGifPicker();
      break;
    case "select-gif-category":
      await store.searchGifs({ query: store.getState().gifPicker.query, category: btn.getAttribute("data-category") });
      break;
    case "save-guild-name": {
      const guild = store.getActiveGuild();
      const input = document.getElementById("guild-name-input");
      if (!guild || !input) break;
      const res = await store.updateGuild(guild.id, { name: input.value });
      showToast(res.ok ? "Nome do servidor atualizado!" : res.error || "Não foi possível renomear o servidor.");
      break;
    }
    case "toggle-guild-public": {
      const guild = store.getActiveGuild();
      if (!guild) break;
      const res = await store.updateGuild(guild.id, { isPublic: !guild.isPublic });
      showToast(res.ok ? (!guild.isPublic ? "Servidor público: ele já aparece em Explorar servidores." : "Servidor privado: só entra quem tiver convite.") : res.error || "Não foi possível mudar.");
      renderApp();
      break;
    }
    case "save-guild-description": {
      const guild = store.getActiveGuild();
      const input = document.getElementById("guild-description-input");
      if (!guild || !input) break;
      const res = await store.updateGuild(guild.id, { description: input.value });
      showToast(res.ok ? "Descrição salva!" : res.error || "Não foi possível salvar.");
      break;
    }
    case "remove-guild-icon":
    case "remove-guild-banner": {
      const guild = store.getActiveGuild();
      if (!guild) break;
      const isIcon = action === "remove-guild-icon";
      const res = await store.updateGuild(guild.id, isIcon ? { iconUrl: "" } : { bannerUrl: "" });
      showToast(res.ok ? (isIcon ? "Ícone removido." : "Banner removido.") : res.error || "Não foi possível salvar.");
      break;
    }
    case "expand-avatar":
      closeAllFloatingMenus();
      uiState.avatarLightbox = { url: btn.getAttribute("data-url"), name: btn.getAttribute("data-name") || "" };
      renderApp();
      break;
    case "close-avatar-lightbox":
      uiState.avatarLightbox = null;
      renderApp();
      break;
    case "start-dm-call":
      await store.startDmCall(btn.getAttribute("data-channel-id"));
      break;
    case "accept-incoming-call":
      await store.acceptIncomingCall();
      break;
    case "decline-incoming-call":
      store.declineIncomingCall();
      break;
    case "load-more-gifs":
      await store.loadMoreGifs();
      break;
    case "pick-gif-item": {
      const gifTarget = store.getState().gifPicker.target;
      const gifUrl = btn.getAttribute("data-gif-large-url") || btn.getAttribute("data-gif-url");
      const gifTitle = btn.getAttribute("data-gif-title") || "GIF";
      if (gifTarget === "guild-banner") {
        const guild = store.getActiveGuild();
        store.closeGifPicker();
        if (!guild) break;
        const res = await store.updateGuild(guild.id, { bannerUrl: gifUrl });
        showToast(res.ok ? "GIF aplicado ao banner do servidor!" : res.error || "Não foi possível salvar o banner.");
        break;
      }
      if (gifTarget === "chat" || gifTarget === "call") {
        store.closeGifPicker();
        uiState.composerMenu = null;
        const chId =
          gifTarget === "call"
            ? document.getElementById("call-chat-form")?.getAttribute("data-channel-id") || store.getState().voice.connectedChannelId
            : store.getActiveChannel()?.id;
        if (!chId) break;
        const replyToId = gifTarget === "call" ? uiState.callReplyToId : uiState.replyingToMessageId;
        if (gifTarget === "call") uiState.callReplyToId = null;
        else {
          uiState.replyingToMessageId = null;
          uiState.isScrolledUp = false;
          uiState.newMessagesWhileScrolledUp = 0;
        }
        store.sendMessage(chId, "", {
          replyToId,
          attachment: {
            id: `gif_${Date.now()}`,
            name: `${gifTitle}.gif`,
            size: "GIF",
            url: gifUrl,
            isImage: true,
            isGif: true,
            spoiler: false
          }
        });
        const scroller = document.getElementById(gifTarget === "call" ? "call-chat-scroller" : "messages-scroller");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        break;
      }
      store.selectGif(btn.getAttribute("data-gif-url"));
      break;
    }
    case "open-media-editor": {
      const target = btn.getAttribute("data-target") || "avatar";
      const u = store.getCurrentUser();
      const url = btn.getAttribute("data-url") || (target === "avatar" ? u.avatarUrl : u.bannerUrl);
      const scale = target === "avatar" ? (u.avatarScale ?? 1) : (u.bannerScale ?? 1);
      const cropX = target === "avatar" ? (u.avatarCropX ?? 0) : (u.bannerCropX ?? 0);
      const cropY = target === "avatar" ? (u.avatarCropY ?? 0) : (u.bannerCropY ?? 0);
      store.openMediaEditor({ target, mediaUrl: url, scale, cropX, cropY });
      break;
    }
    case "close-media-editor":
      store.closeMediaEditor();
      break;
    case "close-media-editor-backdrop":
      if (e.target === btn) store.closeMediaEditor();
      break;
    case "center-media-editor": {
      store.updateMediaEditorCoords({ scale: 1.0, cropX: 0, cropY: 0, bannerPositionY: 50 });
      const zs = document.getElementById("media-editor-zoom-slider"); if (zs) zs.value = 1.0;
      const xs = document.getElementById("media-editor-panx-slider"); if (xs) xs.value = 0;
      const ys = document.getElementById("media-editor-pany-slider"); if (ys) ys.value = 0;
      const pi = document.getElementById("media-editor-preview-img"); if (pi) pi.style.cssText = `width:100%;height:100%;object-fit:cover;${mediaFramingStyle()}`;
      const zl = document.getElementById("editor-zoom-label"); if (zl) zl.textContent = "1.00x";
      const xl = document.getElementById("editor-panx-label"); if (xl) xl.textContent = "0px";
      const yl = document.getElementById("editor-pany-label"); if (yl) yl.textContent = "0px";
      break;
    }
    case "apply-media-editor": {
      await store.applyMediaEditor();
      showToast("Enquadramento aplicado e salvo com sucesso!");
      break;
    }
    case "role-edit":
      uiState.rolesView = { mode: "edit", roleId: btn.getAttribute("data-role-id") };
      renderApp();
      break;
    case "role-view-members":
      uiState.rolesView = { mode: "members", roleId: btn.getAttribute("data-role-id") };
      renderApp();
      break;
    case "roles-back":
      uiState.rolesView = { mode: "list", search: uiState.rolesView?.search || "" };
      renderApp();
      break;
    case "create-new-role": {
      const gId = btn.getAttribute("data-guild-id");
      const res = await store.createRole(gId, { name: "Novo cargo", color: "#99aab5", permissions: [] });
      if (res.ok && res.role) {
        uiState.rolesView = { mode: "edit", roleId: res.role.id };
        showToast("Cargo criado: escolha o nome, a cor e as permissões.");
      } else showToast(res.error || "Não foi possível criar o cargo.");
      renderApp();
      break;
    }
    case "delete-role": {
      const gId = btn.getAttribute("data-guild-id");
      const rId = btn.getAttribute("data-role-id");
      const res = await store.deleteRole(gId, rId);
      if (res.ok) {
        showToast("Cargo excluído.");
        uiState.rolesView = { mode: "list" };
      } else {
        showToast(res.error || "Erro ao excluir cargo.");
      }
      renderApp();
      break;
    }
    case "role-add-member":
    case "assign-role": {
      const res = await store.assignMemberRole(btn.getAttribute("data-guild-id"), btn.getAttribute("data-user-id"), btn.getAttribute("data-role-id"));
      if (action === "assign-role") uiState.rolePicker = null;
      showToast(res.ok ? "Cargo dado!" : res.error || "Não foi possível dar o cargo.");
      renderApp();
      break;
    }
    case "toggle-role-picker": {
      e.stopPropagation();
      const uid = btn.getAttribute("data-user-id");
      uiState.rolePicker = uiState.rolePicker?.userId === uid ? null : { userId: uid, search: "" };
      renderApp();
      requestAnimationFrame(() => document.getElementById("role-picker-search")?.focus());
      break;
    }
    case "kick-member": {
      const res = await store.kickMember(btn.getAttribute("data-guild-id"), btn.getAttribute("data-user-id"));
      closeAllFloatingMenus();
      showToast(res.ok ? "Membro expulso do servidor." : res.error || "Não foi possível expulsar.");
      renderApp();
      break;
    }
    case "remove-user-role": {
      const gId = btn.getAttribute("data-guild-id");
      const uId = btn.getAttribute("data-user-id");
      const rId = btn.getAttribute("data-role-id");
      const res = await store.removeMemberRole(gId, uId, rId);
      if (res.ok) showToast("Cargo removido!");
      else showToast(res.error || "Erro ao remover cargo.");
      break;
    }
    case "restore-default-sounds":
      await store.updateSettings({
        joinSoundEnabled: true,
        leaveSoundEnabled: true,
        joinSoundPreset: "discord-default",
        leaveSoundPreset: "discord-default",
        joinSoundCustomUrl: "",
        leaveSoundCustomUrl: "",
        joinSoundCustomName: "",
        leaveSoundCustomName: "",
        callSoundVolume: 80
      });
      showToast("Sons de chamada restaurados para o padrão!");
      break;
    case "open-voice-settings":
      closeAllFloatingMenus();
      uiState.settingsOverlay = { type: "user", tab: "voice" };
      renderApp();
      VoiceDevices.enumerateDevices().then((res) => {
        uiState.audioInputDevices = res.inputDevices || [];
        uiState.audioOutputDevices = res.outputDevices || [];
        renderApp();
      });
      break;
    case "toggle-category": {
      const catId = btn.getAttribute("data-category-id");
      const guild = store.getActiveGuild();
      if (guild) {
        if (!guild.collapsedCategories) guild.collapsedCategories = {};
        guild.collapsedCategories[catId] = !guild.collapsedCategories[catId];
        store.notify();
      }
      break;
    }
    case "edit-channel":
      e.stopPropagation();
      closeAllFloatingMenus();
      uiState.activeModal = "edit-channel";
      uiState.modalPayload = { channelId: btn.getAttribute("data-channel-id") };
      renderApp();
      break;
    case "edit-category":
      e.stopPropagation();
      closeAllFloatingMenus();
      uiState.activeModal = "edit-category";
      uiState.modalPayload = { categoryId: btn.getAttribute("data-category-id") || null };
      renderApp();
      break;
    case "delete-category": {
      const res = await store.deleteCategory(store.getActiveGuild()?.id, btn.getAttribute("data-category-id"));
      if (res.ok) uiState.activeModal = null;
      showToast(res.ok ? "Categoria excluída." : res.error || "Não foi possível excluir.");
      renderApp();
      break;
    }
    case "open-create-channel":
      e.stopPropagation();
      closeAllFloatingMenus();
      uiState.activeModal = "create-channel";
      uiState.modalPayload = { categoryId: btn.getAttribute("data-category-id") };
      renderApp();
      break;
    case "delete-channel":
      e.stopPropagation();
      await store.deleteChannel(state.navigation.activeGuildId, btn.getAttribute("data-channel-id"));
      showToast("Canal excluído.");
      break;
    case "toggle-dm-call-panel":
      uiState.dmCallCollapsed = !uiState.dmCallCollapsed;
      try {
        localStorage.setItem(DM_CALL_HEIGHT.collapsedKey, uiState.dmCallCollapsed ? "1" : "0");
      } catch {}
      renderApp();
      break;
    case "reveal-ignored-message":
      uiState.revealedMessages = { ...(uiState.revealedMessages || {}), [btn.getAttribute("data-message-id")]: true };
      renderApp();
      break;
    case "toggle-member-list":
      state.navigation.showMemberList = !state.navigation.showMemberList;
      store.notify();
      break;
    case "toggle-pinned-popover": {
      const next = !uiState.pinnedPopoverOpen;
      closeAllFloatingMenus("pinnedPopover");
      uiState.pinnedPopoverOpen = next;
      renderApp();
      break;
    }
    case "toggle-status-menu": {
      e.stopPropagation();
      const next = !uiState.statusMenuOpen;
      closeAllFloatingMenus("statusMenu");
      uiState.statusMenuOpen = next;
      renderApp();
      break;
    }
    case "toggle-server-menu": {
      if (e.target.closest("[data-action='open-server-settings']") || e.target.closest("[data-action='open-invite-modal']")) {
        return;
      }
      const next = !uiState.serverMenuOpen;
      closeAllFloatingMenus("serverMenu");
      uiState.serverMenuOpen = next;
      renderApp();
      break;
    }
    case "set-my-status":
      closeAllFloatingMenus();
      await store.updateMyStatus(btn.getAttribute("data-status"));
      break;
    case "open-user-popout":
      uiState.rolePicker = null; {
      e.stopPropagation();
      const targetUserId = btn.getAttribute("data-user-id");
      const isSame = uiState.userPopout && uiState.userPopout.userId === targetUserId;
      closeAllFloatingMenus("userPopout");
      // Next to the member list it opens beside the list; everywhere else
      // (friends tabs, chat, call...) right where the mouse clicked
      const r = btn.getBoundingClientRect();
      const fromMemberList = Boolean(btn.closest(".members-sidebar"));
      const anchor =
        !fromMemberList && e.clientX
          ? { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }
          : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      uiState.userPopout = isSame ? null : { userId: targetUserId, anchor };
      renderApp();
      break;
    }
    case "close-user-popout":
      uiState.userPopout = null;
      renderApp();
      break;
    case "open-invite-modal": {
      e.stopPropagation();
      const guild = store.getActiveGuild();
      if (guild) {
        await openInviteModalForGuild(guild.id, btn.getAttribute("data-channel-id") || null);
      }
      break;
    }
    case "generate-new-invite": {
      const guild = store.getActiveGuild();
      if (guild) {
        await openInviteModalForGuild(guild.id, null);
        showToast("Novo código único de convite gerado!");
      }
      break;
    }
    case "copy-invite-code": {
      const code = btn.getAttribute("data-code");
      const url = btn.getAttribute("data-url");
      NativeBridge.copyText(url || code);
      uiState.inviteCopiedCode = code;
      showToast("Link de convite copiado para a área de transferência!");
      renderApp();
      break;
    }
    case "revoke-invite": {
      const code = btn.getAttribute("data-code");
      await store.revokeServerInvite(code);
      const guild = store.getActiveGuild();
      if (guild) {
        const listRes = await store.getGuildInvites(guild.id);
        if (listRes.ok) uiState.guildInvitesList = listRes.invites || [];
      }
      showToast(`Convite ${code} revogado.`);
      renderApp();
      break;
    }
    case "open-modal":
      e.stopPropagation();
      closeAllFloatingMenus();
      uiState.joinInviteError = "";
      uiState.activeModal = btn.getAttribute("data-modal");
      renderApp();
      break;
    case "close-modal":
      uiState.activeModal = null;
      renderApp();
      break;
    case "close-modal-backdrop":
      if (e.target === btn) {
        uiState.activeModal = null;
        renderApp();
      }
      break;
    case "open-user-settings":
      closeAllFloatingMenus();
      uiState.usernameDraft = store.getCurrentUser().username;
      uiState.usernameAvailability = null;
      uiState.usernameSaveStatus = null;
      uiState.settingsOverlay = { type: "user", tab: "account" };
      resetAccountUi();
      renderApp();
      loadAccountSecurity();
      break;
    case "open-server-settings":
      e.stopPropagation();
      closeAllFloatingMenus();
      uiState.settingsOverlay = { type: "server", tab: "overview" };
      renderApp();
      break;
    case "settings-tab": {
      closeAllFloatingMenus();
      const tabType = btn.getAttribute("data-type");
      const tabName = btn.getAttribute("data-tab");
      uiState.settingsOverlay = {
        type: tabType,
        tab: tabName
      };
      if (tabName === "account") resetAccountUi();
      renderApp();
      if (tabName === "account") loadAccountSecurity();
      if (tabName === "voice") {
        VoiceDevices.enumerateDevices().then((res) => {
          uiState.audioInputDevices = res.inputDevices || [];
          uiState.audioOutputDevices = res.outputDevices || [];
          renderApp();
        });
      }
      break;
    }
    case "close-settings-overlay":
      uiState.settingsOverlay = null;
      uiState.stagedAvatar = null;
      uiState.stagedBanner = null;
      uiState.bannerEditorMode = null;
      resetAccountUi();
      renderApp();
      break;
    case "confirm-staged-avatar":
      if (uiState.stagedAvatar) {
        await store.updateMyProfile({ avatarUrl: uiState.stagedAvatar.url });
        uiState.stagedAvatar = null;
        showToast("Foto de perfil confirmada e salva!");
        renderApp();
      }
      break;
    case "cancel-staged-avatar":
      uiState.stagedAvatar = null;
      renderApp();
      break;
    case "remove-avatar":
      uiState.stagedAvatar = null;
      await store.updateMyProfile({ avatarUrl: "" });
      showToast("Foto de perfil removida.");
      renderApp();
      break;
    case "select-banner-swatch": {
      const color = btn.getAttribute("data-color");
      uiState.stagedBannerColor = color;
      await store.updateMyProfile({ bannerColor: color });
      showToast(`Cor do banner alterada para ${color}`);
      break;
    }
    case "restore-default-banner-color":
      uiState.stagedBannerColor = "#5865f2";
      await store.updateMyProfile({ bannerColor: "#5865f2" });
      showToast("Cor padrão do banner (#5865f2) restaurada.");
      break;
    case "confirm-staged-banner":
      if (uiState.stagedBanner) {
        await store.updateMyProfile({
          bannerUrl: uiState.stagedBanner.url,
          bannerPositionY: uiState.stagedBannerPosY ?? store.getCurrentUser().bannerPositionY ?? 50
        });
        uiState.stagedBanner = null;
        showToast("Imagem/GIF do banner confirmado e salvo!");
        renderApp();
      }
      break;
    case "cancel-staged-banner":
      uiState.stagedBanner = null;
      renderApp();
      break;
    case "remove-banner-image":
      uiState.stagedBanner = null;
      await store.updateMyProfile({ bannerUrl: "", bannerPositionY: 50 });
      showToast("Imagem/GIF do banner removido.");
      renderApp();
      break;
    case "set-theme":
      await store.updateSetting("theme", btn.getAttribute("data-theme"));
      break;
    case "set-kamui-accent":
      setKamuiAccent(btn.getAttribute("data-color"));
      renderApp();
      break;
    case "set-density":
      await store.updateSetting("messageDisplay", btn.getAttribute("data-density"));
      break;
    case "toggle-krisp":
      store.setNoiseSuppression(!state.voice.noiseSuppression);
      break;
    case "toggle-setting": {
      const k = btn.getAttribute("data-key");
      await store.updateSetting(k, !state.settings[k]);
      break;
    }
    case "purge-memory-now":
      await NativeBridge.purgeMemory();
      setTimeout(refreshMemoryUsageLabel, 1200);
      showToast("Memória RAM otimizada e caches limpos!");
      break;
    case "toggle-reaction": {
      const msgChannelId = channelIdOfMessage(btn.getAttribute("data-message-id"));
      if (msgChannelId) {
        await store.toggleReaction(msgChannelId, btn.getAttribute("data-message-id"), btn.getAttribute("data-emoji"));
      }
      break;
    }
    case "open-emoji-picker": {
      e.stopPropagation();
      const msgId = btn.getAttribute("data-message-id");
      const isSame = uiState.emojiPickerForMessageId === msgId;
      const closedOthers = closeAllFloatingMenus("emojiPicker");
      uiState.emojiPickerForMessageId = isSame ? null : msgId;
      // Opened from the message's right-click menu the toolbar button is hidden: anchor at the message
      const r = (btn.offsetParent ? btn : btn.closest("[data-message-id]") || btn).getBoundingClientRect();
      uiState.emojiPickerAnchor = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      if (closedOthers) {
        renderApp();
      } else {
        syncEmojiPicker(uiState.emojiPickerForMessageId, uiState.emojiPickerAnchor);
      }
      break;
    }
    case "select-emoji": {
      const target = btn.getAttribute("data-target") || btn.closest("[data-emoji-target]")?.getAttribute("data-emoji-target");
      const emoji = btn.getAttribute("data-emoji");
      recordEmojiUse(emoji);
      if (target === "composer" || target === "call-composer") {
        const inp =
          target === "call-composer"
            ? document.querySelector("#call-chat-form input[name=message]")
            : document.getElementById("composer-text-input");
        if (inp) {
          // Inserted where the cursor is, keeping the emoji picker open so the user can click multiple emojis
          const start = inp.selectionStart ?? inp.value.length;
          const end = inp.selectionEnd ?? inp.value.length;
          inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
          inp.focus();
          inp.setSelectionRange(start + emoji.length, start + emoji.length);
        }
        break;
      }
      uiState.emojiPickerForMessageId = null;
      const msgChannelId = channelIdOfMessage(target);
      if (msgChannelId) await store.toggleReaction(msgChannelId, target, emoji);
      renderApp();
      break;
    }
    case "jump-to-message": {
      const targetId = btn.getAttribute("data-target-id");
      if (targetId) jumpToMessage(targetId, Boolean(btn.closest(".call-chat")));
      break;
    }
    case "jump-to-present": {
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      syncJumpToPresentBar();
      const scroller = document.getElementById("messages-scroller");
      if (scroller) {
        const dist = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        scroller.scrollTo({
          top: scroller.scrollHeight,
          behavior: dist <= 1400 ? "smooth" : "instant"
        });
      }
      document.getElementById("composer-text-input")?.focus();
      break;
    }
    case "toggle-open-on-startup": {
      const next = !NativeBridge.getOpenOnStartup();
      NativeBridge.setOpenOnStartup(next);
      showToast(
        next
          ? `${getAppName()} configurado para iniciar automaticamente com o Windows.`
          : "Inicialização automática com o Windows desativada."
      );
      renderApp();
      break;
    }
    case "cancel-call-reply":
      uiState.callReplyToId = null;
      renderApp();
      break;
    case "toggle-call-fullscreen":
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      else await document.documentElement.requestFullscreen().catch(() => showToast("Não foi possível abrir a tela cheia."));
      break;
    case "reply-message":
      if (btn.closest(".call-chat")) {
        uiState.callReplyToId = btn.getAttribute("data-message-id");
        renderApp();
        document.querySelector("#call-chat-form input[name=message]")?.focus();
        break;
      }
      uiState.replyingToMessageId = btn.getAttribute("data-message-id");
      renderApp();
      document.getElementById("composer-text-input")?.focus();
      break;
    case "cancel-reply":
      uiState.replyingToMessageId = null;
      renderApp();
      break;
    case "clear-attachment":
      uiState.stagedAttachment = null;
      renderApp();
      break;
    case "start-edit-message":
      uiState.editingMessageId = btn.getAttribute("data-message-id");
      renderApp();
      document.getElementById(`edit-message-input-${uiState.editingMessageId}`)?.focus();
      break;
    case "cancel-edit":
      uiState.editingMessageId = null;
      renderApp();
      break;
    case "save-edit": {
      const msgId = btn.getAttribute("data-message-id");
      const inp = document.getElementById(`edit-message-input-${msgId}`);
      const msgChannelId = channelIdOfMessage(msgId);
      if (msgChannelId && inp) {
        await store.editMessage(msgChannelId, msgId, inp.value);
      }
      uiState.editingMessageId = null;
      renderApp();
      break;
    }
    case "pin-message": {
      const msgChannelId = channelIdOfMessage(btn.getAttribute("data-message-id"));
      if (msgChannelId) {
        const pinned = await store.togglePinMessage(msgChannelId, btn.getAttribute("data-message-id"));
        showToast(pinned ? "Mensagem fixada!" : "Mensagem desafixada.");
      }
      break;
    }
    case "delete-message": {
      const msgChannelId = channelIdOfMessage(btn.getAttribute("data-message-id"));
      if (msgChannelId) {
        await store.deleteMessage(msgChannelId, btn.getAttribute("data-message-id"));
        showToast("Mensagem excluída.");
      }
      break;
    }
    case "open-thread":
      state.navigation.activeThreadMessageId = btn.getAttribute("data-message-id");
      store.notify();
      break;
    case "close-thread":
      state.navigation.activeThreadMessageId = null;
      store.notify();
      break;
    case "toggle-spoiler":
      btn.classList.toggle("revealed");
      break;
    case "insert-slash-shrug": {
      const inp = document.getElementById("composer-text-input");
      if (inp) {
        inp.value = "/shrug";
        inp.focus();
      }
      break;
    }
    case "copy-text":
      NativeBridge.copyText(btn.getAttribute("data-text"));
      closeAllFloatingMenus();
      uiState.activeModal = null;
      showToast("Copiado para a área de transferência!");
      renderApp();
      break;
    case "toast":
      showToast(btn.getAttribute("data-msg"));
      break;
    case "quick-switch-go": {
      const t = btn.getAttribute("data-type");
      const id = btn.getAttribute("data-id");
      const gId = btn.getAttribute("data-guild-id");
      closeAllFloatingMenus();
      uiState.activeModal = null;
      uiState.quickSwitcherQuery = "";
      if (t === "guild") store.selectGuild(id);
      else if (t === "channel") store.selectGuild(gId, id);
      else if (t === "dm") store.selectHome("dm", id);
      break;
    }
  }
}

document.addEventListener("click", handleGlobalClick);

function scrollChatToBottom(scroller) {
  if (!scroller) return;
  scroller.scrollTop = scroller.scrollHeight;
  requestAnimationFrame(() => {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });
}

function channelIdOrFallback(ch) {
  return ch ? ch.id : "c_general";
}

// Right-click Context Menu on Servers
// Right-click on a message: small menu with the same actions as its toolbar
// (each item clicks the toolbar button, so deleting still asks to confirm)
// The call's chat is not the "active" channel, so messages are looked up by id
function channelIdOfMessage(messageId) {
  const all = store.getState().messages;
  return Object.keys(all).find((id) => (all[id] || []).some((m) => m.id === messageId)) || store.getActiveChannel()?.id || null;
}

function openMessageContextMenu(e, row) {
  const id = row.getAttribute("data-message-id");
  const toolbarButton = (action) => document.querySelector(`[data-message-id="${CSS.escape(id)}"]:is(.message-row, .call-chat-msg) [data-action="${action}"][data-message-id="${CSS.escape(id)}"]`);
  const all = Object.values(store.getState().messages).flat();
  const msg = all.find((m) => m && m.id === id);
  const items = [];
  const add = (action, label, extra = {}) => {
    if (toolbarButton(action)) items.push({ label, ...extra, onClick: () => toolbarButton(action)?.click() });
  };
  add("reply-message", "Responder");
  add("open-emoji-picker", "Adicionar reação");
  add("start-edit-message", "Editar mensagem");
  if (msg?.content) {
    items.push({
      label: "Copiar texto",
      onClick: () => {
        NativeBridge.copyText(msg.content);
        showToast("Texto copiado!");
      }
    });
  }
  add("pin-message", msg?.pinned ? "Desafixar" : "Fixar mensagem");
  add("delete-message", "Excluir mensagem", { danger: true });
  if (!items.length) return;
  e.preventDefault();
  closeAllFloatingMenus("contextMenu");
  uiState.contextMenu = {
    x: Math.min(e.clientX, window.innerWidth - 220),
    y: Math.min(e.clientY, window.innerHeight - items.length * 38 - 16),
    items
  };
  renderApp();
}

// Right-click on someone's call tile (or their row under the voice channel)
function buildCallUserMenu(userId) {
  const state = store.getState();
  const me = state.auth.currentUserId;
  const user = state.users[userId];
  if (!user) return [];
  const isMe = userId === me;
  const prefs = store.getUserAudioPrefs();
  const guild = state.guilds.find((g) => g.id === state.voice.connectedGuildId) || null;
  const channel = guild?.channels.find((c) => c.id === state.voice.connectedChannelId) || null;
  const participant = (channel?.voiceParticipants || []).find((p) => p.userId === userId);
  const friend = state.friends.find((f) => f.userId === userId);
  const items = [{ label: "Perfil", onClick: () => openProfileView(userId) }];

  if (!isMe) {
    items.push(
      { label: "Mensagem", onClick: () => store.openOrCreateDm(userId) },
      {
        label: "Iniciar chamada",
        onClick: async () => {
          const dm = await store.openOrCreateDm(userId);
          const dmId = dm?.id || store.getState().navigation.activeDmId;
          if (dmId) await store.startDmCall(dmId);
        }
      },
      {
        label: "Adicionar nota",
        sublabel: "Visível apenas para você",
        onClick: () => {
          const p = uiState.lastMenuPoint;
          uiState.userPopout = { userId, anchor: p ? { left: p.x, right: p.x, top: p.y, bottom: p.y } : undefined };
          renderApp();
          document.querySelector("[data-user-note-id]")?.focus();
        }
      },
      { type: "separator" },
      {
        type: "slider",
        label: "Volume do usuário",
        value: prefs.volumes[userId] ?? 100,
        onInput: (v) => store.setUserAudioPref("volume", userId, v)
      },
      { type: "separator" },
      {
        type: "checkbox",
        label: "Silenciar",
        checked: prefs.muted.includes(userId),
        onToggle: (on) => store.setUserAudioPref("muted", userId, on)
      },
      {
        type: "checkbox",
        label: "Silenciar efeitos sonoros",
        checked: prefs.soundsMuted.includes(userId),
        onToggle: (on) => store.setUserAudioPref("soundsMuted", userId, on)
      },
      {
        type: "checkbox",
        label: "Desativar vídeo",
        checked: prefs.videoHidden.includes(userId),
        onToggle: (on) => store.setUserAudioPref("videoHidden", userId, on)
      },
      { type: "separator" }
    );
    if (!friend) items.push({ label: "Adicionar amigo", onClick: async () => showToast((await store.sendFriendRequestToUser(userId)).ok ? "Pedido de amizade enviado!" : "Não foi possível enviar o pedido.") });
    if (friend?.relation !== "blocked") {
      items.push({
        label: "Bloquear",
        danger: true,
        onClick: () => {
          const fake = document.createElement("button");
          fake.setAttribute("data-action", "block-friend");
          fake.setAttribute("data-user-id", userId);
          openConfirmDialog("block-friend", fake);
        }
      });
    }
  }

  // Roles (with "Gerenciar cargos", only roles below mine)
  if (guild && store.can("MANAGE_ROLES", guild)) {
    const isOwner = guild.ownerId === me;
    const myTop = myTopRolePosition(guild, me);
    const memberRoleIds = (guild.members || []).find((m) => m.userId === userId)?.roles || [];
    const roles = guild.roles.filter((r) => r.name !== "@everyone" && (isOwner || (r.position || 0) < myTop));
    items.push(
      { type: "separator" },
      {
        type: "submenu",
        label: "Cargos",
        items: roles.map((r) => ({
          type: "checkbox",
          label: r.name,
          checked: memberRoleIds.includes(r.id),
          onToggle: (on) => (on ? store.assignMemberRole(guild.id, userId, r.id) : store.removeMemberRole(guild.id, userId, r.id))
        }))
      }
    );
  }
  const canMove = guild && store.can("MOVE_MEMBERS", guild);
  if (canMove) {
    items.push({
      type: "submenu",
      label: "Mover para",
      items: guild.channels
        .filter((c) => c.type === "voice" && c.id !== channel?.id)
        .map((c) => ({ label: c.name, onClick: () => store.moderateVoice(userId, "move", { channelId: c.id }) }))
    });
  }

  items.push(
    { type: "separator" },
    {
      type: "checkbox",
      label: "Mostrar participantes sem vídeo",
      checked: uiState.showNonVideoTiles !== false,
      onToggle: (on) => {
        uiState.showNonVideoTiles = on;
      }
    }
  );

  // Server moderation of someone else
  if (guild && !isMe && (store.can("MUTE_MEMBERS", guild) || store.can("DEAFEN_MEMBERS", guild) || canMove)) {
    items.push({ type: "separator" });
    if (store.can("MUTE_MEMBERS", guild)) {
      items.push({
        type: "checkbox",
        label: "Silenciar voz no servidor",
        danger: true,
        checked: Boolean(participant?.serverMuted),
        onToggle: (on) => store.moderateVoice(userId, "mute", { value: on })
      });
    }
    if (store.can("DEAFEN_MEMBERS", guild)) {
      items.push({
        type: "checkbox",
        label: "Desativar áudio no servidor",
        danger: true,
        checked: Boolean(participant?.serverDeafened),
        onToggle: (on) => store.moderateVoice(userId, "deafen", { value: on })
      });
    }
    if (canMove) items.push({ label: "Desconectar", danger: true, onClick: () => store.moderateVoice(userId, "disconnect") });
  }
  return items;
}

// Runs a button action that needs confirmation (same dialog as the real buttons)
function confirmViaDialog(action, attrs = {}) {
  const fake = document.createElement("button");
  fake.setAttribute("data-action", action);
  for (const [k, v] of Object.entries(attrs)) fake.setAttribute(k, v);
  openConfirmDialog(action, fake);
}

const MUTE_DURATIONS = [
  { label: "Por 15 minutos", ms: 15 * 60 * 1000 },
  { label: "Por 1 hora", ms: 60 * 60 * 1000 },
  { label: "Por 3 horas", ms: 3 * 60 * 60 * 1000 },
  { label: "Por 8 horas", ms: 8 * 60 * 60 * 1000 },
  { label: "Por 24 horas", ms: 24 * 60 * 60 * 1000 },
  { label: "Até eu ligá-las de novo", ms: -1 }
];

// "Silenciado até 14:30" / "Silenciado" for the sublabel of a muted item
function mutedSublabel(until) {
  if (until === -1) return "Silenciado";
  const d = new Date(until);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Silenciado até ${sameDay ? time : `${d.toLocaleDateString("pt-BR")} ${time}`}`;
}

// Servers where I can create an invite (for "Convidar para o servidor")
function invitableGuilds() {
  return store.sortedGuilds().filter((g) => store.can("CREATE_INSTANT_INVITE", g));
}

// Creates an invite to `guild` and sends its link in the DM
async function sendGuildInviteInDm(guild, dmId) {
  const res = await store.createServerInvite(guild.id, { expiresInSeconds: 7 * 86400 });
  const url = res?.invite?.url;
  if (!url) return showToast(res?.error || "Não foi possível criar o convite.");
  await store.sendMessage(dmId, url);
  showToast(`Convite para ${guild.name} enviado!`);
}

// Opens (or creates) the DM with someone and returns its id
async function dmIdFor(userId) {
  const existing = store.getState().dms.find((d) => d.userId === userId);
  if (existing) return existing.id;
  const res = await store.openOrCreateDm(userId);
  return res?.id || store.getState().dms.find((d) => d.userId === userId)?.id || null;
}

// Right-click on a conversation in the DM list
function buildDmMenu(dmId) {
  const dm = store.getState().dms.find((d) => d.id === dmId);
  return dm ? buildUserMenu(dm.userId) : [];
}

// Right-click on a person: DM list, friends tabs (Todos, Disponível...) and the
// server's member list. Items about the conversation only show once it exists.
function buildUserMenu(userId) {
  const state = store.getState();
  const user = state.users[userId];
  if (!user || userId === state.auth.currentUserId) return [];
  const dm = state.dms.find((d) => d.userId === userId) || null;
  const prefs = store.getChatPrefs();
  const pinned = dm && prefs.pinnedDms.includes(dm.id);
  const favorite = dm && prefs.favoriteDms.includes(dm.id);
  const relation = state.friends.find((f) => f.userId === user.id)?.relation;
  const ignored = store.isIgnored(user.id);
  const mutedUntil = dm ? prefs.mutedDms[dm.id] : 0;
  const muted = dm ? store.isDmMuted(dm.id) : false;
  const inCallWithThem = Boolean(dm) && state.voice.connectedChannelId === dm.id;

  const items = [];
  if (dm) {
    items.push(
      { label: "Marcar como lida", onClick: () => store.markChannelsRead([dm.id]) },
      { type: "separator" },
      { label: pinned ? "Desafixar" : "Fixar", icon: Icons.pin, onClick: () => store.toggleListPref("pinnedDms", dm.id, !pinned) },
      {
        label: favorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
        icon: Icons.star,
        onClick: () => store.toggleListPref("favoriteDms", dm.id, !favorite)
      },
      { type: "separator" }
    );
  }
  items.push(
    { label: "Perfil", onClick: () => openProfileView(user.id) },
    {
      label: "Mensagem",
      onClick: async () => {
        const id = await dmIdFor(user.id);
        if (id) store.selectHome("dm", id);
      }
    },
    {
      label: inCallWithThem ? "Já está na chamada" : "Iniciar chamada",
      onClick: async () => {
        if (inCallWithThem) return;
        const id = await dmIdFor(user.id);
        if (!id) return;
        store.selectHome("dm", id);
        await store.startDmCall(id);
      }
    },
    {
      label: "Adicionar nota",
      sublabel: "Visível apenas para você",
      onClick: () => {
        const p = uiState.lastMenuPoint;
        uiState.userPopout = { userId: user.id, anchor: p ? { left: p.x, right: p.x, top: p.y, bottom: p.y } : undefined };
        renderApp();
        document.querySelector("[data-user-note-id]")?.focus();
      }
    }
  );
  if (dm) items.push({ label: "Fechar mensagem direta", onClick: () => store.closeDm(dm.id) });
  items.push(
    { type: "separator" },
    {
      type: "submenu",
      label: "Convidar para o servidor",
      items: invitableGuilds().map((g) => ({
        label: g.name,
        onClick: async () => {
          const id = await dmIdFor(user.id);
          if (id) await sendGuildInviteInDm(g, id);
        }
      }))
    }
  );
  if (relation === "friend") items.push({ label: "Desfazer amizade", onClick: () => confirmViaDialog("remove-friend", { "data-user-id": user.id }) });
  else if (!relation) {
    items.push({
      label: "Adicionar amigo",
      onClick: async () => showToast((await store.sendFriendRequestToUser(user.id)).ok ? "Pedido de amizade enviado!" : "Não foi possível enviar o pedido.")
    });
  }
  items.push({
    label: ignored ? "Deixar de ignorar" : "Ignorar",
    sublabel: ignored ? "" : "Sem notificações e mensagens recolhidas",
    onClick: () => {
      store.toggleListPref("ignored", user.id, !ignored);
      showToast(ignored ? `Você não está mais ignorando ${user.displayName}.` : `Você está ignorando ${user.displayName}.`);
    }
  });
  items.push(
    relation === "blocked"
      ? { label: "Desbloquear", onClick: () => store.removeOrBlockFriend(user.id, "unblock").then(() => showToast("Usuário desbloqueado.")) }
      : { label: "Bloquear", danger: true, onClick: () => confirmViaDialog("block-friend", { "data-user-id": user.id }) }
  );
  if (dm) {
    items.push({ type: "separator" });
    items.push(
      muted
        ? { label: `Reativar som de @${user.username}`, sublabel: mutedSublabel(mutedUntil), onClick: () => store.muteDm(dm.id, 0) }
        : {
            type: "submenu",
            label: `Silenciar @${user.username}`,
            items: MUTE_DURATIONS.map((d) => ({ label: d.label, onClick: () => store.muteDm(dm.id, d.ms) }))
          }
    );
  }
  return items;
}

// Right-click on a server icon
function buildGuildMenu(guildId) {
  const state = store.getState();
  const g = state.guilds.find((item) => item.id === guildId);
  if (!g) return [];
  const me = state.auth.currentUserId;
  const prefs = store.guildPrefs(g.id);
  const muted = store.isGuildMuted(g.id);
  const set = (key) => (value) => store.setGuildPref(g.id, key, value);
  const notifyLabels = { all: "Todas as mensagens", mentions: "Apenas @menções", none: "Nada" };
  const ids = store.sortedGuilds().map((x) => x.id);
  const pos = ids.indexOf(g.id);
  const isOwner = g.ownerId === me;

  const items = [
    { label: "Marcar como lida", onClick: () => store.markGuildRead(g.id) },
    { type: "separator" }
  ];
  if (store.can("CREATE_INSTANT_INVITE", g)) {
    items.push(
      {
        label: "Convidar para o servidor",
        onClick: async () => {
          store.selectGuild(g.id);
          await openInviteModalForGuild(g.id);
        }
      },
      { type: "separator" }
    );
  }
  items.push(
    muted
      ? { label: "Reativar som do servidor", sublabel: mutedSublabel(prefs.mutedUntil), onClick: () => store.muteGuild(g.id, 0) }
      : {
          type: "submenu",
          label: "Silenciar servidor",
          items: MUTE_DURATIONS.map((d) => ({ label: d.label, onClick: () => store.muteGuild(g.id, d.ms) }))
        },
    {
      type: "submenu",
      label: "Config. de notificação",
      sublabel: notifyLabels[prefs.notify] || notifyLabels.all,
      wide: true,
      items: [
        ...Object.entries(notifyLabels).map(([value, label]) => ({
          type: "radio",
          label,
          checked: prefs.notify === value,
          onClick: () => set("notify")(value)
        })),
        { type: "separator" },
        { type: "checkbox", label: "Silenciar @everyone e @here", checked: prefs.suppressEveryone, onToggle: set("suppressEveryone") },
        { type: "checkbox", label: "Silenciar todas as @menções de cargos", checked: prefs.suppressRoles, onToggle: set("suppressRoles") },
        { type: "separator" },
        { type: "checkbox", label: "Notificar na área de trabalho", checked: prefs.desktop, onToggle: set("desktop") }
      ]
    },
    { type: "checkbox", label: "Ocultar canais silenciados", checked: prefs.hideMutedChannels, onToggle: set("hideMutedChannels") },
    { type: "checkbox", label: "Mostrar todos os canais", checked: prefs.showAllChannels, onToggle: set("showAllChannels") },
    { type: "separator" },
    {
      label: "Config. de privacidade",
      onClick: () => {
        store.selectGuild(g.id);
        uiState.activeModal = "guild-privacy";
        uiState.guildPrivacyId = g.id;
      }
    },
    {
      label: "Editar perfil por servidor",
      onClick: () => {
        store.selectGuild(g.id);
        uiState.activeModal = "guild-nickname";
        uiState.guildNicknameId = g.id;
      }
    }
  );
  if (store.can("MANAGE_SERVER", g)) {
    items.push({
      label: "Configurações do servidor",
      onClick: () => {
        store.selectGuild(g.id);
        uiState.settingsOverlay = { type: "server", tab: "overview" };
      }
    });
  }
  if (store.can("MANAGE_CHANNELS", g)) {
    items.push({
      label: "Criar canal",
      onClick: () => {
        store.selectGuild(g.id);
        uiState.activeModal = "create-channel";
      }
    });
  }
  items.push(
    { type: "separator" },
    {
      type: "submenu",
      label: "Mover para...",
      items: [
        pos > 0 && { label: "Topo da lista", onClick: () => store.moveGuild(g.id, "top") },
        pos > 0 && { label: "Subir uma posição", onClick: () => store.moveGuild(g.id, "up") },
        pos < ids.length - 1 && { label: "Descer uma posição", onClick: () => store.moveGuild(g.id, "down") },
        pos < ids.length - 1 && { label: "Final da lista", onClick: () => store.moveGuild(g.id, "bottom") }
      ].filter(Boolean)
    },
    {
      label: "Copiar ID do servidor",
      onClick: () => {
        NativeBridge.copyText(g.id);
        showToast("ID do servidor copiado!");
      }
    }
  );
  if (!isOwner) {
    items.push({ type: "separator" }, { label: "Sair do servidor", danger: true, onClick: () => confirmViaDialog("leave-guild", { "data-guild-id": g.id }) });
  }
  return items;
}

// Right-click on a text channel: mute it (used by "Ocultar canais silenciados")
function buildChannelMenu(channelId) {
  const guild = store.getState().guilds.find((g) => (g.channels || []).some((c) => c.id === channelId));
  const channel = guild?.channels.find((c) => c.id === channelId);
  if (!channel) return [];
  const until = store.getChatPrefs().mutedChannels[channelId];
  const items = [{ label: "Marcar como lida", onClick: () => store.markChannelsRead([channelId]) }, { type: "separator" }];
  items.push(
    store.isChannelMuted(channelId)
      ? { label: "Reativar som do canal", sublabel: mutedSublabel(until), onClick: () => store.muteChannel(channelId, 0) }
      : {
          type: "submenu",
          label: "Silenciar canal",
          items: MUTE_DURATIONS.map((d) => ({ label: d.label, onClick: () => store.muteChannel(channelId, d.ms) }))
        },
    { type: "separator" },
    {
      label: "Copiar ID do canal",
      onClick: () => {
        NativeBridge.copyText(channelId);
        showToast("ID do canal copiado!");
      }
    }
  );
  return items;
}

function openMenuAt(e, items) {
  if (!items.length) return;
  e.preventDefault();
  closeAllFloatingMenus("contextMenu");
  // Opens up/left when it would go off-screen (submenus open to the left near the right edge)
  const height = items.reduce((h, it) => h + (it.type === "separator" ? 9 : it.sublabel ? 46 : 34), 12);
  // Where the menu was opened: "Adicionar nota" opens the profile card there
  uiState.lastMenuPoint = { x: e.clientX, y: e.clientY };
  uiState.contextMenu = {
    x: Math.max(8, Math.min(e.clientX, window.innerWidth - 240)),
    y: Math.max(8, Math.min(e.clientY, window.innerHeight - height - 8)),
    items,
    wide: true
  };
  renderApp();
}

document.addEventListener("contextmenu", (e) => {
  uiState.lastMenuPoint = { x: e.clientX, y: e.clientY };
  const dmTarget = e.target.closest(".dm-item[data-dm-id], .rail-dm[data-dm-id]");
  if (dmTarget) return openMenuAt(e, buildDmMenu(dmTarget.getAttribute("data-dm-id")));
  // A person in the friends tabs or in the server's member list
  const personTarget = e.target.closest(".friend-row[data-user-id], .member-item[data-user-id]");
  if (personTarget) return openMenuAt(e, buildUserMenu(personTarget.getAttribute("data-user-id")));
  const channelTarget = e.target.closest("[data-channel-context]");
  if (channelTarget) return openMenuAt(e, buildChannelMenu(channelTarget.getAttribute("data-channel-context")));
  const callTarget = e.target.closest(".call-tile[data-user-id], .voice-user-row[data-user-id]");
  if (callTarget && store.getState().voice.connectedChannelId) {
    const items = buildCallUserMenu(callTarget.getAttribute("data-user-id"));
    if (items.length) {
      e.preventDefault();
      closeAllFloatingMenus("contextMenu");
      uiState.contextMenu = { x: e.clientX, y: e.clientY, items, wide: true };
      renderApp();
      return;
    }
  }
  // Text boxes and selected text get the standard menu (Copiar/Colar...) from the main process
  const row = e.target.closest(".message-row[data-message-id], .call-chat-msg[data-message-id]");
  if (row && !e.target.closest("input, textarea, [contenteditable]") && !String(window.getSelection?.() || "").trim()) {
    openMessageContextMenu(e, row);
    return;
  }
  const guildWrap = e.target.closest("[data-guild-context]");
  if (guildWrap) openMenuAt(e, buildGuildMenu(guildWrap.getAttribute("data-guild-context")));
});

// Global Keyboard Shortcuts (Ctrl+K Quick Switcher, Esc to close floating menus/modals/overlays)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    closeAllFloatingMenus();
    uiState.activeModal = uiState.activeModal === "quick-switcher" ? null : "quick-switcher";
    renderApp();
    return;
  }
  if (e.key === "Escape") {
    if (uiState.mediaViewer) {
      uiState.mediaViewer = null;
      renderApp();
      return;
    }
    if (store.getState().gifPicker.isOpen) {
      store.closeGifPicker();
      return;
    }
    if (uiState.switchAccountPrompt) {
      uiState.switchAccountPrompt = null;
      renderApp();
      return;
    }
    if (uiState.profileView && !store.getState().mediaEditor.isOpen) {
      uiState.profileView = null;
      renderApp();
      return;
    }
    if (uiState.confirmDialog) {
      uiState.confirmDialog = null;
      renderApp();
      return;
    }
    if (uiState.avatarLightbox) {
      uiState.avatarLightbox = null;
      renderApp();
      return;
    }
    if (hasAnyOpenFloatingMenu()) {
      closeAllFloatingMenus();
      renderApp();
      return;
    }
    if (uiState.activeModal) {
      uiState.activeModal = null;
      renderApp();
      return;
    }
    if (uiState.settingsOverlay) {
      uiState.settingsOverlay = null;
      uiState.stagedAvatar = null;
      uiState.stagedBanner = null;
      renderApp();
    }
  }
});

// Subscribe to store updates & Electron Tray IPC events
store.subscribe(() => renderApp());
store.subscribeGifPicker((state) => syncGifPicker(state));

// eco://convite/<code>: joins the server once the user is logged in
let pendingInviteCode = null;

async function consumeInviteDeepLink() {
  if (!pendingInviteCode || !store.getState().auth.isAuthenticated) return;
  const code = pendingInviteCode;
  pendingInviteCode = null;
  const res = await store.acceptServerInvite(code);
  showToast(res.ok ? (res.alreadyMember ? "Você já está nesse servidor." : `Você entrou em ${res.guildName || "um servidor"}!`) : res.error || "Convite inválido.");
  renderApp();
}

function handleDeepLink(url) {
  const match = /^eco:\/\/+(?:convite|invite)\/([A-Za-z0-9_-]+)/i.exec(String(url || ""));
  if (!match) return;
  pendingInviteCode = match[1];
  consumeInviteDeepLink();
}

NativeBridge.subscribeIpc("DEEP_LINK", (url) => {
  window.DiscordNative?.ipc?.invoke("DEEP_LINK_TAKE"); // already handled here
  handleDeepLink(url);
});
window.DiscordNative?.ipc?.invoke("DEEP_LINK_TAKE").then(handleDeepLink).catch(() => {});
store.subscribe(() => {
  if (pendingInviteCode) consumeInviteDeepLink();
});

NativeBridge.subscribeIpc("SPOTIFY_ACTIVITY", (activity) => {
  store.reportListening(activity);
});

NativeBridge.subscribeIpc("GAME_ACTIVITY", (activity) => {
  store.reportGameActivity(activity).then(() => {
    // Keep an open profile's "Atividade" list current
    if (uiState.profileView?.userId === store.getState().auth.currentUserId) loadProfileActivities(uiState.profileView.userId);
  });
});

// Taskbar preview buttons (Windows) while in a call
const thumbarIcons = { ready: null, last: "" };
function svgToPng(svg, color) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      c.getContext("2d").drawImage(img, 4, 4, 24, 24);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve("");
    // As an image an SVG needs its namespace (the inline icons don't carry it)
    const colored = (svg.includes("xmlns") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')).replace(/currentColor/g, color).replace(/width="\d+"/, 'width="24"').replace(/height="\d+"/, 'height="24"');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(colored)}`;
  });
}
async function syncCallThumbar() {
  const v = store.getState().voice;
  const inCall = Boolean(v.connectedChannelId);
  const key = inCall ? `${v.muted}|${v.deafened}` : "off";
  if (key === thumbarIcons.last) return;
  thumbarIcons.last = key;
  if (!inCall) return window.DiscordNative?.ipc?.send("CALL_THUMBAR", null);
  if (!thumbarIcons.ready) {
    const [mic, micOff, headphones, deafenOff, leave] = await Promise.all([
      svgToPng(Icons.mic, "#ffffff"),
      svgToPng(Icons.micOff, "#f23f43"),
      svgToPng(Icons.headphones, "#ffffff"),
      svgToPng(Icons.deafenOff, "#f23f43"),
      svgToPng(Icons.phoneOff, "#f23f43")
    ]);
    thumbarIcons.ready = { mic, micOff, headphones, deafenOff, leave };
  }
  window.DiscordNative?.ipc?.send("CALL_THUMBAR", { muted: v.muted, deafened: v.deafened, icons: thumbarIcons.ready });
}
store.subscribe(() => syncCallThumbar());

NativeBridge.subscribeIpc("CALL_LEAVE", () => {
  store.leaveVoiceChannel();
});

// Global mute shortcut (Configurações > Voz, Vídeo & Sons)
NativeBridge.subscribeIpc("HOTKEY_TOGGLE_MUTE", () => {
  if (!store.getState().auth.isAuthenticated) return;
  store.toggleMute();
});

NativeBridge.subscribeIpc("SYSTEM_TRAY_TOGGLE_MUTE", () => {
  store.toggleMute();
  showToast(store.getState().voice.muted ? "Microfone silenciado via Bandeja" : "Microfone ativado via Bandeja");
});

NativeBridge.subscribeIpc("SYSTEM_TRAY_TOGGLE_DEAFEN", () => {
  store.toggleDeafen();
  showToast(store.getState().voice.deafened ? "Áudio desativado via Bandeja" : "Áudio ativado via Bandeja");
});

NativeBridge.subscribeIpc("SYSTEM_TRAY_OPEN_VOICE_SETTINGS", () => {
  closeAllFloatingMenus();
  uiState.settingsOverlay = { type: "user", tab: "voice" };
  renderApp();
});

NativeBridge.subscribeIpc("MEMORY_SAVER_CHANGED", (enabled) => {
  uiState.memorySaver = Boolean(enabled);
  renderApp();
  setTimeout(refreshMemoryUsageLabel, 600);
});

// Checks the server for a newer version; on startup immediately notifies the user when there is one
async function checkForUpdates({ quiet = true, startup = false } = {}) {
  if (!window.DiscordNative?.app?.checkForUpdates) return;
  uiState.checkingUpdates = true;
  if (!quiet) renderApp();
  const info = await window.DiscordNative.app.checkForUpdates().catch(() => null);
  uiState.checkingUpdates = false;
  // A failed background check keeps what an earlier one found
  if (info?.ok || !quiet || !uiState.updateInfo?.available) uiState.updateInfo = info || { ok: false, error: "Não foi possível verificar." };
  if (info?.available && (startup || !quiet) && uiState.notifiedUpdateVersion !== info.latest) {
    uiState.notifiedUpdateVersion = info.latest;
    uiState.updateBannerDismissed = null;
    showToast(`🚀 Nova atualização disponível (v${info.latest})! Clique em "Atualizar agora" no topo da tela.`);
  } else if (!quiet && !info?.available) {
    showToast(info?.ok ? "Você já está na versão mais recente." : uiState.updateInfo.error);
  }
  renderApp();
}

// Bar under the titlebar while a newer version exists (and while it downloads)
function renderUpdateBanner() {
  const info = uiState.updateInfo;
  if (uiState.updatingApp) {
    return `
      <div class="update-banner" data-testid="update-banner">
        <span class="update-banner-text"><span class="js-update-label">${escapeHtml(uiState.updateLabel || "Preparando o download...")}</span></span>
        <div class="update-progress-track update-banner-track"><div class="update-progress-fill js-update-fill" style="width:${uiState.updatePercent || 0}%;"></div></div>
      </div>
    `;
  }
  if (!info?.available || uiState.updateBannerDismissed === info.latest) return "";
  return `
    <div class="update-banner" data-testid="update-banner">
      <span class="update-banner-text">Nova versão do ${escapeHtml(getAppName())} disponível: <strong>${escapeHtml(info.latest)}</strong> (você está na ${escapeHtml(info.current || "")})</span>
      <button type="button" class="btn btn-success btn-sm" data-action="install-update" data-testid="banner-install-update-btn">Atualizar agora</button>
      <button type="button" class="update-banner-close" data-action="dismiss-update-banner" aria-label="Depois" title="Depois">×</button>
    </div>
  `;
}

function paintUpdateProgress() {
  document.querySelectorAll(".js-update-fill").forEach((el) => (el.style.width = `${uiState.updatePercent || 0}%`));
  document.querySelectorAll(".js-update-label").forEach((el) => (el.textContent = uiState.updateLabel));
}

// Download progress of "Atualizar agora" (updated in place, no full redraw)
NativeBridge.subscribeIpc("UPDATE_PROGRESS", ({ received = 0, total = 0, done = false } = {}) => {
  const mb = (n) => (n / 1048576).toFixed(0);
  uiState.updatePercent = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
  uiState.updateLabel = done
    ? "Conferindo e instalando..."
    : total
      ? `Baixando ${uiState.updatePercent}% (${mb(received)} de ${mb(total)} MB)`
      : `Baixando ${mb(received)} MB...`;
  paintUpdateProgress();
});

NativeBridge.subscribeIpc("CHECK_FOR_UPDATES", () => {
  checkForUpdates({ quiet: false });
  uiState.settingsOverlay = { type: "user", tab: "windows" };
  renderApp();
});
// Checks immediately upon opening the app, then every 30 minutes
checkForUpdates({ quiet: true, startup: true });
setInterval(() => {
  if (!uiState.updatingApp) checkForUpdates({ quiet: true, startup: true });
}, 30 * 60 * 1000);

let replyHighlightTimer = null;

// The "new messages" pill only shows up while scrolled up AND after a good
// number of messages arrived (a couple of new ones is not worth a button)
const JUMP_BAR_MIN_NEW_MESSAGES = 8;
function shouldShowJumpBar() {
  return Boolean(uiState.isScrolledUp) && Number(uiState.newMessagesWhileScrolledUp || 0) >= JUMP_BAR_MIN_NEW_MESSAGES;
}
function jumpBarLabel() {
  const count = Number(uiState.newMessagesWhileScrolledUp || 0);
  return `${count > 99 ? "99+" : count} novas`;
}
function syncJumpToPresentBar() {
  const bar = document.getElementById("jump-to-present-bar");
  const label = document.getElementById("jump-to-present-label");
  if (!bar || !label) return;
  if (!shouldShowJumpBar()) {
    bar.setAttribute("hidden", "");
    return;
  }
  label.textContent = jumpBarLabel();
  bar.removeAttribute("hidden");
}

// Kamui: the accent color (crimson by default) can be any color the user picks.
// Saved on this PC and applied as --kamui-accent on <html>.
const KAMUI_ACCENT_STORAGE_KEY = "huddle.kamuiAccent";
const KAMUI_DEFAULT_ACCENT = "#e11d48";
const KAMUI_ACCENT_PRESETS = [
  { color: "#e11d48", name: "Carmesim" },
  { color: "#ef4444", name: "Vermelho" },
  { color: "#f97316", name: "Laranja" },
  { color: "#eab308", name: "Dourado" },
  { color: "#22c55e", name: "Verde" },
  { color: "#14b8a6", name: "Turquesa" },
  { color: "#06b6d4", name: "Ciano" },
  { color: "#3b82f6", name: "Azul" },
  { color: "#6366f1", name: "Índigo" },
  { color: "#8b5cf6", name: "Roxo" },
  { color: "#d946ef", name: "Magenta" },
  { color: "#f8fafc", name: "Branco" }
];
function normalizeHexColor(value) {
  const v = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}
function getKamuiAccent() {
  try {
    return normalizeHexColor(localStorage.getItem(KAMUI_ACCENT_STORAGE_KEY)) || KAMUI_DEFAULT_ACCENT;
  } catch (_) {
    return KAMUI_DEFAULT_ACCENT;
  }
}
function applyKamuiAccent(color) {
  document.documentElement.style.setProperty("--kamui-accent", normalizeHexColor(color) || KAMUI_DEFAULT_ACCENT);
}
function setKamuiAccent(color, { persist = true } = {}) {
  const hex = normalizeHexColor(color);
  if (!hex) return;
  applyKamuiAccent(hex);
  if (persist) {
    try {
      localStorage.setItem(KAMUI_ACCENT_STORAGE_KEY, hex);
    } catch (_) {}
  }
}
function renderKamuiAccentPicker() {
  const current = getKamuiAccent();
  return `
    <div class="kamui-accent-picker" data-testid="kamui-accent-picker">
      <div class="form-label" style="margin-bottom:4px;">Cor de destaque do Kamui</div>
      <p class="kamui-accent-hint">Troque o carmesim por qualquer cor: botões, seleção, bordas e menções usam essa cor.</p>
      <div class="kamui-accent-row">
        ${KAMUI_ACCENT_PRESETS.map(
          (p) => `<button type="button" class="kamui-accent-swatch ${p.color === current ? "active" : ""}" data-action="set-kamui-accent" data-color="${p.color}" title="${escapeHtml(p.name)}" aria-label="${escapeHtml(p.name)}" style="--swatch:${p.color};"></button>`
        ).join("")}
        <label class="kamui-accent-custom" title="Escolher qualquer cor">
          <input type="color" id="kamui-accent-input" value="${current}" aria-label="Escolher cor personalizada" />
          <span>Personalizada</span>
        </label>
        <code class="kamui-accent-hex" id="kamui-accent-hex">${current.toUpperCase()}</code>
        ${current !== KAMUI_DEFAULT_ACCENT ? `<button type="button" class="link-btn" data-action="set-kamui-accent" data-color="${KAMUI_DEFAULT_ACCENT}">Restaurar padrão</button>` : ""}
      </div>
    </div>
  `;
}
applyKamuiAccent(getKamuiAccent());
// Live preview while dragging in the color picker; saved when it closes
document.addEventListener("input", (e) => {
  if (e.target?.id !== "kamui-accent-input") return;
  setKamuiAccent(e.target.value, { persist: false });
  const hex = document.getElementById("kamui-accent-hex");
  if (hex) hex.textContent = String(e.target.value).toUpperCase();
});
document.addEventListener("change", (e) => {
  if (e.target?.id !== "kamui-accent-input") return;
  setKamuiAccent(e.target.value);
  renderApp();
});

function jumpToMessage(targetId, inCallChat = false) {
  const scroller = document.getElementById(inCallChat ? "call-chat-scroller" : "messages-scroller");
  const selector = `[data-message-id="${CSS.escape(targetId)}"]`;
  const targetEl = (scroller ? scroller.querySelector(selector) : null) || document.querySelector(selector);
  if (!targetEl) {
    showToast("A mensagem original não foi encontrada neste canal.");
    return;
  }
  const container = scroller || targetEl.closest(".messages-scroller, .call-chat-messages");
  if (container) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const targetScrollTop =
      container.scrollTop + (targetRect.top - containerRect.top) - container.clientHeight / 2 + targetRect.height / 2;
    const distance = Math.abs(container.scrollTop - targetScrollTop);
    // Smooth animation when nearby (<= 1100px), instant cut when far away
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: distance <= 1100 ? "smooth" : "instant"
    });
  } else {
    targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  uiState.highlightedMessageId = targetId;
  document.querySelectorAll(".reply-jump-highlight").forEach((el) => el.classList.remove("reply-jump-highlight"));
  // Force reflow so clicking the same reply preview again restarts the 3s animation
  void targetEl.offsetWidth;
  targetEl.classList.add("reply-jump-highlight");
  clearTimeout(replyHighlightTimer);
  replyHighlightTimer = setTimeout(() => {
    if (uiState.highlightedMessageId === targetId) uiState.highlightedMessageId = null;
    targetEl.classList.remove("reply-jump-highlight");
  }, 3000);
}

store.onChannelMessageCreated = (channelId, msg) => {
  const active = store.getActiveChannel();
  const callChatChId = document.getElementById("call-chat-form")?.getAttribute("data-channel-id");
  const isMe = msg?.authorId === store.getState().auth.currentUserId;
  if (active && active.id === channelId) {
    if (!isMe && uiState.isScrolledUp) {
      uiState.newMessagesWhileScrolledUp = Number(uiState.newMessagesWhileScrolledUp || 0) + 1;
      syncJumpToPresentBar();
    } else {
      uiState.isScrolledUp = false;
      uiState.newMessagesWhileScrolledUp = 0;
      syncJumpToPresentBar();
      const scroller = document.getElementById("messages-scroller");
      scrollChatToBottom(scroller);
    }
  }
  if (callChatChId === channelId) {
    const callScroller = document.getElementById("call-chat-scroller");
    scrollChatToBottom(callScroller);
  }
};

// Game covers come from the Steam CDN; if one fails, the card keeps its initials
document.addEventListener(
  "error",
  (e) => {
    if (e.target?.matches?.(".profile-activity-cover img")) e.target.remove();
  },
  true
);

// Belt and braces for the layout containers above: any stray scroll is undone
document.addEventListener(
  "scroll",
  (e) => {
    const el = e.target;
    if (el === document || !el.matches?.(".app-root, .workspace, .main-stage, .stage-content-split, .chat-column, #app")) return;
    if (el.scrollTop || el.scrollLeft) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  },
  true
);

store.onPermissionNotice = (text) => showToast(text);

// Speaking ring: toggled in place on the call tile, the row under the voice
// channel and the account bar (no full redraw several times a second)
store.onSpeakingChange = (userId, speaking) => {
  const id = CSS.escape(userId);
  const voice = store.getState().voice;
  const channel = store.getActiveGuild()?.channels.find((c) => c.id === voice.connectedChannelId);
  const participant = (channel?.voiceParticipants || []).find((p) => p.userId === userId);
  const muted = userId === store.getState().auth.currentUserId ? voice.muted : Boolean(participant?.muted);
  document.querySelectorAll(`.call-tile[data-user-id="${id}"]`).forEach((el) => el.classList.toggle("speaking", speaking && !muted));
  document
    .querySelectorAll(`.voice-user-row[data-user-id="${id}"] .avatar-wrap, .account-bar .avatar-wrap[data-user-id="${id}"]`)
    .forEach((el) => el.classList.toggle("speaking", speaking));
  // The DM call panel (above the conversation)
  document.querySelectorAll(`.dm-call-person[data-user-id="${id}"]`).forEach((el) => el.classList.toggle("speaking", speaking && !(userId === store.getState().auth.currentUserId && voice.muted)));
};

// "Ninguém atendeu": the countdown until the waiting call hangs up by itself
setInterval(() => {
  const el = document.getElementById("dm-call-countdown");
  const until = store.getState().voice.dmCall?.waitingUntil;
  if (!el || !until) return;
  const left = Math.max(0, Math.round((until - Date.now()) / 1000));
  el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}, 1000);

// Coming back to the window counts the channel on screen as read
window.addEventListener("focus", () => {
  const nav = store.getState().navigation;
  const id = nav.view === "home" ? nav.activeDmId : nav.callViewChannelId || nav.activeChannelId;
  if (id && store.isViewingChannel(id)) {
    store.clearUnread(id);
    renderApp();
  }
});

window.__DISCORD_STORE__ = store;
window.__DISCORD_UI_STATE__ = uiState;

window.addEventListener("DOMContentLoaded", async () => {
  renderApp();
  await store.init();
});
