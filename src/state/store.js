// ==========================================================================
// Discord Application State & Real SQLite Backend Synchronization Store
// Zero illustrative/fictional users in production. All users, friendships,
// guilds, channels, messages, invites, and preferences are persisted in SQLite.
// ==========================================================================

import { NativeBridge, CallSounds, ScreenShare, VoiceDevices, VAD, Voice, Camera } from "../services/gatewayAdapter.js";
import { createDenoisedStream } from "../services/noiseSuppressor.js";

// "Supressão de ruído" is a choice of this PC (on unless turned off)
const NOISE_SUPPRESSION_KEY = "eco.noiseSuppression";
function readNoiseSuppressionPref() {
  try {
    return localStorage.getItem(NOISE_SUPPRESSION_KEY) !== "0";
  } catch (_) {
    return true;
  }
}

const TYPING_PING_MS = 3000;
const TYPING_SHOW_MS = 7000;

// Screen share picker options -> capture size (0 = the source's own size)
export const SCREEN_RESOLUTIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  source: { width: 0, height: 0 }
};

const LEGACY_STORAGE_KEY = "discord_desktop_replica_state_v1";
const SESSION_STORAGE_KEY = "discord_session_user_v2";
// Accounts that signed in on this device (shown on the login screen; password still required)
const SAVED_ACCOUNTS_KEY = "eco_saved_accounts_v1";
// GIPHY returns at most 50 GIFs per request and rejects search offsets above 4999.
const GIF_PAGE_SIZE = 50;
const GIF_MAX_OFFSET = 5000;
// TURN credentials from the server are short-lived; refresh them before reuse
const ICE_SERVERS_REFRESH_MS = 6 * 60 * 60 * 1000;
// Picker results kept per search/category so reopening or switching back is instant
const GIF_CACHE_TTL_MS = 10 * 60 * 1000;
// An unanswered DM call stops ringing and hangs up after this long
const DM_CALL_RING_TIMEOUT_MS = 30000;

export const AVAILABLE_THEMES = [
  {
    id: "dark",
    name: "Escuro Padrão (Ash)",
    description: "Tema escuro clássico do Discord Desktop",
    colors: ["#1e1f22", "#2b2d31", "#313338", "#5865f2"]
  },
  {
    id: "light",
    name: "Claro (Light)",
    description: "Superfícies claras de alto contraste diurno",
    colors: ["#e3e5e8", "#f2f3f5", "#ffffff", "#5865f2"]
  },
  {
    id: "midnight",
    name: "Meia-Noite (Midnight)",
    description: "Tons profundos de índigo noturno",
    colors: ["#0b0e17", "#121726", "#171d30", "#6366f1"]
  },
  {
    id: "oled",
    name: "OLED Preto Profundo",
    description: "Preto puro para telas AMOLED e economia de energia",
    colors: ["#000000", "#08090c", "#0d0e12", "#5865f2"]
  },
  {
    id: "ocean",
    name: "Azul Profundo (Ocean)",
    description: "Paleta oceânica azul-petróleo e ciano",
    colors: ["#071925", "#0c2638", "#103147", "#0ea5e9"]
  },
  {
    id: "nebula",
    name: "Roxo Nebula",
    description: "Atmosfera cósmica violeta e ametista",
    colors: ["#160d29", "#21143b", "#291a47", "#a855f7"]
  },
  {
    id: "emerald",
    name: "Verde Esmeralda",
    description: "Tons florestais escuros com destaque esmeralda",
    colors: ["#091e16", "#102c22", "#15382b", "#10b981"]
  },
  {
    id: "rose",
    name: "Rosa Carmesim",
    description: "Superfícies vinho profundo com acento carmesim",
    colors: ["#240c16", "#331321", "#3f1829", "#f43f5e"]
  },
  {
    id: "graphite",
    name: "Cinza Grafite",
    description: "Neutro equilibrado em aço escovado e ardósia",
    colors: ["#18181b", "#232329", "#2b2b33", "#64748b"]
  },
  {
    id: "sunset",
    name: "Âmbar Sunset",
    description: "Tons quentes de terracota e pôr do sol",
    colors: ["#23120b", "#331b11", "#402216", "#f97316"]
  }
];

function createEmptyState() {
  return {
    initialized: false,
    auth: {
      isAuthenticated: false,
      mode: "login", // "login" | "register" | "forgot"
      currentUserId: "u_davis",
      accounts: [],
      emailGate: null // { sentTo, devCode } while the account must confirm its e-mail
    },
    navigation: {
      view: "guild", // "home" | "guild" | "discovery"
      homeSection: "friends", // "friends" | "dm"
      friendsTab: "online", // "online" | "all" | "pending" | "blocked" | "add"
      activeDmId: null,
      activeGuildId: "g_rea",
      activeChannelId: "c_general",
      activeThreadMessageId: null,
      callViewChannelId: null, // voice channel whose call panel fills the main stage
      showMemberList: true,
      searchQuery: "",
      friendsSearchQuery: "",
      discoveryCategory: "All",
      discoverySearch: ""
    },
    voice: {
      connectedGuildId: null,
      connectedChannelId: null,
      sessionId: null,
      muted: false,
      deafened: false,
      isSpeaking: false,
      speakingUsers: {}, // userId -> boolean
      videoEnabled: false,
      screenShareEnabled: false,
      screenShareSourceId: null,
      screenShareSourceName: null,
      dmCall: null, // { channelId, peerId, status: "ringing" | "connected" } while in a DM call
      pingMs: 16,
      noiseSuppression: readNoiseSuppressionPref(),
      inputVolume: 100,
      outputVolume: 100
    },
    incomingCall: null, // { channelId, callerId } while another user is ringing us
    screenShares: {}, // "channelId:userId" -> { userId, guildId, channelId, sourceName, resolution, fps }
    typing: {}, // channelId -> { userId: visibleUntil }
    settings: {
      theme: "dark",
      messageDisplay: "cozy",
      fontScale: 1,
      developerMode: true,
      minimizeToTray: true,
      openOnStartup: false,
      hardwareAcceleration: true,
      enableNotifications: true,
      language: "pt-BR",
      joinSoundEnabled: true,
      leaveSoundEnabled: true,
      muteSoundEnabled: true,
      unmuteSoundEnabled: true,
      joinSoundPreset: "discord-default",
      leaveSoundPreset: "discord-default",
      muteSoundPreset: "discord-default",
      unmuteSoundPreset: "discord-default",
      joinSoundCustomUrl: "",
      leaveSoundCustomUrl: "",
      muteSoundCustomUrl: "",
      unmuteSoundCustomUrl: "",
      joinSoundCustomName: "",
      leaveSoundCustomName: "",
      muteSoundCustomName: "",
      unmuteSoundCustomName: "",
      callSoundVolume: 80,
      voiceInputDeviceId: "default",
      voiceOutputDeviceId: "default",
      voiceInputVolume: 100,
      voiceOutputVolume: 100
    },
    gifPicker: {
      isOpen: false,
      target: "avatar", // "avatar" | "banner"
      category: "All",
      query: "",
      results: [],
      loading: false,
      loadingMore: false,
      hasMore: false,
      total: 0,
      offset: 0,
      searchId: 0 // bumps whenever results are replaced (not appended)
    },
    mediaEditor: {
      isOpen: false,
      target: "avatar", // "avatar" | "banner"
      mediaUrl: "",
      scale: 1.0,
      cropX: 0,
      cropY: 0,
      bannerPositionY: 50
    },
    serverSettings: {
      isOpen: false,
      guildId: null,
      activeTab: "overview", // "overview" | "roles" | "channels" | "invites" | "audit_log"
      selectedRoleId: null,
      roleDraft: null
    },
    users: {},
    userNotes: {},
    friends: [],
    dms: [],
    guilds: [],
    discoverableGuilds: [],
    appConfig: { appName: "Huddle", publicUrl: "" },
    messages: {}
  };
}

class Store {
  constructor() {
    this.gifRequestSeq = 0;
    // Preference changes not yet confirmed by the backend (see syncFromBackend)
    this.unsavedSettings = {};
    this.settingsWriteSeq = 0;
    // The GIF picker renders outside the main app tree and has its own listeners,
    // so its updates never trigger a full app re-render
    this.gifListeners = new Set();
    this.gifCache = new Map(); // "query|category" -> { results, total, offset, hasMore, at }
    // Purge legacy illustrative localStorage state to free memory and remove fictional data
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}

    this.state = createEmptyState();
    this.listeners = new Set();
    this.unsubscribeEvents = null;

