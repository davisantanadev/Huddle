// ==========================================================================
// Discord Desktop Replica — Main Renderer Application Controller
// Connected to Real SQLite Backend (Zero Illustrative Users in Production)
// ==========================================================================

import { store, AVAILABLE_THEMES } from "./state/store.js";
import { Icons } from "./components/icons.js";
import {
  NativeBridge,
  IntegrationMetadata,
  ScreenShare,
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
  userPopout: null, // null | { userId }
  statusMenuOpen: false,
  serverMenuOpen: false,
  emojiPickerForMessageId: null, // null | "composer" | messageId
  pinnedPopoverOpen: false,
  replyingToMessageId: null,
  editingMessageId: null,
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
  screenShareResolution: "720p",
  screenShareFps: 15,
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

  // Confirmation dialog for destructive actions
  confirmDialog: null, // null | { title, message, quote?, confirmLabel, requirePassword?, attrs }

  // Account security tab
  accountSecurity: null, // snapshot from getAccountSecurity
  accountPanel: null, // null | "email" | "password" | "phone" (which editor is expanded)
  accountFeedback: null, // null | { scope, ok, msg }
  accountDevCode: null, // null | { scope, code } when no e-mail/SMS provider is configured
  accountBusy: false,

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
  return changed;
}

function hasAnyOpenFloatingMenu() {
  return Boolean(
    uiState.userPopout ||
      uiState.statusMenuOpen ||
      uiState.serverMenuOpen ||
      uiState.emojiPickerForMessageId ||
      uiState.pinnedPopoverOpen ||
      uiState.contextMenu
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

function renderAvatar(user, sizeClass = "", includeStatus = false, extraStyle = "") {
  const u = user || { displayName: "User", avatarColor: "#5865f2", avatarUrl: "", status: "offline" };
  const avatarUrl = u.avatarUrl || "";
  const bg = u.avatarColor || "#5865f2";
  const st = store.getState?.();
  const isSpeaking = Boolean(st?.voice?.speakingUsers?.[u.id]);
  const speakingClass = isSpeaking ? "speaking" : "";

  const scale = Number(u.avatarScale ?? u.avatar_scale ?? 1);
  const cropX = Number(u.avatarCropX ?? u.avatar_crop_x ?? 0);
  const cropY = Number(u.avatarCropY ?? u.avatar_crop_y ?? 0);
  const transformStyle = scale !== 1 || cropX !== 0 || cropY !== 0
    ? `transform: scale(${scale}) translate(${cropX}px, ${cropY}px);`
    : "";

  const inner = avatarUrl
    ? `<span class="avatar-clip"><img class="avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(u.displayName)}" style="${transformStyle}" /></span>`
    : escapeHtml(getInitials(u.displayName));
  const dot = includeStatus ? `<span class="status-dot ${escapeHtml(u.status || "offline")}"></span>` : "";
  return `
    <div class="avatar-wrap ${sizeClass} ${speakingClass}" style="background-color:${escapeHtml(bg)};${extraStyle}" data-user-id="${escapeHtml(u.id || "")}">
      ${inner}
      ${dot}
    </div>
  `;
}

function renderBanner(user, heightPx = 100, override = {}) {
  const bannerUrl = override.bannerUrl !== undefined ? override.bannerUrl : user?.bannerUrl || "";
  const bannerColor = override.bannerColor || user?.bannerColor || user?.avatarColor || "#5865f2";
  const posY = override.bannerPositionY !== undefined ? override.bannerPositionY : user?.bannerPositionY ?? 50;

  const scale = Number(override.bannerScale !== undefined ? override.bannerScale : user?.bannerScale ?? user?.banner_scale ?? 1);
  const cropX = Number(override.bannerCropX !== undefined ? override.bannerCropX : user?.bannerCropX ?? user?.banner_crop_x ?? 0);
  const cropY = Number(override.bannerCropY !== undefined ? override.bannerCropY : user?.bannerCropY ?? user?.banner_crop_y ?? 0);
  const bannerTransform = scale !== 1 || cropX !== 0 || cropY !== 0
    ? `transform: scale(${scale}) translate(${cropX}px, ${cropY}px);`
    : "";

  if (bannerUrl) {
    return `
      <div class="profile-banner-box" style="height:${heightPx}px;background-color:${escapeHtml(bannerColor)};" data-testid="profile-banner">
        <img
          class="profile-banner-img"
          src="${escapeHtml(bannerUrl)}"
          style="object-position:center ${Number(posY)}%;${bannerTransform}"
          alt="Profile Banner"
        />
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
  html = html.replace(/@([a-zA-Z0-9_.]+)/g, '<span class="mention-pill" data-mention="$1">@$1</span>');
  html = html.replace(/\n/g, "<br/>");
  return html;
}

// ==========================================================================
// Component Renderers
// ==========================================================================

function getAppName() {
  return store.getState().appConfig?.appName || "Eco";
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
                <input class="form-input code-input" id="email-gate-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required data-testid="email-gate-code" />
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
  const totalDmUnreads = state.dms.reduce((acc, d) => acc + (d.unreadCount || 0), 0);
  const pendingCount = state.friends.filter((f) => f.relation === "incoming").length;
  const homeBadge = totalDmUnreads + pendingCount;

  const guildsHtml = state.guilds
    .map((g) => {
      const isActive = state.navigation.view === "guild" && state.navigation.activeGuildId === g.id;
      const hasVoice = state.voice.connectedGuildId === g.id;
      const classes = [
        "guild-item-wrap",
        isActive ? "active" : "",
        g.unread && !isActive ? "unread" : ""
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
                ? `<img class="guild-icon-img" src="${escapeHtml(g.iconUrl)}" alt="${escapeHtml(g.name)}" />`
                : escapeHtml(g.shortName)
            }</div>
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
    const statusLabel = isRinging ? "Chamando..." : `Voz Conectada (${voice.pingMs} ms)`;
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
            <div class="rtc-channel-sub" data-testid="rtc-channel-sub">${locationLabel}</div>
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
        ${renderAvatar(me, "", true)}
        <div class="account-meta">
          <div class="account-name" data-testid="account-display-name">${escapeHtml(me.displayName)}</div>
          <div class="account-sub" data-testid="account-username-sub">@${escapeHtml(me.username)}</div>
        </div>
      </div>
      <div class="account-controls">
        <button
          class="icon-btn ${voice.muted ? "danger-active" : ""}"
          data-action="toggle-mute"
          title="${voice.muted ? "Ativar Microfone" : "Silenciar Microfone"}"
        >
          ${voice.muted ? Icons.micOff : Icons.mic}
        </button>
        <button
          class="icon-btn ${voice.deafened ? "danger-active" : ""}"
          data-action="toggle-deafen"
          title="${voice.deafened ? "Ativar Áudio" : "Desativar Áudio"}"
        >
          ${voice.deafened ? Icons.deafenOff : Icons.headphones}
        </button>
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
        : state.dms
            .map((dm) => {
              const u = state.users[dm.userId];
              if (!u) return "";
              const isActive =
                state.navigation.view === "home" && sec === "dm" && state.navigation.activeDmId === dm.id;
              return `
                <div class="dm-item ${isActive ? "active" : ""}" data-action="open-dm" data-dm-id="${dm.id}">
                  ${renderAvatar(u, "", true)}
                  <div class="dm-item-info">
                    <div class="dm-item-name">${escapeHtml(u.displayName)}</div>
                    <div class="dm-item-sub">@${escapeHtml(u.username)}</div>
                  </div>
                  ${dm.unreadCount > 0 ? `<span class="guild-badge" style="position:static;border:none;">${dm.unreadCount}</span>` : ""}
                </div>
              `;
            })
            .join("");

    return `
      <aside class="secondary-sidebar" data-testid="secondary-sidebar">
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

  const categoriesHtml = (guild.categories || [])
    .map((cat) => {
      const isCollapsed = Boolean(guild.collapsedCategories?.[cat.id]);
      const catChannels = (guild.channels || []).filter((c) => c.categoryId === cat.id);

      const channelsList = isCollapsed
        ? ""
        : catChannels
            .map((ch) => {
              const isActive = state.navigation.activeChannelId === ch.id && ch.type !== "voice";
              const isVoiceConnected =
                state.voice.connectedGuildId === guild.id && state.voice.connectedChannelId === ch.id;
              const activeShare = state.screenShares[ch.id];
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
                          const isSharing = activeShare && activeShare.userId === u.id;
                          return `
                            <div class="voice-user-row" data-action="open-user-popout" data-user-id="${u.id}">
                              <div class="voice-user-left">
                                ${renderAvatar(u, "", false, "width:22px;height:22px;min-width:22px;font-size:10px;")}
                                <span>${escapeHtml(u.displayName)}</span>
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
                    class="channel-item ${isActive || isVoiceConnected ? "active" : ""}"
                    data-action="select-channel"
                    data-channel-id="${ch.id}"
                  >
                    <div class="channel-item-left">
                      <span style="color:var(--channels-default);display:inline-flex;">${icon}</span>
                      <span class="channel-item-name">${escapeHtml(ch.name)}</span>
                    </div>
                    <div class="channel-item-actions">
                      <button
                        class="channel-action-btn"
                        data-action="open-invite-modal"
                        data-channel-id="${ch.id}"
                        title="Criar Convite"
                        aria-label="Criar Convite"
                      >${Icons.userPlus}</button>
                      ${
                        guild.channels.length > 1
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
            <button
              style="color:inherit;"
              data-action="open-create-channel"
              data-category-id="${cat.id}"
              title="Criar Canal"
            >${Icons.plus}</button>
          </div>
          ${channelsList}
        </div>
      `;
    })
    .join("");

  return `
    <aside class="secondary-sidebar" data-testid="secondary-sidebar">
      <div class="sidebar-header" data-action="toggle-server-menu" data-testid="server-header">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(guild.name)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <button
            class="server-invite-btn"
            data-action="open-invite-modal"
            title="Convidar Pessoas"
            data-testid="server-invite-btn"
          >${Icons.userPlus}<span>Convidar</span></button>
          <button
            class="icon-btn"
            style="width:24px;height:24px;"
            data-action="open-server-settings"
            title="Configurações do Servidor"
            data-testid="open-server-settings-btn"
          >${Icons.settings}</button>
          ${Icons.chevronDown}
        </div>
      </div>
      <div class="sidebar-scroller">
        ${
          guild.bannerUrl
            ? `<div class="guild-sidebar-banner" data-testid="guild-sidebar-banner"><img src="${escapeHtml(guild.bannerUrl)}" alt="Banner do servidor" /></div>`
            : ""
        }
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
                              : escapeHtml(u.customStatus || u.status)
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
  const activeRealFriends = state.friends
    .filter((f) => f.relation === "friend")
    .map((f) => state.users[f.userId])
    .filter((u) => u && u.status !== "offline");

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
                  <div class="active-now-card">
                    <div style="display:flex;align-items:center;gap:10px;">
                      ${renderAvatar(u, "", true)}
                      <div>
                        <div style="font-size:14px;font-weight:600;color:var(--header-primary);">${escapeHtml(u.displayName)}</div>
                        <div style="font-size:12px;color:var(--text-muted);">@${escapeHtml(u.username)} • ${escapeHtml(u.customStatus || "Online")}</div>
                      </div>
                    </div>
                  </div>
                `
                  )
                  .join("")
          }
        </aside>
      </div>
    </section>
  `;
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
          <span class="stage-title">Explorar Servidores Reais</span>
        </div>
      </header>
      <div style="flex:1;overflow-y:auto;padding:24px;">
        <div style="background:linear-gradient(135deg,#5865f2 0%,#1e1f22 100%);border-radius:12px;padding:28px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
          <div>
            <h1 style="font-size:24px;color:#fff;margin-bottom:6px;">Servidores Cadastrados no Sistema</h1>
            <p style="font-size:13px;color:rgba(255,255,255,0.85);">Entre em servidores reais existentes ou utilize um código de convite exclusivo.</p>
          </div>
          <button class="btn btn-success" data-action="open-modal" data-modal="create-server">
            Entrar com Código de Convite / Criar Servidor
          </button>
        </div>
        <div class="discovery-grid">
          ${items
            .map((d) => {
              const alreadyJoined = state.guilds.some((g) => g.id === d.id);
              return `
                <div class="discovery-card">
                  <div style="height:76px;background:${d.bannerColor};position:relative;">
                    <div style="position:absolute;bottom:-18px;left:16px;width:44px;height:44px;border-radius:12px;background:${d.iconColor};border:4px solid var(--bg-channels);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;">
                      ${escapeHtml(d.shortName)}
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
function renderScreenShareBannerAndStage(state) {
  const voiceChannelId = state.voice.connectedChannelId;
  const activeShare =
    (voiceChannelId && state.screenShares[voiceChannelId]) ||
    Object.values(state.screenShares || {})[0] ||
    null;

  if (!activeShare && !state.voice.screenShareEnabled) return "";

  const sharerUser = activeShare ? state.users[activeShare.userId] : store.getCurrentUser();
  const isMeSharing = state.voice.screenShareEnabled || activeShare?.userId === state.auth.currentUserId;
  const sourceTitle = activeShare?.sourceName || state.voice.screenShareSourceName || "Tela Principal";

  const stats = ScreenShare.getStats ? ScreenShare.getStats() : {};
  const displayFps = stats.sentFps || activeShare?.fps || 15;
  const displayCapFps = stats.capturedFps || activeShare?.fps || 15;
  const displayRes = stats.resolution || activeShare?.resolution || "720p";
  const displayBitrate = stats.bitrateKbps || 2500;

  return `
    <div style="padding:12px 16px 0 16px;" data-testid="screenshare-stage">
      <div class="screenshare-stage">
        <div style="padding:10px 14px;background:#111214;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-faint);">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="screenshare-live-badge">AO VIVO</span>
            <span style="font-size:13px;font-weight:700;color:#fff;">
              ${escapeHtml(sharerUser?.displayName || "Usuário")} (@${escapeHtml(sharerUser?.username || "user")}) está transmitindo: ${escapeHtml(sourceTitle)}
            </span>
            <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(displayRes)} • ${escapeHtml(String(displayFps))} FPS</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${
              isMeSharing
                ? `<button class="btn btn-danger" style="height:28px;font-size:12px;" data-action="stop-screenshare" data-testid="stop-screenshare-btn">Parar Transmissão</button>`
                : ""
            }
          </div>
        </div>
        <div style="position:relative;background:#000;display:flex;align-items:center;justify-content:center;min-height:200px;">
          ${
            isMeSharing && ScreenShare.getStream()
              ? `<video id="local-screenshare-video" class="screenshare-video" autoplay muted playsinline data-testid="screenshare-video"></video>`
              : activeShare?.frameDataUrl
                ? `<img class="screenshare-frame-img" src="${activeShare.frameDataUrl}" alt="Transmissão ao vivo" data-testid="screenshare-remote-img" />`
                : `<div style="color:#9ca3af;font-size:13px;padding:40px;">Recebendo stream de vídeo em tempo real...</div>`
          }
          <div class="stream-stats-overlay" data-testid="stream-stats-overlay" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);padding:6px 10px;border-radius:6px;font-size:11px;color:#fff;display:flex;gap:10px;pointer-events:none;z-index:10;border:1px solid rgba(255,255,255,0.1);">
            <div><span style="color:var(--text-muted);">Env:</span> <strong>${displayFps} FPS</strong></div>
            <div><span style="color:var(--text-muted);">Cap:</span> <strong>${displayCapFps} FPS</strong></div>
            <div><span style="color:var(--text-muted);">Bitrate:</span> <strong>${displayBitrate} kbps</strong></div>
            <div><span style="color:var(--text-muted);">Res:</span> <strong>${displayRes}</strong></div>
          </div>
        </div>
      </div>
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
            const author = state.users[m.authorId] || {
              id: m.authorId,
              displayName: "Usuário",
              username: "user",
              avatarColor: "#5865f2",
              avatarUrl: ""
            };
            const prev = idx > 0 ? visibleMessages[idx - 1] : null;
            const isGrouped = !isCompact && prev && prev.authorId === m.authorId && !m.replyToId;
            const isMentioned =
              m.content.toLowerCase().includes(`@${me.username.toLowerCase()}`) ||
              m.content.toLowerCase().includes("@everyone");

            const replyTarget = m.replyToId ? allMessages.find((item) => item.id === m.replyToId) : null;
            const replyAuthor = replyTarget ? state.users[replyTarget.authorId] : null;

            const replyHeaderHtml = replyTarget
              ? `<div class="message-reply-preview">
                  <span>↱</span>
                  <strong style="color:var(--header-primary);">@${escapeHtml(replyAuthor?.username || "user")}</strong>
                  <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;">${escapeHtml(replyTarget.content)}</span>
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

            const attachmentHtml = m.attachment
              ? `<div class="message-attachment-card">
                  ${
                    m.attachment.isImage && (m.attachment.url || m.attachment.dataUrl)
                      ? `<img class="message-attachment-img" src="${escapeHtml(m.attachment.url || m.attachment.dataUrl)}" alt="${escapeHtml(m.attachment.name)}" />`
                      : `<div class="message-file-box">
                          <span style="font-size:24px;">📄</span>
                          <div>
                            <div style="font-size:14px;font-weight:600;color:var(--link-color);">${escapeHtml(m.attachment.name)}</div>
                            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(m.attachment.size || "12 KB")}</div>
                          </div>
                        </div>`
                  }
                </div>`
              : "";

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

            return `
              <div
                class="message-row ${isGrouped ? "compact-followup" : ""} ${isMentioned ? "mentioned" : ""}"
                data-message-id="${m.id}"
              >
                ${
                  isCompact
                    ? `<span class="message-timestamp" style="min-width:55px;padding-top:3px;">${escapeHtml(m.timestamp.replace("Today at ", ""))}</span>`
                    : isGrouped
                      ? `<div class="message-gutter-time">${escapeHtml(m.timestamp.replace("Today at ", ""))}</div>`
                      : `<div data-action="open-user-popout" data-user-id="${author.id}" style="cursor:pointer;">
                          ${renderAvatar(author, "lg", false)}
                        </div>`
                }
                <div class="message-main">
                  ${replyHeaderHtml}
                  ${
                    !isGrouped || isCompact
                      ? `<div class="message-header">
                          <span class="message-author" data-action="open-user-popout" data-user-id="${author.id}">
                            ${escapeHtml(author.displayName)}
                          </span>
                          <span style="font-size:11px;color:var(--text-muted);">@${escapeHtml(author.username)}</span>
                          ${m.pinned ? `<span style="font-size:11px;color:var(--status-yellow);">📌 Fixada</span>` : ""}
                          <span class="message-timestamp">${escapeHtml(m.timestamp)}</span>
                        </div>`
                      : ""
                  }
                  ${contentHtml}
                  ${attachmentHtml}
                  ${reactionsHtml}
                  ${threadBadgeHtml}
                </div>

                <div class="message-toolbar">
                  <button class="toolbar-btn" data-action="toggle-reaction" data-message-id="${m.id}" data-emoji="👍" title="Curtir">👍</button>
                  <button class="toolbar-btn" data-action="toggle-reaction" data-message-id="${m.id}" data-emoji="🔥" title="Fogo">🔥</button>
                  <button class="toolbar-btn" data-action="open-emoji-picker" data-message-id="${m.id}" title="Adicionar Reação">${Icons.smile}</button>
                  <button class="toolbar-btn" data-action="reply-message" data-message-id="${m.id}" title="Responder">${Icons.reply}</button>
                  <button class="toolbar-btn" data-action="open-thread" data-message-id="${m.id}" title="Tópico">${Icons.thread}</button>
                  <button class="toolbar-btn" data-action="pin-message" data-message-id="${m.id}" title="${m.pinned ? "Desafixar" : "Fixar"}">${Icons.pin}</button>
                  ${
                    m.authorId === state.auth.currentUserId
                      ? `<button class="toolbar-btn" data-action="start-edit-message" data-message-id="${m.id}" title="Editar">${Icons.edit}</button>`
                      : ""
                  }
                  <button class="toolbar-btn danger" data-action="delete-message" data-message-id="${m.id}" title="Excluir">${Icons.trash}</button>
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
  } else if (state.navigation.showMemberList && !isDm) {
    const guild = store.getActiveGuild();
    const memberIds = Array.isArray(guild?.memberIds) && guild.memberIds.length > 0
      ? guild.memberIds
      : Object.keys(state.users);
    const guildUsers = memberIds.map((id) => state.users[id]).filter(Boolean);
    const onlineUsers = guildUsers.filter((u) => u.status !== "offline");
    const offlineUsers = guildUsers.filter((u) => u.status === "offline");

    rightSidebarHtml = `
      <aside class="members-sidebar" data-testid="members-sidebar">
        <div class="member-role-title">Online — ${onlineUsers.length}</div>
        ${onlineUsers
          .map(
            (u) => `
          <div class="member-item" data-action="open-user-popout" data-user-id="${u.id}">
            ${renderAvatar(u, "", true)}
            <div style="min-width:0;flex:1;">
              <div class="member-name" style="color:var(--header-primary);">
                ${escapeHtml(u.displayName)}
              </div>
              <div class="member-activity">@${escapeHtml(u.username)}</div>
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
                    <div class="member-name">${escapeHtml(u.displayName)}</div>
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
  } else if (uiState.stagedAttachment) {
    bannerHtml = `
      <div class="composer-banner">
        <span>📎 Arquivo anexado: <strong style="color:var(--header-primary);">${escapeHtml(uiState.stagedAttachment.name)}</strong> (${escapeHtml(uiState.stagedAttachment.size)})</span>
        <button style="color:var(--interactive-normal);" data-action="clear-attachment">${Icons.close}</button>
      </div>
    `;
  }

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
          ${
            !isDm
              ? `<button
                  class="icon-btn ${state.navigation.showMemberList ? "active" : ""}"
                  data-action="toggle-member-list"
                  title="Alternar Lista de Membros"
                  data-testid="toggle-members-btn"
                >${Icons.friends}</button>`
              : ""
          }
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

          <div class="composer-area">
            ${bannerHtml}
            <form id="message-composer-form" class="composer-box ${bannerHtml ? "has-banner" : ""}">
              <label class="icon-btn" title="Anexar Arquivo / Imagem" style="cursor:pointer;">
                ${Icons.plus}
                <input type="file" id="composer-file-input" style="display:none;" />
              </label>
              <input
                type="text"
                id="composer-text-input"
                data-testid="composer-input"
                class="composer-input"
                placeholder="Conversar em ${isDm ? `@${channel.name}` : `#${channel.name}`}"
                autocomplete="off"
              />
              <button type="button" class="icon-btn" data-action="insert-slash-shrug" title="Inserir /shrug">¯\\_(ツ)_/¯</button>
              <button type="button" class="icon-btn" data-action="open-emoji-picker" data-message-id="composer" title="Escolher Emoji">${Icons.smile}</button>
            </form>
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
      <button class="context-menu-item" data-action="open-invite-modal">
        <span>Convidar Pessoas</span>
        <span>📨</span>
      </button>
      <button class="context-menu-item" data-action="open-server-settings">
        <span>Configurações do Servidor</span>
        <span>⚙️</span>
      </button>
      <button class="context-menu-item" data-action="open-create-channel">
        <span>Criar Canal</span>
        <span>＋</span>
      </button>
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
      <div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--divider-subtle);margin-bottom:8px;">
        ${renderAvatar(me, "lg", true)}
        <div>
          <div style="font-weight:700;color:var(--header-primary);">${escapeHtml(me.displayName)}</div>
          <div style="font-size:12px;color:var(--text-muted);">@${escapeHtml(me.username)}</div>
        </div>
      </div>
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

function renderUserPopout(state) {
  if (!uiState.userPopout) return "";
  const u = state.users[uiState.userPopout.userId];
  if (!u) return "";
  const note = state.userNotes[u.id] || "";

  const guild = store.getActiveGuild();
  const me = store.getCurrentUser();
  const isOwner = guild && guild.ownerId === me.id;
  let canManageRoles = isOwner;
  let myHighestPos = isOwner ? 999999 : 0;
  if (guild && !isOwner) {
    const myRoleIds = guild.memberRoles?.[me.id] || [];
    for (const rid of myRoleIds) {
      const r = guild.roles.find((x) => x.id === rid);
      if (r) {
        if ((r.position || 0) > myHighestPos) myHighestPos = r.position;
        if (Array.isArray(r.permissions) && (r.permissions.includes("ADMINISTRATOR") || r.permissions.includes("MANAGE_ROLES"))) {
          canManageRoles = true;
        }
      }
    }
  }

  const memberRoleIds = guild ? (guild.memberRoles?.[u.id] || []) : [];
  const memberRoles = guild ? guild.roles.filter((r) => memberRoleIds.includes(r.id)) : [];
  const assignableRoles = guild && canManageRoles
    ? guild.roles.filter((r) => !memberRoleIds.includes(r.id) && r.name !== "@everyone" && (isOwner || (r.position || 0) < myHighestPos))
    : [];

  return `
    <div class="floating-popout" style="top:84px;right:255px;width:330px;" data-testid="user-profile-popout">
      <div style="position:relative;">
        ${renderBanner(u, 96)}
        <button
          style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.55);color:#fff;width:26px;height:26px;border-radius:50%;font-weight:700;"
          data-action="close-user-popout"
        >×</button>
      </div>
      <div style="padding:0 16px 16px 16px;position:relative;">
        <div style="margin-top:-42px;display:inline-block;border-radius:50%;border:6px solid var(--bg-floating);">
          ${renderExpandableAvatar(u)}
        </div>
        <div style="margin-top:8px;background:var(--bg-channels);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;">
          <div>
            <div style="font-size:18px;font-weight:700;color:var(--header-primary);">${escapeHtml(u.displayName)}</div>
            <div style="font-size:13px;color:var(--text-muted);" data-testid="popout-username">@${escapeHtml(u.username)}</div>
          </div>
          ${u.customStatus ? `<div style="font-size:13px;color:var(--text-normal);">${escapeHtml(u.customStatus)}</div>` : ""}
          <div style="height:1px;background:var(--divider-subtle);"></div>
          <div>
            <div class="form-label" style="margin-bottom:4px;">Sobre Mim</div>
            <div style="font-size:13px;color:var(--text-normal);">${escapeHtml(u.aboutMe || "Membro do Discord Desktop.")}</div>
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

          ${guild ? `
            <div style="height:1px;background:var(--divider-subtle);"></div>
            <div>
              <div class="form-label" style="margin-bottom:6px;">Cargos no Servidor (${memberRoles.length})</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;" data-testid="user-popout-roles">
                ${memberRoles.map(r => {
                  const canRemove = isOwner || (canManageRoles && (r.position || 0) < myHighestPos && r.name !== "@everyone");
                  return `
                    <span
                      class="role-badge-pill"
                      style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid ${r.color || "var(--text-muted)"};font-size:11px;font-weight:600;color:${r.color || "var(--header-primary)"};"
                      data-role-id="${r.id}"
                    >
                      <span style="width:8px;height:8px;border-radius:50%;background:${r.color || "var(--text-muted)"};"></span>
                      ${escapeHtml(r.name)}
                      ${canRemove ? `
                        <button
                          type="button"
                          class="role-remove-btn"
                          data-action="remove-user-role"
                          data-guild-id="${guild.id}"
                          data-user-id="${u.id}"
                          data-role-id="${r.id}"
                          style="background:none;border:none;color:${r.color || "inherit"};cursor:pointer;font-size:13px;padding:0 2px;line-height:1;"
                          title="Remover cargo"
                        >×</button>
                      ` : ""}
                    </span>
                  `;
                }).join("")}
                ${memberRoles.length === 0 ? `<span style="font-size:11px;color:var(--text-muted);">Nenhum cargo atribuído.</span>` : ""}
              </div>

              ${canManageRoles && assignableRoles.length > 0 ? `
                <select
                  class="form-input"
                  style="height:30px;font-size:11px;padding:2px 8px;"
                  data-action="assign-user-role-select"
                  data-guild-id="${guild.id}"
                  data-user-id="${u.id}"
                  data-testid="assign-role-select"
                >
                  <option value="">+ Atribuir Cargo...</option>
                  ${assignableRoles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("")}
                </select>
              ` : ""}
            </div>
          ` : ""}

          ${
            u.id !== state.auth.currentUserId
              ? `<form id="popout-dm-form" data-target-user="${u.id}">
                  <input
                    type="text"
                    name="quickDm"
                    class="form-input"
                    style="width:100%;height:34px;font-size:13px;"
                    placeholder="Conversar com @${escapeHtml(u.username)}"
                    required
                  />
                </form>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function renderEmojiPickerPopover() {
  if (!uiState.emojiPickerForMessageId) return "";
  const target = uiState.emojiPickerForMessageId;
  return `
    <div class="floating-popout" style="bottom:80px;right:260px;padding:10px;width:240px;" data-testid="emoji-picker">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Selecionar Emoji</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        ${EMOJI_PALETTE.map(
          (e) => `
          <button
            class="btn btn-secondary"
            style="font-size:20px;padding:0;"
            data-action="select-emoji"
            data-target="${target}"
            data-emoji="${e}"
          >${e}</button>
        `
        ).join("")}
      </div>
    </div>
  `;
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
            <p style="font-size:13px;color:var(--text-muted);">
              Selecione a tela inteira ou uma janela específica do sistema para transmitir ao vivo no canal de voz:
            </p>
            <div class="screen-source-grid" data-testid="screen-source-grid">
              ${
                sources.length === 0
                  ? `<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--text-muted);">Carregando fontes de captura de tela...</div>`
                  : sources
                      .map((src) => {
                        const isSel = uiState.selectedScreenSourceId === src.id;
                        return `
                          <div
                            class="screen-source-card ${isSel ? "selected" : ""}"
                            data-action="select-screen-source"
                            data-source-id="${escapeHtml(src.id)}"
                            data-source-name="${escapeHtml(src.name)}"
                            data-testid="screen-source-item"
                          >
                            ${
                              src.thumbnail
                                ? `<img class="screen-source-thumb" src="${src.thumbnail}" alt="${escapeHtml(src.name)}" />`
                                : `<div class="screen-source-thumb" style="display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;">🖥️</div>`
                            }
                            <div style="font-size:12px;font-weight:600;color:var(--header-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                              ${escapeHtml(src.name)}
                            </div>
                          </div>
                        `;
                      })
                      .join("")
              }
            </div>
            <div style="display:flex;gap:12px;background:var(--bg-channels);padding:12px;border-radius:8px;">
              <div class="form-group" style="flex:1;">
                <label class="form-label">Qualidade da Transmissão</label>
                <select class="form-input" id="screenshare-res-select" style="height:34px;">
                  <option value="720p" ${uiState.screenShareResolution === "720p" ? "selected" : ""}>720p HD (Otimizado para baixa RAM)</option>
                  <option value="1080p" ${uiState.screenShareResolution === "1080p" ? "selected" : ""}>1080p Full HD</option>
                </select>
              </div>
              <div class="form-group" style="flex:1;">
                <label class="form-label">Taxa de Quadros</label>
                <select class="form-input" id="screenshare-fps-select" style="height:34px;">
                  <option value="15" ${uiState.screenShareFps === 15 ? "selected" : ""}>15 FPS</option>
                  <option value="30" ${uiState.screenShareFps === 30 ? "selected" : ""}>30 FPS</option>
                  <option value="60" ${uiState.screenShareFps === 60 ? "selected" : ""}>60 FPS (Máxima Fluidez)</option>
                </select>
              </div>
            </div>
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
const ROLE_PERMISSIONS = [
  { flag: "ADMINISTRATOR", label: "Administrador (Acesso Total)", desc: "Membros com este cargo ignoram todas as restrições de canais e permissões." },
  { flag: "MANAGE_GUILD", label: "Gerenciar Servidor", desc: "Permite alterar nome, ícone e configurações globais do servidor." },
  { flag: "MANAGE_ROLES", label: "Gerenciar Cargos", desc: "Permite criar, editar e excluir cargos posicionados abaixo deste." },
  { flag: "MANAGE_CHANNELS", label: "Gerenciar Canais", desc: "Permite criar, editar e excluir canais de texto e voz." },
  { flag: "KICK_MEMBERS", label: "Expulsar Membros", desc: "Permite remover membros do servidor." },
  { flag: "BAN_MEMBERS", label: "Banir Membros", desc: "Permite banir membros permanentemente do servidor." },
  { flag: "SEND_MESSAGES", label: "Enviar Mensagens", desc: "Permite enviar mensagens de texto e mídia em canais." },
  { flag: "CONNECT", label: "Conectar na Voz", desc: "Permite entrar e ouvir canais de voz." },
  { flag: "SPEAK", label: "Falar na Voz", desc: "Permite transmitir áudio do microfone na chamada." },
  { flag: "STREAM", label: "Transmitir Tela (Ao Vivo)", desc: "Permite transmitir telas e janelas em 60 FPS." },
  { flag: "MENTION_EVERYONE", label: "Mencionar @everyone", desc: "Permite enviar notificações para todos os membros." }
];

function renderServerRolesManager(guild, me, state) {
  const roles = [...(guild.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const isOwner = guild.ownerId === me.id;

  let myHighestPos = isOwner ? 999999 : 0;
  if (!isOwner) {
    const myRoleIds = guild.memberRoles?.[me.id] || [];
    for (const rid of myRoleIds) {
      const r = guild.roles.find((x) => x.id === rid);
      if (r && (r.position || 0) > myHighestPos) {
        myHighestPos = r.position;
      }
    }
  }

  let selectedRoleId = state.serverSettings?.selectedRoleId || (roles[0]?.id || null);
  let selectedRole = roles.find((r) => r.id === selectedRoleId) || roles[0];
  if (!selectedRole && roles.length > 0) selectedRole = roles[0];

  const isEveryone = selectedRole?.name === "@everyone" || selectedRole?.id === guild.id;
  const canManageThisRole = isOwner || (myHighestPos > (selectedRole?.position || 0) && !isEveryone);

  return `
    <div class="roles-manager-container" data-testid="roles-manager-container" style="display:flex;gap:20px;height:100%;min-height:500px;">
      <div class="roles-sidebar" style="width:230px;background:var(--bg-card-secondary);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--border-faint);">
          <strong style="color:var(--header-primary);font-size:12px;text-transform:uppercase;">Cargos (${roles.length})</strong>
          ${isOwner || myHighestPos > 0 ? `
            <button
              class="btn btn-primary"
              style="height:26px;font-size:11px;padding:0 8px;"
              data-action="create-new-role"
              data-guild-id="${guild.id}"
              data-testid="create-role-btn"
            >
              + Criar Cargo
            </button>
          ` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;overflow-y:auto;flex:1;">
          ${roles.map((r) => {
            const isSel = selectedRole && selectedRole.id === r.id;
            return `
              <button
                type="button"
                class="role-list-item ${isSel ? "active" : ""}"
                data-action="select-role-settings"
                data-role-id="${r.id}"
                data-testid="role-item-${r.id}"
                style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:4px;border:none;background:${isSel ? "var(--bg-modifier-selected)" : "transparent"};cursor:pointer;width:100%;text-align:left;transition:background 0.15s;"
              >
                <span style="width:12px;height:12px;border-radius:50%;background:${r.color || "#99aab5"};flex-shrink:0;"></span>
                <span style="font-size:13px;font-weight:600;color:${isSel ? "var(--header-primary)" : "var(--text-normal)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
                  ${escapeHtml(r.name)}
                </span>
                <span style="font-size:10px;color:var(--text-muted);">#${r.position || 0}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>

      <div class="role-edit-pane" style="flex:1;background:var(--bg-channels);border-radius:8px;padding:18px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;" data-testid="role-editor-pane">
        ${selectedRole ? `
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>
              <h3 style="font-size:18px;color:var(--header-primary);margin:0;display:flex;align-items:center;gap:8px;">
                <span style="width:14px;height:14px;border-radius:50%;background:${selectedRole.color || "#99aab5"};"></span>
                Editar Cargo — ${escapeHtml(selectedRole.name)}
              </h3>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                Posição hierárquica: #${selectedRole.position || 0} ${isEveryone ? "(Cargo base para todos os membros)" : ""}
              </div>
            </div>
            ${!canManageThisRole && !isOwner ? `
              <span class="hierarchy-badge" style="background:rgba(237,66,69,0.15);color:var(--status-red);padding:4px 8px;border-radius:4px;font-size:11px;font-weight:700;">
                🔒 Nível superior ao seu (Somente Leitura)
              </span>
            ` : ""}
          </div>

          <form id="edit-role-form" data-guild-id="${guild.id}" data-role-id="${selectedRole.id}" style="display:flex;flex-direction:column;gap:14px;">
            <div class="form-group">
              <label class="form-label">Nome do Cargo *</label>
              <input
                type="text"
                id="role-name-input"
                data-testid="role-name-input"
                class="form-input"
                name="name"
                value="${escapeHtml(selectedRole.name)}"
                ${(!canManageThisRole && !isOwner) || isEveryone ? "disabled" : ""}
                required
              />
            </div>

            <div class="form-group">
              <label class="form-label">Cor do Cargo</label>
              <div style="display:flex;align-items:center;gap:10px;">
                <input
                  type="color"
                  id="role-color-picker"
                  data-testid="role-color-picker"
                  name="color"
                  value="${selectedRole.color || "#99aab5"}"
                  style="width:40px;height:36px;padding:2px;background:var(--bg-input);border-radius:4px;cursor:pointer;"
                  ${(!canManageThisRole && !isOwner) ? "disabled" : ""}
                />
                <input
                  type="text"
                  id="role-color-hex"
                  class="form-input"
                  style="width:100px;"
                  value="${selectedRole.color || "#99aab5"}"
                  ${(!canManageThisRole && !isOwner) ? "disabled" : ""}
                />
              </div>
            </div>

            <div class="form-group" style="display:flex;align-items:center;gap:10px;">
              <input
                type="checkbox"
                id="role-hoist-checkbox"
                data-testid="role-hoist-checkbox"
                name="hoist"
                ${selectedRole.hoist ? "checked" : ""}
                ${(!canManageThisRole && !isOwner) ? "disabled" : ""}
                style="width:18px;height:18px;accent-color:var(--brand-purple);"
              />
              <label for="role-hoist-checkbox" class="form-label" style="margin:0;cursor:pointer;">
                Exibir membros com este cargo separadamente na lista lateral
              </label>
            </div>

            <div style="height:1px;background:var(--divider-subtle);margin:4px 0;"></div>

            <div>
              <div class="form-label" style="margin-bottom:10px;">Permissões do Cargo (${(selectedRole.permissions || []).length} Ativas)</div>
              <div class="permissions-checklist" style="display:flex;flex-direction:column;gap:8px;" data-testid="role-permissions-checklist">
                ${ROLE_PERMISSIONS.map((p) => {
                  const hasPerm = Array.isArray(selectedRole.permissions)
                    ? selectedRole.permissions.includes(p.flag) || selectedRole.permissions.includes("ADMINISTRATOR")
                    : false;
                  return `
                    <div style="background:var(--bg-card-secondary);padding:10px 12px;border-radius:6px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                      <div>
                        <strong style="font-size:13px;color:var(--header-primary);">${escapeHtml(p.label)}</strong>
                        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escapeHtml(p.desc)}</div>
                      </div>
                      <input
                        type="checkbox"
                        class="role-perm-checkbox"
                        data-perm-flag="${p.flag}"
                        data-testid="perm-checkbox-${p.flag}"
                        ${hasPerm ? "checked" : ""}
                        ${(!canManageThisRole && !isOwner) ? "disabled" : ""}
                        style="width:18px;height:18px;accent-color:var(--brand-purple);margin-top:2px;"
                      />
                    </div>
                  `;
                }).join("")}
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:12px;border-top:1px solid var(--border-faint);">
              ${!isEveryone && (canManageThisRole || isOwner) ? `
                <button
                  type="button"
                  class="btn btn-danger"
                  style="font-size:12px;"
                  data-action="delete-role"
                  data-guild-id="${guild.id}"
                  data-role-id="${selectedRole.id}"
                  data-testid="delete-role-btn"
                >
                  Excluir Cargo
                </button>
              ` : `<span></span>`}

              ${(canManageThisRole || isOwner) ? `
                <button
                  type="submit"
                  class="btn btn-success"
                  style="font-size:13px;"
                  data-testid="save-role-btn"
                >
                  Salvar Alterações do Cargo
                </button>
              ` : ""}
            </div>
          </form>
        ` : `
          <div style="color:var(--text-muted);display:flex;align-items:center;justify-content:center;height:100%;">
            Selecione um cargo à esquerda para gerenciar permissões.
          </div>
        `}
      </div>
    </div>
  `;
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
  root.innerHTML = `
    <div class="modal-backdrop" data-action="close-gif-picker-backdrop">
      <div class="modal-card wide gif-modal-box" data-testid="gif-picker-modal" role="dialog" aria-labelledby="gif-picker-title">
        <div class="modal-header">
          <div>
            <h2 id="gif-picker-title" style="font-size:18px;">Biblioteca de GIFs</h2>
            <div style="font-size:12px;color:var(--text-muted);">
              Escolha uma animação para o seu ${gp.target === "avatar" ? "avatar" : "banner"}
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
  const transform = `scale(${scale}) translate(${cropX}px, ${cropY}px)`;

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
                  style="width:100%;height:100%;object-fit:cover;transform:${transform};transform-origin:center center;"
                />
              </div>
            ` : `
              <div class="media-editor-crop-banner" style="width:360px;height:120px;border-radius:8px;overflow:hidden;border:3px solid var(--brand-purple);box-shadow:0 0 0 9999px rgba(0,0,0,0.65);position:relative;background:#202225;">
                <img
                  id="media-editor-preview-img"
                  src="${escapeHtml(me.mediaUrl)}"
                  alt="Pré-visualização"
                  style="width:100%;height:100%;object-fit:cover;transform:${transform};transform-origin:center center;"
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
                  <span id="editor-panx-label" style="font-size:11px;color:var(--text-muted);">${cropX}px</span>
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
                  <span id="editor-pany-label" style="font-size:11px;color:var(--text-muted);">${cropY}px</span>
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
                 ${guild.bannerUrl ? `<button type="button" class="btn btn-secondary" style="height:30px;font-size:12px;" data-action="remove-guild-banner">Remover Banner</button>` : ""}
               </div>`
            : ""
        }
        <div style="font-size:11px;color:var(--text-muted);">Aparece no topo da lista de canais. Recomendado: 960×540 (16:9).</div>
      </div>

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
    </div>
  `;
}

// ==========================================================================
// Profile photo lightbox & incoming DM call card
// ==========================================================================
function renderExpandableAvatar(user) {
  const avatar = renderAvatar(user, "xl", true);
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

    <section class="settings-card" data-testid="audio-devices-config-panel">
      <div class="settings-card-head">
        <h3>Dispositivos</h3>
      </div>
      <div class="settings-grid-2">
        <div class="form-group">
          <label class="form-label" for="audio-input-device-select">Entrada (microfone)</label>
          <select class="form-input" id="audio-input-device-select" data-testid="audio-input-device-select">
            ${inputs.map((d) => `<option value="${d.deviceId}" ${s.audioInputDeviceId === d.deviceId || uiState.selectedAudioInput === d.deviceId ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="audio-output-device-select">Saída (alto-falantes / fones)</label>
          <select class="form-input" id="audio-output-device-select" data-testid="audio-output-device-select">
            ${outputs.map((d) => `<option value="${d.deviceId}" ${s.audioOutputDeviceId === d.deviceId || uiState.selectedAudioOutput === d.deviceId ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("")}
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
          <div class="setting-desc">Filtra ruídos de fundo do microfone durante as chamadas.</div>
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

// Brazilian numbers: (DD) NNNN-NNNN (landline) or (DD) NNNNN-NNNN (mobile)
function formatPhoneInput(rawDigits, international = false) {
  if (international) return "+" + rawDigits.slice(0, 15);
  const d = rawDigits.slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
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
        <strong>Modo desenvolvimento:</strong> nenhum provedor de ${dev.channel === "sms" ? "SMS" : "e-mail"} configurado, então o código não foi enviado.
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
        <input class="form-input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" aria-label="Código de verificação" required />
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
        <p>E-mail, senha e telefone usados para entrar e proteger sua conta.</p>
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

  // Phone
  let phoneEditor = "";
  if (sec.pendingPhone) {
    phoneEditor = renderCodeForm({ purpose: "phone_verify", sentTo: sec.pendingPhone.masked, scope: "phone", allowResend: false, changeLabel: "Usar outro número" });
  } else if (panel === "phone") {
    phoneEditor = `
      <form class="account-editor" data-account-form="phone">
        <div class="form-group">
          <label class="form-label" for="account-phone">Número de celular</label>
          <input class="form-input" id="account-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="20" placeholder="(11) 91234-5678" required data-testid="account-phone-input" />
          <div class="setting-desc">Número do Brasil com DDD. Para outro país, comece com + e o código do país.</div>
        </div>
        <div class="form-group">
          <label class="form-label" for="account-phone-password">Senha atual</label>
          <input class="form-input" id="account-phone-password" name="currentPassword" type="password" autocomplete="current-password" required />
        </div>
        <div class="btn-row end">
          <button type="submit" class="btn btn-primary btn-sm" ${uiState.accountBusy ? "disabled" : ""}>Enviar código por SMS</button>
        </div>
        ${renderAccountFeedback("phone")}
      </form>
    `;
  } else {
    phoneEditor = renderAccountFeedback("phone");
  }
  const phoneRow = `
    <div class="account-row" data-testid="account-phone-row">
      <div class="account-row-icon">${Icons.smartphone}</div>
      <div class="account-row-body">
        <div class="setting-title">
          Telefone
          ${sec.phone ? `<span class="status-pill ${sec.phoneVerified ? "ok" : "warn"}">${sec.phoneVerified ? "Verificado" : "Não verificado"}</span>` : ""}
        </div>
        <div class="account-row-value ${sec.phone ? "" : "muted"}">${sec.phone ? escapeHtml(sec.phoneMasked) : "Nenhum número adicionado"}</div>
        ${phoneEditor}
      </div>
      <div class="btn-row">
        ${
          !sec.pendingPhone
            ? `<button type="button" class="btn btn-secondary btn-sm" data-action="account-toggle-panel" data-panel="phone" data-testid="change-phone-btn">${panel === "phone" ? "Fechar" : sec.phone ? "Alterar" : "Adicionar"}</button>`
            : ""
        }
        ${sec.phone && !sec.pendingPhone ? `<button type="button" class="icon-square-btn danger" data-action="remove-account-phone" data-testid="remove-phone-btn" title="Remover número" aria-label="Remover número">${Icons.trash}</button>` : ""}
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

  const providerNote =
    !sec.providers.email || !sec.providers.sms
      ? `<div class="provider-note">
          ${Icons.alert}
          <div>
            <strong>${
              !sec.providers.email && !sec.providers.sms
                ? "Envio de e-mail e SMS ainda não configurado."
                : !sec.providers.email
                  ? "Envio de e-mail ainda não configurado."
                  : "Envio de SMS ainda não configurado."
            }</strong>
            Os códigos de verificação aparecem aqui na tela em vez de serem enviados.
            Para ativar o envio, coloque as chaves do ${[!sec.providers.email && "Resend", !sec.providers.sms && "Twilio"].filter(Boolean).join(" e do ")}
            em <code>%APPDATA%\\Eco\\app.config.local.json</code> e reinicie o app (passo a passo no README).
          </div>
        </div>`
      : "";

  const verifiedCount = [sec.emailVerified, sec.phoneVerified].filter(Boolean).length;

  return `
    <div class="settings-page-head">
      <h2>Minha Conta</h2>
      <p>E-mail, senha e telefone usados para entrar e proteger sua conta.</p>
    </div>

    <section class="account-summary">
      ${renderAvatar(me, "", false, "width:64px;height:64px;min-width:64px;font-size:22px;")}
      <div style="min-width:0;flex:1;">
        <div class="account-summary-name">${escapeHtml(me.displayName)}</div>
        <div class="account-summary-sub">@${escapeHtml(me.username)}</div>
      </div>
      <div class="account-summary-security ${verifiedCount === 2 ? "ok" : ""}">
        ${Icons.shieldCheck}
        <span>${verifiedCount === 2 ? "Conta protegida" : `${verifiedCount}/2 verificações`}</span>
      </div>
    </section>

    ${providerNote}

    <section class="settings-card account-list">
      ${usernameRow}
      ${emailRow}
      ${phoneRow}
      ${passwordRow}
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
            <button class="settings-nav-item ${tab === "audit" ? "active" : ""}" data-action="settings-tab" data-type="server" data-tab="audit">Registro de Auditoria (${guild.auditLog.length})</button>
          </div>
        </div>
        <div class="settings-content-wrap">
          <div class="settings-main-panel">
            ${
              tab === "roles"
                ? renderServerRolesManager(guild, me, state)
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
        Escolha entre 10 temas predefinidos com aplicação imediata e persistência automática.
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
    panelHtml = `
      <h2 style="color:var(--header-primary);margin-bottom:16px;">Configurações do Windows & Desempenho</h2>
      <div style="background:var(--bg-channels);padding:16px;border-radius:8px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <strong style="color:var(--header-primary);">Minimizar para a Bandeja (System Tray)</strong>
            <div style="font-size:12px;color:var(--text-muted);">Fechar a janela mantém o Discord ativo na bandeja do Windows</div>
          </div>
          <button class="btn ${s.minimizeToTray ? "btn-success" : "btn-secondary"}" data-action="toggle-setting" data-key="minimizeToTray">
            ${s.minimizeToTray ? "Ativado" : "Desativado"}
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <strong style="color:var(--header-primary);">Otimização de Memória RAM (Purge & Working Set Trim)</strong>
            <div style="font-size:12px;color:var(--text-muted);">Libera caches ociosos de imagem e aciona coleta de lixo V8</div>
          </div>
          <button class="btn btn-primary" data-action="purge-memory-now">Otimizar RAM Agora</button>
        </div>
      </div>
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
          <div class="settings-section-label">Configurações do App</div>
          <button class="settings-nav-item ${tab === "appearance" ? "active" : ""}" data-action="settings-tab" data-type="user" data-tab="appearance" data-testid="settings-tab-appearance">Aparência (10 Temas)</button>
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

function renderContextMenu() {
  if (!uiState.contextMenu) return "";
  const { x, y, items } = uiState.contextMenu;
  return `
    <div class="context-menu" style="left:${x}px;top:${y}px;" data-testid="context-menu">
      ${items
        .map(
          (it, idx) => `
        <button class="context-menu-item ${it.danger ? "danger" : ""}" data-context-idx="${idx}">
          <span>${escapeHtml(it.label)}</span>
        </button>
      `
        )
        .join("")}
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
    root.innerHTML = renderAuthScreen(state);
    bindFormEvents();
    return;
  }

  if (state.auth.emailGate) {
    root.innerHTML = renderEmailGateScreen(state);
    bindFormEvents();
    return;
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
    mainStageHtml = renderChatStage(state);
  }

  root.innerHTML = `
    <div class="app-root" data-theme="${escapeHtml(state.settings.theme)}" style="--font-scale:${state.settings.fontScale || 1};">
      ${renderTitlebar(state)}
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
      ${renderMediaEditorModal(state)}
      ${renderSettingsOverlay(state)}
      ${renderContextMenu()}
      ${renderIncomingCall(state)}
      ${renderAvatarLightbox()}
      ${renderConfirmDialog()}
      ${renderSwitchAccountPrompt()}
    </div>
  `;


  bindFormEvents();
  attachLiveScreenShareVideo();
}

function attachLiveScreenShareVideo() {
  const videoEl = document.getElementById("local-screenshare-video");
  const stream = ScreenShare.getStream();
  if (videoEl && stream && videoEl.srcObject !== stream) {
    videoEl.srcObject = stream;
    videoEl.play().catch(() => {});
  }
}

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

async function openScreenSharePickerModal() {
  closeAllFloatingMenus();
  uiState.activeModal = "screenshare-picker";
  uiState.loadingScreenSources = true;
  renderApp();

  const sources = await store.getScreenShareSources();
  uiState.screenSources = sources;
  uiState.loadingScreenSources = false;
  if (sources.length > 0 && !uiState.selectedScreenSourceId) {
    uiState.selectedScreenSourceId = sources[0].id;
    uiState.selectedScreenSourceName = sources[0].name;
  }
  renderApp();
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

  // Message Composer Form
  const composerForm = document.getElementById("message-composer-form");
  if (composerForm) {
    composerForm.addEventListener("submit", async (e) => {
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
      input.value = "";

      await store.sendMessage(channel.id, text, { replyToId, attachment });
      renderApp();
      const scroller = document.getElementById("messages-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  // File Attachment Input
  const fileInput = document.getElementById("composer-file-input");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const isImage = file.type.startsWith("image/");
      const sizeKb = Math.max(1, Math.round(file.size / 1024)) + " KB";
      if (isImage) {
        const base64Data = await readFileAsBase64(file);
        const up = await store.uploadMedia({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
          kind: "attachment"
        });
        if (up.ok) {
          uiState.stagedAttachment = { name: file.name, size: sizeKb, isImage: true, url: up.url };
          renderApp();
        } else {
          showToast(up.error || "Arquivo de imagem inválido.");
        }
      } else {
        uiState.stagedAttachment = { name: file.name, size: sizeKb, isImage: false };
        renderApp();
      }
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
      await store.updatePreferences({ audioInputDeviceId: audioInputSel.value });
      showToast("Dispositivo de entrada de microfone atualizado!");
    });
  }

  const audioOutputSel = document.getElementById("audio-output-device-select");
  if (audioOutputSel) {
    audioOutputSel.addEventListener("change", async () => {
      uiState.selectedAudioOutput = audioOutputSel.value;
      await store.updatePreferences({ audioOutputDeviceId: audioOutputSel.value });
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

  // Phase 8: Media Framing & Crop Sliders
  const zoomSlider = document.getElementById("media-editor-zoom-slider");
  const panXSlider = document.getElementById("media-editor-panx-slider");
  const panYSlider = document.getElementById("media-editor-pany-slider");
  const previewImg = document.getElementById("media-editor-preview-img");

  const syncEditorTransform = () => {
    const s = zoomSlider ? Number(zoomSlider.value) : 1;
    const x = panXSlider ? Number(panXSlider.value) : 0;
    const y = panYSlider ? Number(panYSlider.value) : 0;
    if (previewImg) {
      previewImg.style.transform = `scale(${s}) translate(${x}px, ${y}px)`;
    }
    const zLbl = document.getElementById("editor-zoom-label");
    if (zLbl) zLbl.textContent = `${s.toFixed(2)}x`;
    const xLbl = document.getElementById("editor-panx-label");
    if (xLbl) xLbl.textContent = `${x}px`;
    const yLbl = document.getElementById("editor-pany-label");
    if (yLbl) yLbl.textContent = `${y}px`;
    store.updateMediaEditorCoords({ scale: s, cropX: x, cropY: y });
  };

  if (zoomSlider) zoomSlider.addEventListener("input", syncEditorTransform);
  if (panXSlider) panXSlider.addEventListener("input", syncEditorTransform);
  if (panYSlider) panYSlider.addEventListener("input", syncEditorTransform);

  // Phase 2: Role Editor Form & Color Sync
  const roleForm = document.getElementById("edit-role-form");
  if (roleForm) {
    const colorPicker = document.getElementById("role-color-picker");
    const colorHex = document.getElementById("role-color-hex");
    if (colorPicker && colorHex) {
      colorPicker.addEventListener("input", () => { colorHex.value = colorPicker.value; });
      colorHex.addEventListener("input", () => { colorPicker.value = colorHex.value; });
    }

    roleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const guildId = roleForm.getAttribute("data-guild-id");
      const roleId = roleForm.getAttribute("data-role-id");
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
      await store.createGuild({ name: fd.get("name"), iconColor: fd.get("iconColor") });
      showToast("Servidor criado e persistido no SQLite!");
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

  // Account security forms (e-mail change, password, phone, verification codes)
  // Phone field: format as you type — (11) 91234-5678, or free "+<country> ..." for other countries
  const phoneInput = document.getElementById("account-phone");
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      const prevDigits = phoneInput.dataset.digits || "";
      let digits = phoneInput.value.replace(/\D/g, "");
      // Backspace over "-", ")" or a space removes the digit before it instead of getting stuck
      if (e.inputType === "deleteContentBackward" && digits === prevDigits) digits = digits.slice(0, -1);
      const international = phoneInput.value.trim().startsWith("+");
      phoneInput.value = formatPhoneInput(digits, international);
      phoneInput.dataset.digits = digits;
    });
  }

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
      } else if (kind === "phone") {
        const ok = await runAccountAction(
          "phone",
          () => store.requestPhoneVerification(fd.get("phone"), fd.get("currentPassword")),
          (res) => `Código enviado por SMS para ${res.sentTo}.`
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
          email_change: () => store.confirmEmailChange(code),
          phone_verify: () => store.confirmPhoneVerification(code)
        }[purpose];
        const successMsg = {
          email_verify: "E-mail verificado!",
          email_change: "E-mail alterado e verificado!",
          phone_verify: "Telefone verificado e vinculado à sua conta!"
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
      const channel = store.getActiveChannel();
      if (e.key === "Escape") {
        uiState.editingMessageId = null;
        renderApp();
      } else if (e.key === "Enter" && channel) {
        await store.editMessage(channel.id, msgId, input.value);
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
  "delete-channel": (btn) => {
    const ch = store.getActiveGuild()?.channels.find((c) => c.id === btn.getAttribute("data-channel-id"));
    return {
      title: "Excluir canal",
      message: `Tem certeza que deseja excluir <strong>${ch?.type === "voice" ? "🔊 " : "#"}${escapeHtml(ch?.name || "canal")}</strong>? Todas as mensagens dele serão perdidas. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir Canal"
    };
  },
  "delete-message": (btn) => {
    const ch = store.getActiveChannel();
    const msg = (store.getState().messages[ch?.id] || []).find((m) => m.id === btn.getAttribute("data-message-id"));
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
  }),
  "remove-account-phone": () => ({
    title: "Remover número de telefone",
    message: "O número verificado será desvinculado da sua conta. Confirme com sua senha atual.",
    confirmLabel: "Remover Número",
    requirePassword: true
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
      const item = uiState.contextMenu.items[Number(ctxIdxBtn.getAttribute("data-context-idx"))];
      uiState.contextMenu = null;
      if (item && typeof item.onClick === "function") await item.onClick();
      renderApp();
      return;
    }
    uiState.contextMenu = null;
    renderApp();
  }

  const btn = e.target.closest("[data-action]");
  const clickedInsideFloating = Boolean(e.target.closest(".floating-popout"));

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
      const scope = purpose === "phone_verify" ? "phone" : "email";
      const reopen = purpose !== "email_verify";
      await runAccountAction(scope, () => store.cancelPendingVerification(purpose));
      uiState.accountDevCode = null;
      uiState.accountPanel = reopen ? scope : null;
      renderApp();
      break;
    }
    case "remove-account-phone":
      await runAccountAction("phone", () => store.removePhone(btn.getAttribute("data-password") || ""), "Número removido da sua conta.");
      break;
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
      store.selectHome("friends");
      break;
    case "home-nav":
      closeAllFloatingMenus();
      store.selectHome(btn.getAttribute("data-section"));
      break;
    case "open-dm":
      closeAllFloatingMenus();
      store.selectHome("dm", btn.getAttribute("data-dm-id"));
      break;
    case "select-guild":
      closeAllFloatingMenus();
      store.selectGuild(btn.getAttribute("data-guild-id"));
      break;
    case "select-channel":
      closeAllFloatingMenus();
      store.selectChannel(btn.getAttribute("data-channel-id"));
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
      await store.leaveVoiceChannel();
      showToast("Desconectado do canal de voz.");
      break;
    case "toggle-mute":
      store.toggleMute();
      break;
    case "toggle-deafen":
      store.toggleDeafen();
      break;
    case "toggle-video":
      state.voice.videoEnabled = !state.voice.videoEnabled;
      store.notify();
      break;
    case "toggle-screenshare":
      if (state.voice.screenShareEnabled) {
        await store.stopScreenShare();
        showToast("Compartilhamento de tela encerrado.");
      } else {
        await openScreenSharePickerModal();
      }
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
        fps: uiState.screenShareFps
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
    case "pick-gif-item":
      store.selectGif(btn.getAttribute("data-gif-url"));
      break;
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
      const pi = document.getElementById("media-editor-preview-img"); if (pi) pi.style.transform = "scale(1) translate(0px, 0px)";
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
    case "select-role-settings":
      store.selectRoleInSettings(btn.getAttribute("data-role-id"));
      break;
    case "create-new-role": {
      const gId = btn.getAttribute("data-guild-id");
      const res = await store.createRole(gId, { name: "Novo Cargo", color: "#99aab5" });
      if (res.ok && res.role) store.selectRoleInSettings(res.role.id);
      showToast("Novo cargo criado com sucesso!");
      break;
    }
    case "delete-role": {
      const gId = btn.getAttribute("data-guild-id");
      const rId = btn.getAttribute("data-role-id");
      const res = await store.deleteRole(gId, rId);
      if (res.ok) {
        showToast("Cargo excluído com sucesso!");
        store.selectRoleInSettings(null);
      } else {
        showToast(res.error || "Erro ao excluir cargo.");
      }
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
    case "open-user-popout": {
      e.stopPropagation();
      const targetUserId = btn.getAttribute("data-user-id");
      const isSame = uiState.userPopout && uiState.userPopout.userId === targetUserId;
      closeAllFloatingMenus("userPopout");
      uiState.userPopout = isSame ? null : { userId: targetUserId };
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
    case "set-density":
      await store.updateSetting("messageDisplay", btn.getAttribute("data-density"));
      break;
    case "toggle-krisp":
      state.voice.noiseSuppression = !state.voice.noiseSuppression;
      store.notify();
      break;
    case "toggle-setting": {
      const k = btn.getAttribute("data-key");
      await store.updateSetting(k, !state.settings[k]);
      break;
    }
    case "purge-memory-now":
      NativeBridge.purgeMemory();
      showToast("Memória RAM otimizada e caches limpos!");
      break;
    case "toggle-reaction": {
      const ch = store.getActiveChannel();
      if (ch) {
        await store.toggleReaction(ch.id, btn.getAttribute("data-message-id"), btn.getAttribute("data-emoji"));
      }
      break;
    }
    case "open-emoji-picker": {
      e.stopPropagation();
      const msgId = btn.getAttribute("data-message-id");
      const isSame = uiState.emojiPickerForMessageId === msgId;
      closeAllFloatingMenus("emojiPicker");
      uiState.emojiPickerForMessageId = isSame ? null : msgId;
      renderApp();
      break;
    }
    case "select-emoji": {
      const target = btn.getAttribute("data-target");
      const emoji = btn.getAttribute("data-emoji");
      uiState.emojiPickerForMessageId = null;
      if (target === "composer") {
        const inp = document.getElementById("composer-text-input");
        if (inp) {
          inp.value += emoji;
          inp.focus();
        }
      } else {
        const ch = store.getActiveChannel();
        if (ch) await store.toggleReaction(ch.id, target, emoji);
      }
      renderApp();
      break;
    }
    case "reply-message":
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
      break;
    case "cancel-edit":
      uiState.editingMessageId = null;
      renderApp();
      break;
    case "save-edit": {
      const msgId = btn.getAttribute("data-message-id");
      const inp = document.getElementById(`edit-message-input-${msgId}`);
      const ch = store.getActiveChannel();
      if (ch && inp) {
        await store.editMessage(channelIdOrFallback(ch), msgId, inp.value);
      }
      uiState.editingMessageId = null;
      renderApp();
      break;
    }
    case "pin-message": {
      const ch = store.getActiveChannel();
      if (ch) {
        const pinned = await store.togglePinMessage(ch.id, btn.getAttribute("data-message-id"));
        showToast(pinned ? "Mensagem fixada!" : "Mensagem desafixada.");
      }
      break;
    }
    case "delete-message": {
      const ch = store.getActiveChannel();
      if (ch) {
        await store.deleteMessage(ch.id, btn.getAttribute("data-message-id"));
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

function channelIdOrFallback(ch) {
  return ch ? ch.id : "c_general";
}

// Right-click Context Menu on Servers
document.addEventListener("contextmenu", (e) => {
  const guildWrap = e.target.closest("[data-guild-context]");
  if (guildWrap) {
    e.preventDefault();
    const gId = guildWrap.getAttribute("data-guild-context");
    const g = store.getState().guilds.find((item) => item.id === gId);
    if (!g) return;
    closeAllFloatingMenus("contextMenu");
    uiState.contextMenu = {
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 200),
      items: [
        {
          label: "Marcar como Lido",
          onClick: () => {
            g.unread = false;
            g.mentions = 0;
            g.channels.forEach((c) => {
              c.unread = false;
              c.mentions = 0;
            });
            store.notify();
          }
        },
        {
          label: "Convidar Pessoas",
          onClick: async () => {
            store.selectGuild(g.id);
            await openInviteModalForGuild(g.id);
          }
        },
        {
          label: "Criar Canal",
          onClick: () => {
            store.selectGuild(g.id);
            uiState.activeModal = "create-channel";
          }
        },
        {
          label: "Configurações do Servidor",
          onClick: () => {
            store.selectGuild(g.id);
            uiState.settingsOverlay = { type: "server", tab: "overview" };
          }
        },
        {
          label: "Copiar ID do Servidor",
          onClick: () => {
            NativeBridge.copyText(g.id);
            showToast("ID do Servidor copiado!");
          }
        }
      ]
    };
    renderApp();
  }
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
    if (store.getState().gifPicker.isOpen) {
      store.closeGifPicker();
      return;
    }
    if (uiState.switchAccountPrompt) {
      uiState.switchAccountPrompt = null;
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

NativeBridge.subscribeIpc("CHECK_FOR_UPDATES", () => {
  showToast("Discord v1.0.9262 está atualizado!");
});

window.__DISCORD_STORE__ = store;
window.__DISCORD_UI_STATE__ = uiState;

window.addEventListener("DOMContentLoaded", async () => {
  renderApp();
  await store.init();
});