    // Saved login lives in the device auth store (a file in Electron). Older
    // versions kept it in localStorage, which is migrated once.
    let savedSession = null;
    try {
      savedSession = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
    } catch {}
    this.authData = NativeBridge.readAuthStore();
    if (!this.authData) {
      let legacyAccounts = [];
      try {
        legacyAccounts = JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || "[]");
      } catch {}
      this.authData = {
        session: savedSession?.sessionToken
          ? {
              currentUserId: savedSession.currentUserId,
              isAuthenticated: savedSession.isAuthenticated === true,
              sessionToken: savedSession.sessionToken
            }
          : null,
        accounts: Array.isArray(legacyAccounts) ? legacyAccounts : []
      };
      NativeBridge.writeAuthStore(this.authData);
    }
    this.lastSavedSessionJson = JSON.stringify(this.authData.session || null);

    try {
      const session = this.authData.session;
      if (session?.currentUserId) this.state.auth.currentUserId = session.currentUserId;
      // Without a session token the user has to sign in again
      if (session?.sessionToken) {
        NativeBridge.setSessionToken(session.sessionToken);
        this.state.auth.isAuthenticated = session.isAuthenticated === true;
      } else {
        this.state.auth.isAuthenticated = false;
      }
      if (savedSession) {
        if (savedSession.navigation) {
          this.state.navigation = {
            ...this.state.navigation,
            ...savedSession.navigation
          };
        }
      }
    } catch {}
  }

  async init() {
    NativeBridge.onUnauthenticated = () => this.handleSessionExpired();
    NativeBridge.onEmailNotVerified = () => this.showEmailGate();
    if (this.state.auth.isAuthenticated) {
      // Only an explicit UNAUTHENTICATED answer (handled by onUnauthenticated) ends
      // the saved session; a slow or failed first request is just retried
      let ok = false;
      for (let attempt = 0; attempt < 5 && !ok && this.state.auth.isAuthenticated; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
        ok = await this.syncFromBackend();
      }
      if (ok) setTimeout(() => this.prefetchGifs(), 1500);
    }
    this.connectRealtimeEvents();
    this.state.initialized = true;
    this.notify();
    return this.state;
  }

  connectRealtimeEvents() {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
    }
    this.unsubscribeEvents = NativeBridge.connectEventStream((packet) => {
      if (!packet || !packet.event) return;
      const { event, payload } = packet;

      if (event === "SCREEN_SHARE_FRAME") return; // older clients; video now goes over WebRTC

      // Someone opened/closed the app: only their dot changes
      if (event === "PRESENCE_UPDATED" && payload?.userId) {
        const u = this.state.users[payload.userId];
        if (u && payload.userId !== this.state.auth.currentUserId && u.status !== payload.status) {
          u.status = payload.status;
          this.notify({ skipPersist: true });
        }
        return;
      }

      if (event === "TYPING_STARTED" && payload?.channelId && payload.userId) {
        this.setTyping(payload.channelId, payload.userId, true);
        return;
      }

      if (event === "SCREEN_SHARE_STARTED" && payload?.channelId) {
        this.state.screenShares[`${payload.channelId}:${payload.userId || payload.sharerId}`] = payload;
        this.notify({ skipPersist: true });
        return;
      }

      if (event === "SCREEN_SHARE_STOPPED" && payload?.channelId) {
        for (const [key, share] of Object.entries(this.state.screenShares)) {
          if (share.channelId === payload.channelId && (!payload.sharerId || share.userId === payload.sharerId)) delete this.state.screenShares[key];
        }
        this.notify({ skipPersist: true });
        return;
      }

      if (event === "VOICE_SPEAKING_CHANGED" && payload?.userId) {
        // People we hear directly are detected on this PC (Voice.onRemoteSpeaking)
        if (payload.userId === this.state.auth.currentUserId || Voice.hasAudioFrom(payload.userId)) return;
        this.setUserSpeaking(payload.userId, Boolean(payload.speaking));
        return;
      }

      // WebRTC setup messages for our call; never worth a full state reload
      if (event === "RTC_SIGNAL") {
        if (payload?.channelId === this.state.voice.connectedChannelId) Voice.handleSignal(payload);
        return;
      }

      if (event === "RTC_ROOM_UPDATED" && payload?.channelId === this.state.voice.connectedChannelId) {
        Voice.syncParticipants((payload.participants || []).map((p) => p.userId));
        this.applyModeration(payload.participants || []);
      }

      // A moderator disconnected or moved me
      if (event === "VOICE_FORCED") {
        if (payload?.userId === this.state.auth.currentUserId) this.handleForcedVoice(payload);
        return;
      }

      if (event === "RTC_ROOM_UPDATED" && payload?.channelId) {
        this.handleVoiceRoomPresence(payload.channelId, payload.participants || []);
        this.handleDmCallRoomUpdate(payload.channelId, payload.participants || []);
      }

      if (event === "MESSAGE_CREATED" && payload?.channelId) {
        if (payload.authorId) this.setTyping(payload.channelId, payload.authorId, false);
        this.requestSync().then(() => this.notifyIncomingMessage(payload.channelId, payload.messageId));
        return;
      }

      // For structural state changes (messages, friendships, username/profile updates, guilds, voice)
      this.requestSync();
    });
  }

  // Server events arrive in bursts (someone joins a call: room update, presence,
  // sounds...). Each used to download the whole state and redraw the app; now
  // a burst becomes one download: at most one in flight, and whatever arrives
  // meanwhile is folded into a single follow-up shortly after.
  requestSync() {
    if (this.syncInFlight) {
      this.syncAgain = true;
      return this.syncInFlight;
    }
    this.syncInFlight = (async () => {
      try {
        do {
          this.syncAgain = false;
          await this.syncFromBackend({ silent: false });
          if (this.syncAgain) await new Promise((r) => setTimeout(r, 150));
        } while (this.syncAgain);
      } finally {
        this.syncInFlight = null;
      }
    })();
    return this.syncInFlight;
  }

  async syncFromBackend({ silent = false } = {}) {
    if (!NativeBridge.sessionToken) return false;
    const res = await NativeBridge.rpc("getStateSnapshot", {});
    if (!res || !res.ok || !res.snapshot) {
      return false;
    }
    const snap = res.snapshot;
    this.state.auth.currentUserId = snap.currentUserId;
    this.state.users = snap.users || {};
    this.state.userNotes = snap.userNotes || {};
    this.state.friends = snap.friends || [];
    this.state.liveActivities = snap.liveActivities || {};
    this.state.permissionCatalog = snap.permissionCatalog || [];
    queueMicrotask(() => this.applyCallPermissions());
    this.state.dms = snap.dms || [];
    this.state.guilds = snap.guilds || [];
    this.applyUnread();
    this.state.discoverableGuilds = snap.discoverableGuilds || [];
    if (snap.appConfig) this.state.appConfig = snap.appConfig;
    this.state.messages = snap.messages || {};
    this.state.settings = {
      ...this.state.settings,
      ...(snap.settings || {}),
      // A snapshot may predate preference changes still being saved: keep them
      ...this.unsavedSettings
    };

    // Active screen shares, one per person
    const nextShares = {};
    for (const s of snap.activeScreenShares || []) {
      const shareKey = `${s.channelId}:${s.userId}`;
      nextShares[shareKey] = {
        ...s,
        frameDataUrl: this.state.screenShares[shareKey]?.frameDataUrl || s.frameDataUrl || null
      };
    }
    this.state.screenShares = nextShares;

    // Validate active navigation pointers
    if (this.state.guilds.length > 0) {
      const activeGuild =
        this.state.guilds.find((g) => g.id === this.state.navigation.activeGuildId) ||
        this.state.guilds[0];
      this.state.navigation.activeGuildId = activeGuild.id;
      const hasChannel = activeGuild.channels.some((c) => c.id === this.state.navigation.activeChannelId);
      if (!hasChannel) {
        const firstText = activeGuild.channels.find((c) => c.type !== "voice") || activeGuild.channels[0];
        this.state.navigation.activeChannelId = firstText ? firstText.id : null;
      }
    }

    if (this.state.dms.length > 0 && !this.state.dms.some((d) => d.id === this.state.navigation.activeDmId)) {
      this.state.navigation.activeDmId = this.state.dms[0].id;
    } else if (this.state.dms.length === 0) {
      this.state.navigation.activeDmId = null;
      if (this.state.navigation.view === "home" && this.state.navigation.homeSection === "dm") {
        this.state.navigation.homeSection = "friends";
      }
    }

    if (!silent) {
      this.notify();
    }
    return true;
  }

  getState() {
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Writes the saved login to the device auth store, only when it changed
  saveAuthSession() {
    const session = NativeBridge.sessionToken
      ? {
          currentUserId: this.state.auth.currentUserId,
          isAuthenticated: this.state.auth.isAuthenticated,
          sessionToken: NativeBridge.sessionToken
        }
      : null;
    const json = JSON.stringify(session);
    if (json === this.lastSavedSessionJson) return;
    this.lastSavedSessionJson = json;
    this.authData.session = session;
    NativeBridge.writeAuthStore(this.authData);
  }

  persist() {
    this.saveAuthSession();
    try {
      // Store only lightweight session pointers in localStorage to minimize RAM
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          currentUserId: this.state.auth.currentUserId,
          navigation: {
            view: this.state.navigation.view,
            homeSection: this.state.navigation.homeSection,
            friendsTab: this.state.navigation.friendsTab,
            activeDmId: this.state.navigation.activeDmId,
            activeGuildId: this.state.navigation.activeGuildId,
            activeChannelId: this.state.navigation.activeChannelId,
            showMemberList: this.state.navigation.showMemberList
          }
        })
      );
    } catch {}
  }

  notify(options = {}) {
    if (!options.skipPersist) {
      this.persist();
    }
    for (const fn of this.listeners) {
      fn(this.state);
    }
  }

  async resetToDefault() {
    await this.syncFromBackend();
  }

  // Helper getters
  getCurrentUser() {
    return (
      this.state.users[this.state.auth.currentUserId] ||
      Object.values(this.state.users)[0] || {
        id: "u_davis",
        username: "davis_dev",
        displayName: "Davis",
        email: "davis@discord.local",
        avatarColor: "#5865f2",
        avatarUrl: "",
        bannerColor: "#5865f2",
        bannerUrl: "",
        bannerPositionY: 50,
        status: "online",
        customStatus: "",
        aboutMe: "",
        pronouns: "",
        memberSince: "14 Oct 2021",
        badges: ["Active Developer"],
        roles: ["r_admin"],
        isBot: false
      }
    );
  }

  getActiveGuild() {
    return (
      this.state.guilds.find((g) => g.id === this.state.navigation.activeGuildId) ||
      this.state.guilds[0] ||
      null
    );
  }

  getActiveChannel() {
    if (this.state.navigation.view === "home" && this.state.navigation.homeSection === "dm") {
      const dm = this.state.dms.find((d) => d.id === this.state.navigation.activeDmId) || this.state.dms[0];
      if (!dm) return null;
      const other = this.state.users[dm.userId];
      return {
        id: dm.id,
        name: other ? other.displayName : "Mensagem Direta",
        type: "dm",
        userId: dm.userId,
        topic: other ? `@${other.username}${other.aboutMe ? " — " + other.aboutMe : ""}` : ""
      };
    }
    const guild = this.getActiveGuild();
    if (!guild || !Array.isArray(guild.channels)) return null;
    return (
      guild.channels.find((c) => c.id === this.state.navigation.activeChannelId) ||
      guild.channels.find((c) => c.type !== "voice") ||
      guild.channels[0] ||
      null
    );
  }

  // ==========================================================================
  // Authentication & Real Multi-Account Support
  // ==========================================================================
  getSavedAccounts() {
    return Array.isArray(this.authData?.accounts) ? this.authData.accounts : [];
  }

  setSavedAccounts(list) {
    this.authData.accounts = list;
    NativeBridge.writeAuthStore(this.authData);
  }

  // Each account that signed in on this device keeps its own session token, so
  // switching back to it does not ask for the password again (like Discord)
  rememberAccount(user, sessionToken) {
    const previous = this.getSavedAccounts().find((a) => a.id === user.id);
    const entry = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl || "",
      sessionToken: sessionToken !== undefined ? sessionToken : previous?.sessionToken || null
    };
    this.setSavedAccounts([entry, ...this.getSavedAccounts().filter((a) => a.id !== user.id)].slice(0, 8));
  }

  // Removes an account from "Contas neste dispositivo" (e.g. it was deleted)
  forgetAccount(userId) {
    this.setSavedAccounts(this.getSavedAccounts().filter((a) => a.id !== userId));
  }

  forgetAccountSession(userId) {
    this.setSavedAccounts(this.getSavedAccounts().map((a) => (a.id === userId ? { ...a, sessionToken: null } : a)));
  }

  hasSavedSession(userId) {
    return Boolean(this.getSavedAccounts().find((a) => a.id === userId)?.sessionToken);
  }

  // Shared tail of login/register/switch: adopt the new session and load its data
  async startSession(res) {
    NativeBridge.setSessionToken(res.sessionToken);
    this.state.auth.isAuthenticated = true;
    this.state.auth.currentUserId = res.user.id;
    this.rememberAccount(res.user, res.sessionToken);
    setTimeout(() => this.prefetchGifs(), 1500);
    if (res.emailVerificationRequired) {
      this.state.auth.emailGate = {
        sentTo: res.verification?.sentTo || "",
        devCode: res.verification?.devCode || null,
        error: res.verification?.ok === false ? res.verification.error : null
      };
      this.notify();
      return { ok: true, user: res.user, emailVerificationRequired: true };
    }
    this.state.auth.emailGate = null;
    await this.syncFromBackend();
    this.connectRealtimeEvents();
    return { ok: true, user: res.user };
  }

  async login(emailOrUsername, password) {
    const res = await NativeBridge.rpc("login", { emailOrUsername, password });
    if (!res.ok) return res;
    return this.startSession(res);
  }

  async register({ email, displayName, username, password }) {
    const res = await NativeBridge.rpc("register", { email, displayName, username, password });
    if (!res.ok) return res;
    return this.startSession(res);
  }

  // ==========================================================================
  // E-mail verification gate (app.config.json → requireVerifiedEmail)
  // ==========================================================================
  async showEmailGate() {
    if (this.state.auth.emailGate) return;
    this.state.auth.emailGate = { sentTo: "", devCode: null, error: null };
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    this.notify();
    const res = await NativeBridge.rpc("getAccountSecurity", {});
    if (res?.ok && this.state.auth.emailGate) {
      const pending = res.security.pendingEmailVerify;
      this.state.auth.emailGate.sentTo = pending ? pending.masked : "";
      this.notify();
    }
  }

  async confirmEmailGate(code) {
    const res = await NativeBridge.rpc("confirmEmailVerification", { code });
    if (!res?.ok) return res || { ok: false, error: "Sem resposta do servidor." };
    this.state.auth.emailGate = null;
    await this.syncFromBackend();
    this.connectRealtimeEvents();
    this.notify();
    return { ok: true };
  }

  async resendEmailGateCode() {
    const res = await NativeBridge.rpc("requestEmailVerification", {});
    if (res?.ok && this.state.auth.emailGate) {
      this.state.auth.emailGate.sentTo = res.sentTo;
      this.state.auth.emailGate.devCode = res.devCode || null;
      this.notify();
    }
    return res || { ok: false, error: "Sem resposta do servidor." };
  }

  // The backend rejected our token (expired, revoked or password changed elsewhere)
  handleSessionExpired() {
    if (!this.state.auth.isAuthenticated && !NativeBridge.sessionToken) return;
    this.forgetAccountSession(this.state.auth.currentUserId);
    NativeBridge.setSessionToken(null);
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    this.state.auth.isAuthenticated = false;
    this.state.auth.emailGate = null;
    this.state.auth.mode = "login";
    this.notify();
  }

  // Without a password, uses the account's saved session; returns
  // { needsPassword: true } when there is none (or it expired/was revoked).
  // The account being left keeps its session so you can switch back.
  async switchAccount(userId, password) {
    const saved = this.getSavedAccounts().find((a) => a.id === userId);
    const target = saved || this.state.users[userId];
    if (!target) return { ok: false, error: "Usuário não encontrado." };

    let auth;
    if (!password) {
      if (!saved?.sessionToken) return { ok: false, needsPassword: true };
      const probe = await NativeBridge.rpcAs(saved.sessionToken, "getAccountSecurity", {});
      if (probe?.code === "UNAUTHENTICATED") {
        this.forgetAccountSession(userId);
        return { ok: false, needsPassword: true };
      }
      auth = { sessionToken: saved.sessionToken, user: { ...saved } };
    } else {
      auth = await NativeBridge.rpc("login", { emailOrUsername: target.username, password });
      if (!auth.ok && auth.code === "ACCOUNT_NOT_FOUND") {
        this.forgetAccount(userId);
        return { ok: false, accountRemoved: true, error: "Esta conta não existe mais e foi removida da lista." };
      }
      if (!auth.ok) return { ok: false, error: auth.error || "Senha incorreta." };
      if (auth.user?.id !== userId) return { ok: false, error: "Não foi possível confirmar esta conta." };
    }

    if (this.state.auth.isAuthenticated && this.state.voice.connectedChannelId) {
      await this.leaveVoiceChannel();
    }
    this.state.auth.emailGate = null;
    return this.startSession(auth);
  }

  async logout() {
    if (this.state.voice.connectedChannelId) {
      await this.leaveVoiceChannel();
    }
    // Signing out ends this account's session here; next time it asks for the password
    this.forgetAccountSession(this.state.auth.currentUserId);
    await NativeBridge.rpc("logout", {});
    NativeBridge.setSessionToken(null);
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    this.state.auth.isAuthenticated = false;
    this.state.auth.emailGate = null;
    this.state.auth.mode = "login";
    this.notify();
  }

  // ==========================================================================
  // Phase 3: @username Validation, Live Availability & Persistence
  // ==========================================================================
  async checkUsernameAvailability(username) {
    const me = this.getCurrentUser();
    return await NativeBridge.rpc("checkUsernameAvailability", {
      userId: me.id,
      username
    });
  }

  async updateUsername(newUsername) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("updateUsername", {
      userId: me.id,
      newUsername,
      expectedCurrentUsername: me.username
    });
    if (res.ok && res.user) {
      this.state.users[me.id] = {
        ...this.state.users[me.id],
        ...res.user
      };
      this.notify();
    }
    return res;
  }

  // ==========================================================================
  // Account security: e-mail and password (codes delivered by the backend)
  // ==========================================================================
  async accountRpc(action, params = {}) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc(action, { userId: me.id, ...params });
    if (res && res.ok && res.user) {
      this.state.users[me.id] = { ...this.state.users[me.id], ...res.user };
      this.notify();
    }
    return res || { ok: false, error: "Sem resposta do servidor." };
  }

  getAccountSecurity() {
    return this.accountRpc("getAccountSecurity");
  }

  requestEmailVerification() {
    return this.accountRpc("requestEmailVerification");
  }

  confirmEmailVerification(code) {
    return this.accountRpc("confirmEmailVerification", { code });
  }

  requestEmailChange(newEmail, currentPassword) {
    return this.accountRpc("requestEmailChange", { newEmail, currentPassword });
  }

  confirmEmailChange(code) {
    return this.accountRpc("confirmEmailChange", { code });
  }

  changePassword(currentPassword, newPassword) {
    return this.accountRpc("changePassword", { currentPassword, newPassword });
  }

  cancelPendingVerification(purpose) {
    return this.accountRpc("cancelPendingVerification", { purpose });
  }

  // ==========================================================================
  // Phase 5: Profile Photo, Banner Color & Banner Image/GIF Upload
  // ==========================================================================
  async uploadMedia({ fileName, mimeType, base64Data, kind }) {
    const me = this.getCurrentUser();
    return await NativeBridge.rpc("uploadMedia", {
      userId: me.id,
      fileName,
      mimeType,
      base64Data,
      kind
    });
  }

  async updateMyProfile(payload) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("updateProfile", {
      userId: me.id,
      ...payload
    });
    if (res.ok && res.user) {
      this.state.users[me.id] = {
        ...this.state.users[me.id],
        ...res.user
      };
      this.notify();
    }
    return res;
  }

  // ==========================================================================
  // Game activity (detected by the desktop app, shown in the profile)
  // ==========================================================================
  async reportGameActivity(activity) {
    if (!this.state.auth.isAuthenticated || !NativeBridge.sessionToken || !activity?.gameId) return;
    if (!this.currentGames) this.currentGames = new Map();
    const wasPlaying = this.currentGames.has(activity.gameId);
    if (activity.state === "started") this.currentGames.set(activity.gameId, activity.name);
    else this.currentGames.delete(activity.gameId);
    await NativeBridge.rpc("reportActivity", activity);
    // Only a change (not the periodic heartbeat) needs the UI to refresh
    if (wasPlaying !== (activity.state === "started")) this.notify({ skipPersist: true });
  }

  // ==========================================================================
  // Typing indicator
  // ==========================================================================
  // Typing sends a ping at most every TYPING_PING_MS; others show the name for
  // TYPING_SHOW_MS after the last ping (or until the message arrives)
  notifyTyping(channelId) {
    if (!channelId || !NativeBridge.sessionToken) return;
    const now = Date.now();
    this.lastTypingPing = this.lastTypingPing || {};
    if (now - (this.lastTypingPing[channelId] || 0) < TYPING_PING_MS) return;
    this.lastTypingPing[channelId] = now;
    NativeBridge.rpc("typing", { channelId });
  }

  setTyping(channelId, userId, typing) {
    if (userId === this.state.auth.currentUserId) return;
    const forChannel = (this.state.typing[channelId] = this.state.typing[channelId] || {});
    const had = Boolean(forChannel[userId]);
    if (typing) forChannel[userId] = Date.now() + TYPING_SHOW_MS;
    else delete forChannel[userId];
    if (typing) this.lastTypingPing = { ...(this.lastTypingPing || {}), [channelId]: 0 };
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.expireTyping(), TYPING_SHOW_MS + 100);
    if (had !== typing) this.notify({ skipPersist: true });
  }

  expireTyping() {
    const now = Date.now();
    let changed = false;
    for (const users of Object.values(this.state.typing)) {
      for (const [id, until] of Object.entries(users)) {
        if (until <= now) {
          delete users[id];
          changed = true;
        }
      }
    }
    if (changed) this.notify({ skipPersist: true });
  }

  getTypingUsers(channelId) {
    const now = Date.now();
    return Object.entries(this.state.typing[channelId] || {})
      .filter(([, until]) => until > now)
      .map(([id]) => this.state.users[id])
      .filter(Boolean);
  }

  // Song playing on Spotify on this PC (detected by the desktop app)
  async reportListening(activity) {
    if (!this.state.auth.isAuthenticated || !NativeBridge.sessionToken || activity?.kind !== "spotify") return;
    await NativeBridge.rpc("reportListening", activity);
  }

  getLiveActivity(userId) {
    return this.state.liveActivities?.[userId] || null;
  }

  getUserActivities(userId) {
    return NativeBridge.rpc("getUserActivities", { targetUserId: userId });
  }

  async updateMyStatus(status, customStatus) {
    return await this.updateMyProfile({ status, customStatus });
  }

  async saveUserNote(targetUserId, note) {
    const me = this.getCurrentUser();
    this.state.userNotes[targetUserId] = note;
    await NativeBridge.rpc("saveUserNote", {
      ownerId: me.id,
      targetId: targetUserId,
      note
    });
    this.notify();
  }

  // ==========================================================================
  // Phase 6 & 8: Preferences, 10 Themes & Custom Call Join/Leave Sounds
  // ==========================================================================
  async updateSetting(key, value) {
    return await this.updateSettings({ [key]: value });
  }

  async updateSettings(partial) {
    const me = this.getCurrentUser();
    this.state.settings = {
      ...this.state.settings,
      ...partial
    };
    if (partial.voiceOutputDeviceId !== undefined) Voice.setOutputDevice(partial.voiceOutputDeviceId);
    // New microphone mid-call: reopen it and swap it into the call
    if (partial.voiceInputDeviceId !== undefined && this.state.voice.connectedChannelId) {
      this.restartMicrophone();
    }
    if (partial.voiceOutputVolume !== undefined) Voice.setOutputVolume(partial.voiceOutputVolume);
    if (partial.minimizeToTray !== undefined) {
      NativeBridge.setSetting("MINIMIZE_TO_TRAY", Boolean(partial.minimizeToTray));
    }
    if (partial.hardwareAcceleration !== undefined) {
      NativeBridge.setSetting("enableHardwareAcceleration", Boolean(partial.hardwareAcceleration));
    }
    const writeId = ++this.settingsWriteSeq;
    Object.assign(this.unsavedSettings, partial);
    this.notify();
    await NativeBridge.rpc("updatePreferences", {
      userId: me.id,
      preferences: partial
    });
    // Saved; later writes keep their own keys pending
    if (writeId === this.settingsWriteSeq) this.unsavedSettings = {};
    return { ok: true, settings: this.state.settings };
  }

  async previewCallSound(type) {
    return await CallSounds.play(type, this.state.settings, null, { force: true });
  }

  // ==========================================================================
  // Navigation Actions
  // ==========================================================================
  selectHome(section = "friends", dmId = null) {
    this.state.navigation.view = "home";
    this.state.navigation.homeSection = section;
    this.state.navigation.activeThreadMessageId = null;
    if (dmId) {
      this.state.navigation.activeDmId = dmId;
      this.clearUnread(dmId);
    }
    this.notify();
  }

  selectGuild(guildId, channelId = null) {
    const guild = this.state.guilds.find((g) => g.id === guildId);
    if (!guild) return;
    this.state.navigation.view = "guild";
    this.state.navigation.activeGuildId = guildId;
    this.state.navigation.activeThreadMessageId = null;
    guild.unread = false;
    guild.mentions = 0;

    // Voice channels are never opened as a chat (an invite may point to one)
    const targetChannel =
      (channelId && guild.channels.find((c) => c.id === channelId && c.type !== "voice")) ||
      guild.channels.find((c) => c.id === this.state.navigation.activeChannelId && c.type !== "voice") ||
      guild.channels.find((c) => c.type !== "voice") ||
      guild.channels[0];

    if (targetChannel) {
      this.state.navigation.activeChannelId = targetChannel.id;
      this.clearUnread(targetChannel.id);
    }
    this.notify();
  }

  selectChannel(channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return;
    const ch = guild.channels.find((c) => c.id === channelId);
    if (!ch) return;
    if (ch.type === "voice") {
      // Clicking the call you are already in opens its panel
      if (this.state.voice.connectedChannelId === ch.id) {
        this.openCallView(ch.id);
        return;
      }
      this.joinVoiceChannel(guild.id, ch.id);
      return;
    }
    this.state.navigation.callViewChannelId = null;
    this.state.navigation.activeChannelId = ch.id;
    this.state.navigation.activeThreadMessageId = null;
    this.clearUnread(ch.id);
    this.notify();
  }

  openCallView(channelId) {
    this.state.navigation.view = "guild";
    this.state.navigation.callViewChannelId = channelId;
    this.clearUnread(channelId);
    this.state.navigation.activeThreadMessageId = null;
    this.notify();
  }

  closeCallView() {
    this.state.navigation.callViewChannelId = null;
    this.notify();
  }

  selectDiscovery() {
    this.state.navigation.view = "discovery";
    this.state.navigation.activeThreadMessageId = null;
    this.notify();
  }

  // ==========================================================================
  // Phase 6 & 9: Voice RTC & Real Screen Sharing Actions
  // ==========================================================================
  async joinVoiceChannel(guildId, channelId) {
    const targetGuild = this.state.guilds.find((g) => g.id === guildId);
    if (targetGuild && !this.can("CONNECT_VOICE", targetGuild)) {
      this.onPermissionNotice?.("Você não tem permissão para entrar neste canal de voz.");
      return { ok: false, error: "Sem permissão para conectar." };
    }
    if (this.state.voice.dmCall) {
      await this.leaveVoiceChannel();
    }
    const meId = this.state.auth.currentUserId;
    // Prevent duplicate join if already connected to the exact same channel
    if (
      this.state.voice.connectedGuildId === guildId &&
      this.state.voice.connectedChannelId === channelId
    ) {
      return { ok: true, alreadyConnected: true };
    }

    // If switching from another voice channel, stop any active screen share first
    if (this.state.voice.screenShareEnabled) {
      await this.stopScreenShare();
    }

    for (const g of this.state.guilds) {
      for (const c of g.channels) {
        if (c.type === "voice" && Array.isArray(c.connectedUsers)) {
          c.connectedUsers = c.connectedUsers.filter((u) => u !== meId);
        }
      }
    }

    const guild = this.state.guilds.find((g) => g.id === guildId);
    const ch = guild?.channels.find((c) => c.id === channelId);
    const sessionKey = `${meId}:${guildId}:${channelId}:${Date.now()}`;

    if (ch && ch.type === "voice") {
      if (!Array.isArray(ch.connectedUsers)) ch.connectedUsers = [];
      if (!ch.connectedUsers.includes(meId)) ch.connectedUsers.push(meId);
      this.state.voice.connectedGuildId = guildId;
      this.state.voice.connectedChannelId = channelId;
      this.state.voice.sessionId = sessionKey;
      this.state.voice.pingMs = Math.floor(14 + Math.random() * 10);
    }
    this.notify();

    // Play Join Sound once per transition
    await CallSounds.play("join", this.state.settings, sessionKey);
    const joined = await NativeBridge.rpc("joinVoiceChannel", { userId: meId, guildId, channelId });
    await this.startVoiceMesh(channelId, joined?.participants);
    this.startLocalVoiceActivity();
    return { ok: true };
  }

  restartMicrophone() {
    this.stopLocalMicrophone();
    this.startLocalVoiceActivity();
  }

  // Closes the microphone and its noise filter
  stopLocalMicrophone() {
    VAD.stop();
    if (this.localMicFilter) {
      this.localMicFilter.dispose();
      this.localMicFilter = null;
    }
    if (this.localAudioStream) {
      for (const t of this.localAudioStream.getTracks()) {
        try {
          t.stop();
        } catch (_) {}
      }
      this.localAudioStream = null;
    }
  }

  // "Supressão de ruído": filters our microphone and what we hear from others
  setNoiseSuppression(on) {
    this.state.voice.noiseSuppression = Boolean(on);
    try {
      localStorage.setItem(NOISE_SUPPRESSION_KEY, on ? "1" : "0");
    } catch (_) {}
    Voice.setNoiseSuppression(this.state.voice.noiseSuppression);
    if (this.state.voice.connectedChannelId) this.restartMicrophone();
    this.notify();
  }

  // Audio between the people in the call (WebRTC); STUN/TURN come from the server
  async startVoiceMesh(channelId, participants = []) {
    if (!this.iceServersCache || Date.now() - this.iceServersCache.at > ICE_SERVERS_REFRESH_MS) {
      const res = await NativeBridge.rpc("getIceServers", {});
      this.iceServersCache = { at: Date.now(), servers: res?.iceServers || [] };
    }
    // A screen or camera video started arriving: show it
    Voice.onRemoteMedia = () => this.notify({ skipPersist: true });
    Voice.onRemoteSpeaking = (userId, speaking) => this.setUserSpeaking(userId, speaking);
    Voice.start({
      channelId,
      meId: this.state.auth.currentUserId,
      iceServers: this.iceServersCache.servers,
      sendSignal: (targetUserId, signalType, signalData) =>
        NativeBridge.rpc("RTC_SIGNAL", { channelId, targetUserId, signalType, signalData })
    });
    Voice.setMuted(this.state.voice.muted);
    Voice.setDeafened(this.state.voice.deafened);
    Voice.setOutputDevice(this.state.settings.voiceOutputDeviceId);
    Voice.setOutputVolume(this.state.settings.voiceOutputVolume ?? 100);
    Voice.setLocalUserPrefs(this.getUserAudioPrefs());
    Voice.setNoiseSuppression(this.state.voice.noiseSuppression !== false);
    if (this.localAudioStream) Voice.setLocalStream(this.localMicFilter?.stream || this.localAudioStream);
    Voice.syncParticipants((participants || []).map((p) => p.userId));
  }

  // Webcam on/off for the current call
  async toggleCamera() {
    if (!this.state.voice.connectedChannelId) {
      return { ok: false, error: "Entre em uma call para ligar a câmera." };
    }
    if (this.state.voice.videoEnabled) {
      Camera.stop();
      Voice.setCameraStream(null);
      this.state.voice.videoEnabled = false;
    } else {
      const res = await Camera.start(this.state.settings.videoInputDeviceId || "default");
      if (!res.ok) return res;
      Voice.setCameraStream(res.stream);
      this.state.voice.videoEnabled = true;
    }
    this.notify({ skipPersist: true });
    await this.publishVoiceState();
    return { ok: true, videoEnabled: this.state.voice.videoEnabled };
  }

  publishVoiceState() {
    if (!this.state.voice.connectedChannelId) return Promise.resolve();
    return NativeBridge.rpc("updateVoiceState", {
      userId: this.state.auth.currentUserId,
      muted: this.state.voice.muted,
      deafened: this.state.voice.deafened,
      videoEnabled: this.state.voice.videoEnabled
    });
  }

  // Wire up real-time VAD if audio input is available
  startLocalVoiceActivity() {
    NativeBridge.setMediaSessionActive(true);
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      const inputId = this.state.settings.voiceInputDeviceId;
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            ...(inputId && inputId !== "default" ? { deviceId: { exact: inputId } } : {}),
            echoCancellation: true,
            noiseSuppression: this.state.voice.noiseSuppression !== false,
            autoGainControl: true
          }
        })
        .then(async (st) => {
          // Noise filter before sending (and before the speaking ring, so a
          // keyboard or fan no longer lights it up); unfiltered if it fails
          let filter = null;
          if (this.state.voice.noiseSuppression !== false) {
            filter = await createDenoisedStream(st).catch(() => null);
          }
          // Left the call while the browser was still opening the microphone
          if (!this.state.voice.connectedChannelId) {
            if (filter) filter.dispose();
            st.getTracks().forEach((t) => t.stop());
            return;
          }
          this.localAudioStream = st;
          this.localMicFilter = filter;
          const sent = filter ? filter.stream : st;
          Voice.setLocalStream(sent);
          VAD.start(sent, (speaking) => {
            this.setVoiceSpeaking(speaking);
          });
        })
        .catch(() => {});
    }
  }

  // ==========================================================================
  // DM Voice Calls (ringing, answering, declining)
  // ==========================================================================
  async startDmCall(dmChannelId, { answering = false } = {}) {
    const dm = this.state.dms.find((d) => d.id === dmChannelId);
    if (!dm) return { ok: false, error: "Conversa não encontrada." };
    if (this.state.voice.connectedChannelId === dmChannelId) return { ok: true, alreadyConnected: true };
    if (this.state.voice.connectedChannelId) {
      await this.leaveVoiceChannel();
    }

    const meId = this.state.auth.currentUserId;
    this.state.incomingCall = null;
    this.state.voice.connectedGuildId = null;
    this.state.voice.connectedChannelId = dmChannelId;
    this.state.voice.sessionId = `${meId}:dm:${dmChannelId}:${Date.now()}`;
    this.state.voice.pingMs = Math.floor(14 + Math.random() * 10);
    this.state.voice.dmCall = { channelId: dmChannelId, peerId: dm.userId, status: "ringing" };
    this.notify();

    if (answering) {
      await this.markDmCallConnected();
    } else {
      CallSounds.startRinging(this.state.settings);
      clearTimeout(this.dmRingTimeout);
      this.dmRingTimeout = setTimeout(() => {
        if (this.state.voice.dmCall?.channelId === dmChannelId && this.state.voice.dmCall.status === "ringing") {
          this.leaveVoiceChannel();
        }
      }, DM_CALL_RING_TIMEOUT_MS);
    }

    const res = await NativeBridge.rpc("joinVoiceChannel", { userId: meId, guildId: null, channelId: dmChannelId });
    await this.startVoiceMesh(dmChannelId, res?.participants);
    // The other person may already be waiting in the call (they called us first)
    if ((res?.participants || []).some((p) => p.userId === dm.userId)) {
      await this.markDmCallConnected();
    }
    this.startLocalVoiceActivity();
    return { ok: true };
  }

  async markDmCallConnected() {
    const call = this.state.voice.dmCall;
    if (!call || call.status === "connected") return;
    CallSounds.stopRinging();
    clearTimeout(this.dmRingTimeout);
    call.status = "connected";
    this.notify({ skipPersist: true });
    await CallSounds.play("join", this.state.settings, this.state.voice.sessionId);
  }

  async acceptIncomingCall() {
    const incoming = this.state.incomingCall;
    if (!incoming) return { ok: false };
    CallSounds.stopRinging();
    return this.startDmCall(incoming.channelId, { answering: true });
  }

  declineIncomingCall() {
    this.dismissedCallChannelId = this.state.incomingCall?.channelId || null;
    this.state.incomingCall = null;
    CallSounds.stopRinging();
    this.notify({ skipPersist: true });
  }

  // Play the leave sound when someone else leaves the voice channel we are in
  handleVoiceRoomPresence(channelId, participants) {
    if (!this.roomParticipants) this.roomParticipants = new Map();
    const meId = this.state.auth.currentUserId;
    const ids = participants.map((p) => p.userId);
    const prev = this.roomParticipants.get(channelId);
    this.roomParticipants.set(channelId, ids);
    if (!prev || this.state.voice.connectedChannelId !== channelId || !ids.includes(meId)) return;
    // DM hang-ups end the call in handleDmCallRoomUpdate, which plays the sound itself
    if (this.state.voice.dmCall) return;
    const soundsMuted = new Set(this.getUserAudioPrefs().soundsMuted);
    if (prev.some((id) => id !== meId && !ids.includes(id) && !soundsMuted.has(id))) {
      CallSounds.play("leave", this.state.settings, null, { force: true });
    }
  }

  handleDmCallRoomUpdate(channelId, participants) {
    const meId = this.state.auth.currentUserId;
    const call = this.state.voice.dmCall;

    // Outgoing call: the person we are ringing picked up
    if (call && call.channelId === channelId) {
      const peerPresent = participants.some((p) => p.userId === call.peerId);
      if (call.status === "ringing" && peerPresent) {
        this.markDmCallConnected();
      } else if (call.status === "connected" && !peerPresent) {
        // The other person hung up
        this.leaveVoiceChannel();
      }
      return;
    }

    // Incoming call: the other person is in one of our DM rooms and we are not
    const dm = this.state.dms.find((d) => d.id === channelId);
    if (!dm) return;
    const callerPresent = participants.some((p) => p.userId === dm.userId);
    const meInRoom = participants.some((p) => p.userId === meId);
    if (callerPresent && !meInRoom) {
      if (this.state.incomingCall?.channelId === channelId || this.dismissedCallChannelId === channelId) return;
      this.state.incomingCall = { channelId, callerId: dm.userId };
      CallSounds.startRinging(this.state.settings);
      this.notify({ skipPersist: true });
    } else if (!callerPresent) {
      if (this.dismissedCallChannelId === channelId) this.dismissedCallChannelId = null;
      if (this.state.incomingCall?.channelId === channelId) {
        this.state.incomingCall = null;
        CallSounds.stopRinging();
        this.notify({ skipPersist: true });
      }
    }
  }

  // Play the notification sound for messages from other people, unless the
  // user is already looking at that conversation
  notifyIncomingMessage(channelId, messageId) {
    const msg = (this.state.messages[channelId] || []).find((m) => m.id === messageId);
    if (!msg || msg.authorId === this.state.auth.currentUserId) return;
    const viewing = this.isViewingChannel(channelId) && typeof document !== "undefined" && document.hasFocus();
    if (viewing) return;
    this.markUnread(channelId);
    CallSounds.playNotification(this.state.settings);
  }

  // ==========================================================================
  // Unread messages (red badges on servers, channels and DMs)
  // ==========================================================================
  // Kept on this PC per account, so they survive syncs and restarts.
  unreadKey() {
    return `eco_unread_${this.state.auth.currentUserId || ""}`;
  }

  loadUnread() {
    if (this.unreadFor === this.state.auth.currentUserId) return;
    this.unreadFor = this.state.auth.currentUserId;
    try {
      this.unreadCounts = JSON.parse(localStorage.getItem(this.unreadKey()) || "{}") || {};
    } catch (_) {
      this.unreadCounts = {};
    }
  }

  saveUnread() {
    try {
      localStorage.setItem(this.unreadKey(), JSON.stringify(this.unreadCounts));
    } catch (_) {}
  }

  isViewingChannel(channelId) {
    const nav = this.state.navigation;
    if (nav.view === "home") return nav.homeSection === "dm" && nav.activeDmId === channelId;
    if (nav.view === "guild") return nav.callViewChannelId ? nav.callViewChannelId === channelId : nav.activeChannelId === channelId;
    return false;
  }

  markUnread(channelId) {
    this.loadUnread();
    this.unreadCounts[channelId] = (this.unreadCounts[channelId] || 0) + 1;
    this.saveUnread();
    this.applyUnread();
    this.notify({ skipPersist: true });
  }

  clearUnread(channelId) {
    this.loadUnread();
    if (!channelId || !this.unreadCounts[channelId]) return;
    delete this.unreadCounts[channelId];
    this.saveUnread();
    this.applyUnread();
  }

  // Copies the counts onto the state the UI reads
  applyUnread() {
    this.loadUnread();
    const counts = this.unreadCounts;
    for (const g of this.state.guilds) {
      let total = 0;
      for (const c of g.channels || []) {
        c.unreadCount = counts[c.id] || 0;
        c.unread = c.unreadCount > 0;
        total += c.unreadCount;
      }
      g.unreadCount = total;
      g.unread = total > 0;
    }
    for (const dm of this.state.dms) dm.unreadCount = counts[dm.id] || 0;
  }

  async leaveVoiceChannel() {
    NativeBridge.setMediaSessionActive(false);
    Camera.stop();
    Voice.stop();
    if (!this.state.voice.connectedChannelId) return { ok: true };
    this.state.navigation.callViewChannelId = null;
    const meId = this.state.auth.currentUserId;
    const prevSession = this.state.voice.sessionId || `${meId}:${this.state.voice.connectedChannelId}`;

    CallSounds.stopRinging();
    clearTimeout(this.dmRingTimeout);
    this.stopLocalMicrophone();

    if (this.state.voice.screenShareEnabled) {
      await this.stopScreenShare();
    }

    for (const g of this.state.guilds) {
      for (const c of g.channels) {
        if (c.type === "voice" && Array.isArray(c.connectedUsers)) {
          c.connectedUsers = c.connectedUsers.filter((u) => u !== meId);
        }
      }
    }

    this.state.voice.connectedGuildId = null;
    this.state.voice.connectedChannelId = null;
    this.state.voice.sessionId = null;
    this.state.voice.dmCall = null;
    this.state.voice.videoEnabled = false;
    this.state.voice.screenShareEnabled = false;
    this.state.voice.isSpeaking = false;
    this.state.voice.speakingUsers = {};
    this.notify();

    // Play Leave Sound once per transition
    await CallSounds.play("leave", this.state.settings, prevSession);
    await NativeBridge.rpc("leaveVoiceChannel", { userId: meId });
    NativeBridge.purgeMemory();
    return { ok: true };
  }

  // The green ring: the UI swaps it directly (onSpeakingChange) instead of
  // redrawing the whole app every time someone starts or stops talking
  setUserSpeaking(userId, speaking) {
    if (!this.state.voice.speakingUsers) this.state.voice.speakingUsers = {};
    if (Boolean(this.state.voice.speakingUsers[userId]) === Boolean(speaking)) return;
    this.state.voice.speakingUsers[userId] = Boolean(speaking);
    if (typeof this.onSpeakingChange === "function") this.onSpeakingChange(userId, Boolean(speaking));
    else this.notify({ skipPersist: true });
  }

  async setVoiceSpeaking(speaking) {
    // While muted nothing is sent, so nobody should see us "speaking"
    const isSpk = Boolean(speaking) && !this.state.voice.muted && !this.state.voice.deafened;
    this.state.voice.isSpeaking = isSpk;
    const meId = this.state.auth.currentUserId;
    this.setUserSpeaking(meId, isSpk);
    if (this.state.voice.connectedChannelId) {
      await NativeBridge.rpc("setVoiceSpeaking", {
        channelId: this.state.voice.connectedChannelId,
        userId: meId,
        speaking: isSpk
      });
    }
  }

  toggleMute() {
    // Without "Falar" in this server the microphone stays off
    if (this.state.voice.muted && !this.canSpeakInCall()) {
      this.onPermissionNotice?.("Você não tem permissão para falar neste canal.");
      return { ok: false };
    }
    this.state.voice.muted = !this.state.voice.muted;
    if (!this.state.voice.muted && this.state.voice.deafened) {
      this.state.voice.deafened = false;
    }
    const soundType = this.state.voice.muted ? "mute" : "unmute";
    CallSounds.play(soundType, this.state.settings);
    Voice.setMuted(this.state.voice.muted);
    Voice.setDeafened(this.state.voice.deafened);
    if (this.state.voice.muted && this.state.voice.isSpeaking) {
      this.setVoiceSpeaking(false);
    }
    this.notify();
    if (this.state.voice.connectedChannelId) {
      NativeBridge.rpc("updateVoiceState", {
        userId: this.state.auth.currentUserId,
        muted: this.state.voice.muted,
        deafened: this.state.voice.deafened
      });
    }
    return { ok: true, muted: this.state.voice.muted };
  }

  toggleDeafen() {
    if (this.state.voice.deafened && this.state.voice.serverDeafened) {
      this.onPermissionNotice?.("Um moderador desativou seu áudio neste servidor.");
      return { ok: false };
    }
    this.state.voice.deafened = !this.state.voice.deafened;
    Voice.setDeafened(this.state.voice.deafened);
    if (this.state.voice.deafened) {
      this.state.voice.muted = true;
      CallSounds.play("mute", this.state.settings);
      if (this.state.voice.isSpeaking) {
        this.setVoiceSpeaking(false);
      }
    } else {
      CallSounds.play("unmute", this.state.settings);
    }
    Voice.setMuted(this.state.voice.muted);
    this.notify();
    if (this.state.voice.connectedChannelId) {
      NativeBridge.rpc("updateVoiceState", {
        userId: this.state.auth.currentUserId,
        muted: this.state.voice.muted,
        deafened: this.state.voice.deafened
      });
    }
    return { ok: true, deafened: this.state.voice.deafened };
  }

  async getScreenShareSources() {
    return await ScreenShare.getSources();
  }

  async startScreenShare(sourceId, { sourceName = "Screen", resolution = "1080p", fps = 60, includeAudio = false } = {}) {
    if (!this.state.voice.connectedChannelId) {
      return { ok: false, error: "Conecte-se a um canal de voz antes de compartilhar a tela." };
    }
    const meId = this.state.auth.currentUserId;
    const guildId = this.state.voice.connectedGuildId;
    const channelId = this.state.voice.connectedChannelId;

    ScreenShare.onTrackEnded = () => {
      this.stopScreenShare();
    };

    const size = SCREEN_RESOLUTIONS[resolution] || SCREEN_RESOLUTIONS["1080p"];
    const cap = await ScreenShare.startCapture(sourceId, { ...size, frameRate: fps, includeAudio });

    if (!cap.ok) {
      return cap;
    }
    // Bitrate is sized from what the capture really delivers (e.g. "source" on a 1440p monitor)
    const settings = cap.stream.getVideoTracks()[0]?.getSettings() || {};
    Voice.setScreenStream(cap.stream, {
      width: settings.width || size.width || 1920,
      height: settings.height || size.height || 1080,
      fps: Number(fps) || 60
    });

    this.state.voice.screenShareEnabled = true;
    this.state.voice.screenShareSourceId = sourceId;
    this.state.voice.screenShareSourceName = sourceName;

    const res = await NativeBridge.rpc("startScreenShare", {
      userId: meId,
      guildId,
      channelId,
      sourceId,
      sourceName,
      resolution,
      fps
    });

    if (res.ok && res.share) {
      this.state.screenShares[`${channelId}:${meId}`] = res.share;
    }
    this.notify();
    return { ok: true, stream: cap.stream, trackCount: ScreenShare.getActiveTrackCount(), fps: Number(fps) || 30, resolution };
  }

  async stopScreenShare() {
    const meId = this.state.auth.currentUserId;
    const channelId = this.state.voice.connectedChannelId;
    Voice.setScreenStream(null);
    ScreenShare.stopCapture();
    this.state.voice.screenShareEnabled = false;
    this.state.voice.screenShareSourceId = null;
    this.state.voice.screenShareSourceName = null;
    if (channelId) {
      delete this.state.screenShares[`${channelId}:${meId}`];
    }
    this.notify();
    await NativeBridge.rpc("stopScreenShare", { userId: meId, channelId });
    NativeBridge.purgeMemory();
    return { ok: true, trackCount: ScreenShare.getActiveTrackCount() };
  }

  // ==========================================================================
  // Message CRUD & Slash Commands
  // ==========================================================================
  async sendMessage(channelId, rawContent, options = {}) {
    const text = String(rawContent || "").trim();
    if (!text && !options.attachment && !options.poll) return null;

    let finalContent = text;
    if (text === "/shrug") finalContent = "¯\\_(ツ)_/¯";
    else if (text === "/tableflip") finalContent = "(╯°□°）╯︵ ┻━┻";
    else if (text === "/unflip") finalContent = "┬─┬ ノ( ゜-゜ノ)";
    else if (text.startsWith("/me ")) finalContent = `*${text.slice(4)}*`;

    const meId = this.state.auth.currentUserId;
    const res = await NativeBridge.rpc("sendMessage", {
      channelId,
      authorId: meId,
      content: finalContent,
      replyToId: options.replyToId || null,
      attachment: options.attachment || null,
      poll: options.poll || null
    });

    if (!res.ok) return { error: res.error };
    if (res.ok && res.message) {
      if (!this.state.messages[channelId]) this.state.messages[channelId] = [];
      const exists = this.state.messages[channelId].some((m) => m.id === res.message.id);
      if (!exists) {
        this.state.messages[channelId].push(res.message);
      }
      this.notify();
      return res.message;
    }
    return null;
  }

  async votePoll(channelId, messageId, optionId) {
    const res = await NativeBridge.rpc("votePoll", { messageId, optionId });
    if (res.ok) {
      const msg = (this.state.messages[channelId] || []).find((m) => m.id === messageId);
      if (msg) msg.poll = res.poll;
      this.notify({ skipPersist: true });
    }
    return res;
  }

  async editMessage(channelId, messageId, newContent) {
    const clean = String(newContent || "").trim();
    if (!clean) return false;
    const list = this.state.messages[channelId] || [];
    const msg = list.find((m) => m.id === messageId);
    if (msg) {
      msg.content = clean;
      msg.edited = true;
      this.notify();
    }
    const res = await NativeBridge.rpc("editMessage", {
      channelId,
      messageId,
      userId: this.state.auth.currentUserId,
      newContent: clean
    });
    return Boolean(res.ok);
  }

  async deleteMessage(channelId, messageId) {
    if (this.state.messages[channelId]) {
      this.state.messages[channelId] = this.state.messages[channelId].filter((m) => m.id !== messageId);
    }
    if (this.state.navigation.activeThreadMessageId === messageId) {
      this.state.navigation.activeThreadMessageId = null;
    }
    this.notify();
    const res = await NativeBridge.rpc("deleteMessage", {
      channelId,
      messageId,
      userId: this.state.auth.currentUserId
    });
    return Boolean(res.ok);
  }

  async togglePinMessage(channelId, messageId) {
    const res = await NativeBridge.rpc("togglePinMessage", { channelId, messageId });
    if (res.ok) {
      const list = this.state.messages[channelId] || [];
      const msg = list.find((m) => m.id === messageId);
      if (msg) msg.pinned = res.pinned;
      this.notify();
    }
    return res.pinned;
  }

  async toggleReaction(channelId, messageId, emoji) {
    const res = await NativeBridge.rpc("toggleReaction", {
      channelId,
      messageId,
      userId: this.state.auth.currentUserId,
      emoji
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
  }

  async sendThreadReply(channelId, parentMessageId, content) {
    const res = await NativeBridge.rpc("sendThreadReply", {
      channelId,
      parentMessageId,
      authorId: this.state.auth.currentUserId,
      content
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
  }

  // ==========================================================================
  // Phase 10: Real Friend Search & Friend Request Workflow by @username
  // ==========================================================================
  async searchUsersByUsername(query) {
    const res = await NativeBridge.rpc("searchUsers", {
      currentUserId: this.state.auth.currentUserId,
      query
    });
    return res.ok ? res.users : [];
  }

  async addFriendByUsername(rawUsername) {
    const res = await NativeBridge.rpc("sendFriendRequest", {
      fromUserId: this.state.auth.currentUserId,
      targetUsername: rawUsername
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
    return res;
  }

  async sendFriendRequestToUser(targetUserId) {
    const res = await NativeBridge.rpc("sendFriendRequest", {
      fromUserId: this.state.auth.currentUserId,
      targetUserId
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
    return res;
  }

  async acceptFriendRequest(targetUserId) {
    return await this.respondFriendRequest(targetUserId, "accept");
  }

  async respondFriendRequest(targetUserId, action = "accept") {
    const res = await NativeBridge.rpc("respondFriendRequest", {
      userId: this.state.auth.currentUserId,
      targetUserId,
      action
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
    return res;
  }

  async removeOrBlockFriend(targetUserId, action = "remove") {
    const res = await NativeBridge.rpc("removeOrBlockFriend", {
      userId: this.state.auth.currentUserId,
      targetUserId,
      action
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
    return res;
  }

  async closeDm(dmId) {
    const res = await NativeBridge.rpc("closeDm", { dmId });
    if (res.ok) {
      this.state.dms = this.state.dms.filter((d) => d.id !== dmId);
      if (this.state.navigation.activeDmId === dmId) this.selectHome("friends");
      this.notify();
    }
    return res;
  }

  async openOrCreateDm(targetUserId) {
    const res = await NativeBridge.rpc("openOrCreateDm", {
      userId: this.state.auth.currentUserId,
      targetUserId
    });
    if (res.ok && res.dmId) {
      await this.syncFromBackend({ silent: true });
      this.selectHome("dm", res.dmId);
      return this.state.dms.find((d) => d.id === res.dmId);
    }
    return null;
  }

  // ==========================================================================
  // Guilds, Channels & Phase 11 Cryptographic Server Invites
  // ==========================================================================
  async createGuild({ name, iconColor }) {
    const res = await NativeBridge.rpc("createGuild", {
      ownerId: this.state.auth.currentUserId,
      name,
      iconColor
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
      this.selectGuild(res.guildId, res.generalChannelId);
      return this.getActiveGuild();
    }
    return null;
  }

  async createChannel(guildId, { name, type, categoryId, topic }) {
    const res = await NativeBridge.rpc("createChannel", {
      userId: this.state.auth.currentUserId,
      guildId,
      name,
      type,
      categoryId,
      topic
    });
    if (res.ok && res.channel) {
      await this.syncFromBackend({ silent: true });
      if (res.channel.type !== "voice") {
        this.state.navigation.activeChannelId = res.channel.id;
      }
      this.notify();
      return res.channel;
    }
    return null;
  }

  async deleteChannel(guildId, channelId) {
    const res = await NativeBridge.rpc("deleteChannel", {
      userId: this.state.auth.currentUserId,
      guildId,
      channelId
    });
    if (res.ok) {
      await this.syncFromBackend();
      return true;
    }
    return false;
  }

  async createServerInvite(guildId, { channelId = null, expiresInSeconds = 86400, maxUses = 0 } = {}) {
    return await NativeBridge.rpc("createInvite", {
      userId: this.state.auth.currentUserId,
      guildId,
      channelId,
      expiresInSeconds,
      maxUses
    });
  }

  async getGuildInvites(guildId) {
    return await NativeBridge.rpc("getGuildInvites", {
      userId: this.state.auth.currentUserId,
      guildId
    });
  }

  async revokeServerInvite(code) {
    const res = await NativeBridge.rpc("revokeInvite", {
      userId: this.state.auth.currentUserId,
      code
    });
    if (res.ok) {
      await this.syncFromBackend();
    }
    return res;
  }

  async inspectServerInvite(code) {
    return await NativeBridge.rpc("inspectInvite", { code });
  }

  async acceptServerInvite(code) {
    const res = await NativeBridge.rpc("acceptInvite", {
      userId: this.state.auth.currentUserId,
      code
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
      this.selectGuild(res.guildId, res.channelId);
    }
    return res;
  }

  async joinDiscoverableGuild(guildId) {
    const res = await NativeBridge.rpc("joinPublicGuild", { guildId });
    await this.syncFromBackend();
    if (res.ok) this.selectGuild(res.guildId, res.channelId);
    return res;
  }

  // ==========================================================================
  // Server Roles Management & Hierarchy
  // ==========================================================================
  async updateGuild(guildId, changes = {}) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("updateGuild", { actorId: me.id, guildId, ...changes });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  async createRole(guildId, roleData = {}) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("createRole", {
      actorId: me.id,
      guildId,
      ...roleData
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  async updateRole(guildId, roleId, roleData = {}) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("updateRole", {
      actorId: me.id,
      guildId,
      roleId,
      ...roleData
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  // Server management that only needs a refresh afterwards
  async guildAction(action, params) {
    const res = await NativeBridge.rpc(action, params);
    if (res.ok) await this.syncFromBackend({ silent: true });
    return res;
  }

  kickMember(guildId, targetUserId) {
    return this.guildAction("kickMember", { guildId, targetUserId });
  }

  updateEveryonePermissions(guildId, permissions) {
    return this.guildAction("updateEveryonePermissions", { guildId, permissions });
  }

  updateChannel(guildId, channelId, changes) {
    return this.guildAction("updateChannel", { guildId, channelId, ...changes });
  }

  createCategory(guildId, name) {
    return this.guildAction("createCategory", { guildId, name });
  }

  updateCategory(guildId, categoryId, name) {
    return this.guildAction("updateCategory", { guildId, categoryId, name });
  }

  deleteCategory(guildId, categoryId) {
    return this.guildAction("deleteCategory", { guildId, categoryId });
  }

  // Permissions of anyone in a server, from its roles (owner = everything)
  memberPermissions(guild, userId) {
    if (!guild) return new Set();
    if (guild.ownerId === userId) return new Set(["ADMINISTRATOR"]);
    const roleIds = (guild.members || []).find((m) => m.userId === userId)?.roles || [];
    const perms = new Set(guild.everyonePermissions || []);
    for (const role of guild.roles || []) {
      if (roleIds.includes(role.id)) for (const flag of role.permissions || []) perms.add(flag);
    }
    return perms;
  }

  memberCan(guild, userId, flag) {
    const perms = this.memberPermissions(guild, userId);
    return perms.has("ADMINISTRATOR") || perms.has(flag);
  }

  canSpeakInCall() {
    if (this.state.voice.serverMuted) return false;
    const guild = this.state.guilds.find((g) => g.id === this.state.voice.connectedGuildId);
    return !guild || this.can("SPEAK_VOICE", guild);
  }

  // Server mute/deafen set by a moderator (flags on my entry in the room)
  applyModeration(participants) {
    this.roomServerMuted = new Set(participants.filter((p) => p.serverMuted).map((p) => p.userId));
    const me = participants.find((p) => p.userId === this.state.auth.currentUserId);
    const v = this.state.voice;
    const wasMuted = v.serverMuted;
    const wasDeafened = v.serverDeafened;
    v.serverMuted = Boolean(me?.serverMuted);
    v.serverDeafened = Boolean(me?.serverDeafened);
    if (v.serverMuted && !v.muted) {
      v.muted = true;
      Voice.setMuted(true);
    }
    if (v.serverDeafened && !v.deafened) {
      v.deafened = true;
      v.muted = true;
      Voice.setDeafened(true);
      Voice.setMuted(true);
    }
    if (v.serverMuted !== wasMuted) this.onPermissionNotice?.(v.serverMuted ? "Um moderador silenciou sua voz neste servidor." : "Sua voz foi liberada pelo moderador.");
    if (v.serverDeafened !== wasDeafened) this.onPermissionNotice?.(v.serverDeafened ? "Um moderador desativou seu áudio neste servidor." : "Seu áudio foi liberado pelo moderador.");
    this.applyCallPermissions();
    this.notify({ skipPersist: true });
  }

  async handleForcedVoice({ op, guildId, channelId }) {
    if (op === "move" && guildId && channelId) {
      this.onPermissionNotice?.("Um moderador moveu você para outro canal de voz.");
      await this.joinVoiceChannel(guildId, channelId);
      return;
    }
    this.onPermissionNotice?.("Um moderador desconectou você da call.");
    await this.leaveVoiceChannel();
  }

  // Right-click on someone in a call (needs the matching permission)
  async moderateVoice(targetUserId, op, { value, channelId } = {}) {
    const res = await NativeBridge.rpc("voiceModerate", { targetUserId, op, value, channelId });
    if (!res.ok) this.onPermissionNotice?.(res.error || "Não foi possível fazer isso.");
    return res;
  }

  // Per-person preferences on this PC: volume, silenced, sounds off, video hidden
  getUserAudioPrefs() {
    if (!this.userAudioPrefs) {
      try {
        this.userAudioPrefs = JSON.parse(localStorage.getItem("eco_user_call_prefs_v1") || "null");
      } catch {}
      this.userAudioPrefs = { volumes: {}, muted: [], soundsMuted: [], videoHidden: [], ...(this.userAudioPrefs || {}) };
    }
    return this.userAudioPrefs;
  }

  setUserAudioPref(key, userId, value) {
    const prefs = this.getUserAudioPrefs();
    if (key === "volume") prefs.volumes[userId] = Math.max(0, Math.min(100, Number(value)));
    else {
      const list = new Set(prefs[key]);
      if (value) list.add(userId);
      else list.delete(userId);
      prefs[key] = [...list];
    }
    try {
      localStorage.setItem("eco_user_call_prefs_v1", JSON.stringify(prefs));
    } catch {}
    Voice.setLocalUserPrefs(prefs);
    if (key !== "volume") this.notify({ skipPersist: true });
  }

  // Everyone in my call without "Falar" is never played on this PC
  applyCallPermissions() {
    const guild = this.state.guilds.find((g) => g.id === this.state.voice.connectedGuildId);
    if (!guild || !this.state.voice.connectedChannelId) return Voice.setSilencedUsers([]);
    const channel = guild.channels.find((c) => c.id === this.state.voice.connectedChannelId);
    Voice.setSilencedUsers(
      (channel?.connectedUsers || []).filter((id) => !this.memberCan(guild, id, "SPEAK_VOICE") || this.roomServerMuted?.has(id))
    );
    if (!this.canSpeakInCall() && !this.state.voice.muted) {
      this.state.voice.muted = true;
      Voice.setMuted(true);
      this.publishVoiceState();
    }
  }

  // My permissions in a server (computed by the backend), owner = everything
  can(flag, guild = this.getActiveGuild()) {
    if (!guild) return true; // DMs
    return (guild.myPermissions || []).includes(flag);
  }

  async banMember(guildId, targetUserId, reason = "") {
    const res = await NativeBridge.rpc("banMember", { guildId, targetUserId, reason });
    if (res.ok) await this.syncFromBackend({ silent: true });
    return res;
  }

  async deleteGuild(guildId, currentPassword) {
    const res = await NativeBridge.rpc("deleteGuild", { guildId, currentPassword });
    if (res.ok) {
      if (this.state.voice.connectedGuildId === guildId) await this.leaveVoiceChannel();
      this.state.guilds = this.state.guilds.filter((g) => g.id !== guildId);
      this.selectHome("friends");
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  async deleteRole(guildId, roleId) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("deleteRole", {
      actorId: me.id,
      guildId,
      roleId
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  async assignMemberRole(guildId, targetUserId, roleId) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("assignMemberRole", {
      actorId: me.id,
      guildId,
      targetUserId,
      roleId
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  async removeMemberRole(guildId, targetUserId, roleId) {
    const me = this.getCurrentUser();
    const res = await NativeBridge.rpc("removeMemberRole", {
      actorId: me.id,
      guildId,
      targetUserId,
      roleId
    });
    if (res.ok) {
      await this.syncFromBackend({ silent: true });
    }
    return res;
  }

  // ==========================================================================
  // Animated GIF Library & Search
  // ==========================================================================
  subscribeGifPicker(fn) {
    this.gifListeners.add(fn);
    return () => this.gifListeners.delete(fn);
  }

  notifyGifPicker() {
    for (const fn of this.gifListeners) fn(this.state);
  }

  gifCacheKey(query, category) {
    return `${String(query || "").trim().toLowerCase()}|${category || "All"}`;
  }

  getCachedGifs(query, category) {
    const hit = this.gifCache.get(this.gifCacheKey(query, category));
    if (!hit || Date.now() - hit.at > GIF_CACHE_TTL_MS) return null;
    return hit;
  }

  cacheGifs(query, category, gp) {
    this.gifCache.set(this.gifCacheKey(query, category), {
      results: gp.results,
      total: gp.total,
      offset: gp.offset,
      hasMore: gp.hasMore,
      at: Date.now()
    });
  }

  // Loads the trending feed into the cache in the background, so the first
  // time the picker opens it shows GIFs immediately
  async prefetchGifs() {
    if (this.getCachedGifs("", "All") || !NativeBridge.sessionToken) return;
    const res = await NativeBridge.rpc("searchGifs", { query: "", category: "All", limit: GIF_PAGE_SIZE, offset: 0 });
    if (!res?.ok) return;
    const gifs = res.gifs || [];
    this.cacheGifs("", "All", {
      results: gifs,
      total: res.total || 0,
      offset: gifs.length,
      hasMore: gifs.length > 0 && gifs.length < Math.min(res.total || 0, GIF_MAX_OFFSET)
    });
  }

  async searchGifs({ query = "", category = "All", limit = GIF_PAGE_SIZE, offset = 0 } = {}) {
    const requestId = ++this.gifRequestSeq;
    const gp = this.state.gifPicker;
    gp.query = query;
    gp.category = category;
    gp.loadingMore = false;

    const cached = offset === 0 && limit === GIF_PAGE_SIZE ? this.getCachedGifs(query, category) : null;
    if (cached) {
      Object.assign(gp, { results: cached.results, total: cached.total, offset: cached.offset, hasMore: cached.hasMore, loading: false });
      gp.searchId++;
      this.notifyGifPicker();
      return { ok: true, gifs: cached.results, total: cached.total, cached: true };
    }

    gp.loading = true;
    this.notifyGifPicker();
    const res = await NativeBridge.rpc("searchGifs", { query, category, limit, offset });
    if (requestId !== this.gifRequestSeq) return res; // a newer search replaced this one
    gp.loading = false;
    if (res.ok) {
      const gifs = res.gifs || [];
      gp.results = gifs;
      gp.total = res.total || 0;
      gp.offset = offset + gifs.length;
      gp.hasMore = gifs.length > 0 && gp.offset < Math.min(res.total || 0, GIF_MAX_OFFSET);
      gp.categories = res.categories || [];
      gp.searchId++;
      if (offset === 0 && limit === GIF_PAGE_SIZE) this.cacheGifs(query, category, gp);
    }
    this.notifyGifPicker();
    return res;
  }

  // Infinite scroll: fetch the next page of the current search and append it.
  async loadMoreGifs() {
    const gp = this.state.gifPicker;
    if (!gp.isOpen || gp.loading || gp.loadingMore || !gp.hasMore) return;
    const requestId = this.gifRequestSeq;
    gp.loadingMore = true;
    this.notifyGifPicker();
    const res = await NativeBridge.rpc("searchGifs", {
      query: gp.query,
      category: gp.category,
      limit: GIF_PAGE_SIZE,
      offset: gp.offset
    });
    if (requestId !== this.gifRequestSeq) return; // search changed while loading
    gp.loadingMore = false;
    if (res.ok) {
      const gifs = res.gifs || [];
      const seen = new Set(gp.results.map((g) => g.id));
      gp.results = gp.results.concat(gifs.filter((g) => !seen.has(g.id)));
      gp.total = res.total || gp.total;
      gp.offset += gifs.length;
      gp.hasMore = gifs.length > 0 && gp.offset < Math.min(gp.total, GIF_MAX_OFFSET);
      this.cacheGifs(gp.query, gp.category, gp);
    } else {
      gp.hasMore = false;
    }
    this.notifyGifPicker();
  }

  openGifPicker(target = "avatar") {
    const gp = this.state.gifPicker;
    gp.isOpen = true;
    gp.target = target;
    gp.results = [];
    gp.searchId++;
    this.searchGifs({ query: "", category: "All" });
  }

  closeGifPicker() {
    this.gifRequestSeq++; // discard any in-flight page for the closed picker
    this.state.gifPicker.isOpen = false;
    this.state.gifPicker.loading = false;
    this.state.gifPicker.loadingMore = false;
    this.notifyGifPicker();
  }

  selectGif(gifUrl) {
    const target = this.state.gifPicker.target;
    this.closeGifPicker();
    this.openMediaEditor({
      target,
      mediaUrl: gifUrl,
      scale: 1.0,
      cropX: 0,
      cropY: 0
    });
  }

  // ==========================================================================
  // Media Framing & Crop Editor (Avatar & Banner)
  // ==========================================================================
  openMediaEditor({ target = "avatar", mediaUrl, scale = 1.0, cropX = 0, cropY = 0, bannerPositionY = 50 }) {
    this.state.mediaEditor = {
      isOpen: true,
      sessionId: (this.state.mediaEditor.sessionId || 0) + 1, // new editor DOM per opening
      target,
      mediaUrl,
      scale: Math.max(1, Math.min(3, Number(scale) || 1)),
      cropX: Number(cropX) || 0,
      cropY: Number(cropY) || 0,
      bannerPositionY: Number(bannerPositionY) || 50
    };
    this.notify({ skipPersist: true });
  }

  updateMediaEditorCoords(coords = {}) {
    if (coords.scale !== undefined) this.state.mediaEditor.scale = Math.max(1, Math.min(3, Number(coords.scale) || 1));
    if (coords.cropX !== undefined) this.state.mediaEditor.cropX = Number(coords.cropX) || 0;
    if (coords.cropY !== undefined) this.state.mediaEditor.cropY = Number(coords.cropY) || 0;
    if (coords.bannerPositionY !== undefined) this.state.mediaEditor.bannerPositionY = Math.max(0, Math.min(100, Number(coords.bannerPositionY) || 50));
    // No notify(): the editor updates its own preview while a slider is being
    // dragged, and a re-render here would replace the slider mid-drag
  }

  closeMediaEditor() {
    this.state.mediaEditor.isOpen = false;
    this.notify({ skipPersist: true });
  }

  async applyMediaEditor() {
    const { target, mediaUrl, scale, cropX, cropY, bannerPositionY } = this.state.mediaEditor;
    const payload = {};
    if (target === "avatar") {
      payload.avatarUrl = mediaUrl;
      payload.avatarScale = scale;
      payload.avatarCropX = cropX;
      payload.avatarCropY = cropY;
    } else {
      payload.bannerUrl = mediaUrl;
      payload.bannerType = "image";
      payload.bannerScale = scale;
      payload.bannerCropX = cropX;
      payload.bannerCropY = cropY;
      payload.bannerPositionY = bannerPositionY;
    }
    const res = await this.updateMyProfile(payload);
    this.closeMediaEditor();
    return res;
  }

  // ==========================================================================
  // Server Settings Modal
  // ==========================================================================
  openServerSettings(guildId, tab = "overview") {
    this.state.serverSettings = {
      isOpen: true,
      guildId: guildId || this.state.navigation.activeGuildId,
      activeTab: tab,
      selectedRoleId: null,
      roleDraft: null
    };
    this.notify({ skipPersist: true });
  }

  closeServerSettings() {
    this.state.serverSettings.isOpen = false;
    this.notify({ skipPersist: true });
  }

  setServerSettingsTab(tab) {
    this.state.serverSettings.activeTab = tab;
    this.notify({ skipPersist: true });
  }

  selectRoleInSettings(roleId) {
    this.state.serverSettings.selectedRoleId = roleId;
    const guild = this.state.guilds.find((g) => g.id === this.state.serverSettings.guildId);
    const role = guild?.roles?.find((r) => r.id === roleId);
    this.state.serverSettings.roleDraft = role ? JSON.parse(JSON.stringify(role)) : null;
    this.notify({ skipPersist: true });
  }
}

export const store = new Store();
