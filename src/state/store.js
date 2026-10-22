// ==========================================================================
// Discord Application State & Real SQLite Backend Synchronization Store
// Zero illustrative/fictional users in production. All users, friendships,
// guilds, channels, messages, invites, and preferences are persisted in SQLite.
// ==========================================================================

import { NativeBridge, CallSounds, ScreenShare, VoiceDevices, VAD } from "../services/gatewayAdapter.js";

const LEGACY_STORAGE_KEY = "discord_desktop_replica_state_v1";
const SESSION_STORAGE_KEY = "discord_session_user_v2";
// Accounts that signed in on this device (shown on the login screen; password still required)
const SAVED_ACCOUNTS_KEY = "eco_saved_accounts_v1";
// GIPHY returns at most 50 GIFs per request and rejects search offsets above 4999.
const GIF_PAGE_SIZE = 50;
const GIF_MAX_OFFSET = 5000;
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
      noiseSuppression: true,
      inputVolume: 100,
      outputVolume: 100
    },
    incomingCall: null, // { channelId, callerId } while another user is ringing us
    screenShares: {}, // channelId -> { userId, guildId, channelId, sourceName, resolution, fps, frameDataUrl }
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
      offset: 0
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
    appConfig: { appName: "Eco", publicUrl: "" },
    messages: {}
  };
}

class Store {
  constructor() {
    this.gifRequestSeq = 0;
    // Purge legacy illustrative localStorage state to free memory and remove fictional data
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}

    this.state = createEmptyState();
    this.listeners = new Set();
    this.unsubscribeEvents = null;

    try {
      const savedSession = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
      if (savedSession) {
        if (savedSession.currentUserId) {
          this.state.auth.currentUserId = savedSession.currentUserId;
        }
        // Without a session token the user has to sign in again
        if (savedSession.sessionToken) {
          NativeBridge.setSessionToken(savedSession.sessionToken);
          this.state.auth.isAuthenticated = savedSession.isAuthenticated === true;
        } else {
          this.state.auth.isAuthenticated = false;
        }
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
      const ok = await this.syncFromBackend();
      if (!ok && !this.state.auth.emailGate) this.handleSessionExpired();
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

      if (event === "SCREEN_SHARE_FRAME" && payload?.channelId) {
        if (this.state.screenShares[payload.channelId]) {
          this.state.screenShares[payload.channelId].frameDataUrl = payload.frameDataUrl;
          this.state.screenShares[payload.channelId].updatedAt = payload.updatedAt;
          this.notify({ skipPersist: true });
        }
        return;
      }

      if (event === "SCREEN_SHARE_STARTED" && payload?.channelId) {
        this.state.screenShares[payload.channelId] = payload;
        this.notify({ skipPersist: true });
        return;
      }

      if (event === "SCREEN_SHARE_STOPPED" && payload?.channelId) {
        delete this.state.screenShares[payload.channelId];
        this.notify({ skipPersist: true });
        return;
      }

      if (event === "VOICE_SPEAKING_CHANGED" && payload?.userId) {
        this.state.voice.speakingUsers[payload.userId] = Boolean(payload.speaking);
        if (payload.userId === this.state.auth.currentUserId) {
          this.state.voice.isSpeaking = Boolean(payload.speaking);
        }
        this.notify({ skipPersist: true });
        return;
      }

      if (event === "RTC_ROOM_UPDATED" && payload?.channelId) {
        this.handleVoiceRoomPresence(payload.channelId, payload.participants || []);
        this.handleDmCallRoomUpdate(payload.channelId, payload.participants || []);
      }

      if (event === "MESSAGE_CREATED" && payload?.channelId) {
        this.syncFromBackend({ silent: false }).then(() => this.notifyIncomingMessage(payload.channelId, payload.messageId));
        return;
      }

      // For structural state changes (messages, friendships, username/profile updates, guilds, voice)
      this.syncFromBackend({ silent: false });
    });
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
    this.state.dms = snap.dms || [];
    this.state.guilds = snap.guilds || [];
    this.state.discoverableGuilds = snap.discoverableGuilds || [];
    if (snap.appConfig) this.state.appConfig = snap.appConfig;
    this.state.messages = snap.messages || {};
    this.state.settings = {
      ...this.state.settings,
      ...(snap.settings || {})
    };

    // Map active screen shares by channelId
    const nextShares = {};
    for (const s of snap.activeScreenShares || []) {
      nextShares[s.channelId] = {
        ...s,
        frameDataUrl: this.state.screenShares[s.channelId]?.frameDataUrl || s.frameDataUrl || null
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

  persist() {
    try {
      // Store only lightweight session pointers in localStorage to minimize RAM
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          currentUserId: this.state.auth.currentUserId,
          isAuthenticated: this.state.auth.isAuthenticated,
          sessionToken: NativeBridge.sessionToken,
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
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  rememberAccount(user) {
    const entry = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl || ""
    };
    const list = [entry, ...this.getSavedAccounts().filter((a) => a.id !== user.id)].slice(0, 8);
    try {
      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(list));
    } catch {}
  }

  // Shared tail of login/register/switch: adopt the new session and load its data
  async startSession(res) {
    NativeBridge.setSessionToken(res.sessionToken);
    this.state.auth.isAuthenticated = true;
    this.state.auth.currentUserId = res.user.id;
    this.rememberAccount(res.user);
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

  // Switching accounts is a full login: the target account's password is checked by the backend
  async switchAccount(userId, password) {
    const target = this.state.users[userId] || this.getSavedAccounts().find((a) => a.id === userId);
    if (!target) return { ok: false, error: "Usuário não encontrado." };
    const auth = await NativeBridge.rpc("login", { emailOrUsername: target.username, password });
    if (!auth.ok) return { ok: false, error: auth.error || "Senha incorreta." };
    if (auth.user?.id !== userId) return { ok: false, error: "Não foi possível confirmar esta conta." };
    if (this.state.auth.isAuthenticated) {
      if (this.state.voice.connectedChannelId) {
        await this.leaveVoiceChannel();
      }
      // End the previous account's session before adopting the new one
      await NativeBridge.rpc("logout", {});
    }
    return this.startSession(auth);
  }

  async logout() {
    if (this.state.voice.connectedChannelId) {
      await this.leaveVoiceChannel();
    }
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
  // Account security: e-mail, password and phone (codes delivered by the backend)
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

  requestPhoneVerification(phone, currentPassword) {
    return this.accountRpc("requestPhoneVerification", { phone, currentPassword });
  }

  confirmPhoneVerification(code) {
    return this.accountRpc("confirmPhoneVerification", { code });
  }

  removePhone(currentPassword) {
    return this.accountRpc("removePhone", { currentPassword });
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
    if (partial.minimizeToTray !== undefined) {
      NativeBridge.setSetting("MINIMIZE_TO_TRAY", Boolean(partial.minimizeToTray));
    }
    if (partial.hardwareAcceleration !== undefined) {
      NativeBridge.setSetting("enableHardwareAcceleration", Boolean(partial.hardwareAcceleration));
    }
    this.notify();
    await NativeBridge.rpc("updatePreferences", {
      userId: me.id,
      preferences: partial
    });
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
      const dm = this.state.dms.find((d) => d.id === dmId);
      if (dm) dm.unreadCount = 0;
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

    const targetChannel =
      (channelId && guild.channels.find((c) => c.id === channelId)) ||
      guild.channels.find((c) => c.id === this.state.navigation.activeChannelId && c.type !== "voice") ||
      guild.channels.find((c) => c.type !== "voice") ||
      guild.channels[0];

    if (targetChannel) {
      this.state.navigation.activeChannelId = targetChannel.id;
      targetChannel.unread = false;
      targetChannel.mentions = 0;
    }
    this.notify();
  }

  selectChannel(channelId) {
    const guild = this.getActiveGuild();
    if (!guild) return;
    const ch = guild.channels.find((c) => c.id === channelId);
    if (!ch) return;
    if (ch.type === "voice") {
      this.joinVoiceChannel(guild.id, ch.id);
      return;
    }
    this.state.navigation.activeChannelId = ch.id;
    this.state.navigation.activeThreadMessageId = null;
    ch.unread = false;
    ch.mentions = 0;
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
    await NativeBridge.rpc("joinVoiceChannel", { userId: meId, guildId, channelId });
    this.startLocalVoiceActivity();
    return { ok: true };
  }

  // Wire up real-time VAD if audio input is available
  startLocalVoiceActivity() {
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          audio:
            this.state.settings.voiceInputDeviceId && this.state.settings.voiceInputDeviceId !== "default"
              ? { deviceId: { exact: this.state.settings.voiceInputDeviceId } }
              : true
        })
        .then((st) => {
          this.localAudioStream = st;
          VAD.start(st, (speaking) => {
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
    if (prev.some((id) => id !== meId && !ids.includes(id))) {
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
    const viewing = this.getActiveChannel()?.id === channelId && typeof document !== "undefined" && document.hasFocus();
    if (viewing) return;
    CallSounds.playNotification(this.state.settings);
  }

  async leaveVoiceChannel() {
    if (!this.state.voice.connectedChannelId) return { ok: true };
    const meId = this.state.auth.currentUserId;
    const prevSession = this.state.voice.sessionId || `${meId}:${this.state.voice.connectedChannelId}`;

    CallSounds.stopRinging();
    clearTimeout(this.dmRingTimeout);
    VAD.stop();
    if (this.localAudioStream) {
      for (const t of this.localAudioStream.getTracks()) {
        try {
          t.stop();
        } catch (_) {}
      }
      this.localAudioStream = null;
    }

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

  async setVoiceSpeaking(speaking) {
    if (speaking && this.state.voice.muted) {
      this.state.voice.muted = false;
    }
    const isSpk = Boolean(speaking) && !this.state.voice.deafened;
    this.state.voice.isSpeaking = isSpk;
    const meId = this.state.auth.currentUserId;
    if (!this.state.voice.speakingUsers) this.state.voice.speakingUsers = {};
    this.state.voice.speakingUsers[meId] = isSpk;
    this.notify({ skipPersist: true });
    if (this.state.voice.connectedChannelId) {
      await NativeBridge.rpc("setVoiceSpeaking", {
        channelId: this.state.voice.connectedChannelId,
        userId: meId,
        speaking: isSpk
      });
    }
  }

  toggleMute() {
    this.state.voice.muted = !this.state.voice.muted;
    if (!this.state.voice.muted && this.state.voice.deafened) {
      this.state.voice.deafened = false;
    }
    const soundType = this.state.voice.muted ? "mute" : "unmute";
    CallSounds.play(soundType, this.state.settings);
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
    this.state.voice.deafened = !this.state.voice.deafened;
    if (this.state.voice.deafened) {
      this.state.voice.muted = true;
      CallSounds.play("mute", this.state.settings);
      if (this.state.voice.isSpeaking) {
        this.setVoiceSpeaking(false);
      }
    } else {
      CallSounds.play("unmute", this.state.settings);
    }
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

  async startScreenShare(sourceId, { sourceName = "Screen", resolution = "720p", fps = 15 } = {}) {
    if (!this.state.voice.connectedChannelId) {
      return { ok: false, error: "Conecte-se a um canal de voz antes de compartilhar a tela." };
    }
    const meId = this.state.auth.currentUserId;
    const guildId = this.state.voice.connectedGuildId;
    const channelId = this.state.voice.connectedChannelId;

    ScreenShare.onTrackEnded = () => {
      this.stopScreenShare();
    };

    ScreenShare.onFrame = (frameDataUrl) => {
      if (!this.state.voice.screenShareEnabled) return;
      if (this.state.screenShares[channelId]) {
        this.state.screenShares[channelId].frameDataUrl = frameDataUrl;
      }
      NativeBridge.rpc("broadcastScreenFrame", {
        userId: meId,
        channelId,
        frameDataUrl
      });
    };

    const cap = await ScreenShare.startCapture(sourceId, {
      width: resolution === "1080p" ? 1920 : 1280,
      height: resolution === "1080p" ? 1080 : 720,
      frameRate: fps
    });

    if (!cap.ok) {
      return cap;
    }

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
      this.state.screenShares[channelId] = res.share;
    }
    this.notify();
    return { ok: true, stream: cap.stream, trackCount: ScreenShare.getActiveTrackCount(), fps: Number(fps) || 15, resolution };
  }

  async stopScreenShare() {
    const meId = this.state.auth.currentUserId;
    const channelId = this.state.voice.connectedChannelId;
    ScreenShare.stopCapture();
    this.state.voice.screenShareEnabled = false;
    this.state.voice.screenShareSourceId = null;
    this.state.voice.screenShareSourceName = null;
    if (channelId) {
      delete this.state.screenShares[channelId];
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
    if (!text && !options.attachment) return null;

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
      attachment: options.attachment || null
    });

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
  async searchGifs({ query = "", category = "All", limit = GIF_PAGE_SIZE, offset = 0 } = {}) {
    const requestId = ++this.gifRequestSeq;
    this.state.gifPicker.loading = true;
    this.state.gifPicker.loadingMore = false;
    this.notify({ skipPersist: true });
    const res = await NativeBridge.rpc("searchGifs", { query, category, limit, offset });
    if (requestId !== this.gifRequestSeq) return res; // a newer search replaced this one
    this.state.gifPicker.loading = false;
    if (res.ok) {
      const gifs = res.gifs || [];
      this.state.gifPicker.results = gifs;
      this.state.gifPicker.total = res.total || 0;
      this.state.gifPicker.offset = offset + gifs.length;
      this.state.gifPicker.hasMore = gifs.length > 0 && this.state.gifPicker.offset < Math.min(res.total || 0, GIF_MAX_OFFSET);
      this.state.gifPicker.categories = res.categories || [];
      this.state.gifPicker.query = query;
      this.state.gifPicker.category = category;
    }
    this.notify({ skipPersist: true });
    return res;
  }

  // Infinite scroll: fetch the next page of the current search and append it.
  async loadMoreGifs() {
    const gp = this.state.gifPicker;
    if (!gp.isOpen || gp.loading || gp.loadingMore || !gp.hasMore) return;
    const requestId = this.gifRequestSeq;
    gp.loadingMore = true;
    this.notify({ skipPersist: true });
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
    } else {
      gp.hasMore = false;
    }
    this.notify({ skipPersist: true });
  }

  openGifPicker(target = "avatar") {
    this.state.gifPicker.isOpen = true;
    this.state.gifPicker.target = target;
    this.state.gifPicker.query = "";
    this.state.gifPicker.category = "All";
    this.notify({ skipPersist: true });
    this.searchGifs({ category: "All" });
  }

  closeGifPicker() {
    this.gifRequestSeq++; // discard any in-flight page for the closed picker
    this.state.gifPicker.isOpen = false;
    this.state.gifPicker.loading = false;
    this.state.gifPicker.loadingMore = false;
    this.notify({ skipPersist: true });
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
    this.notify({ skipPersist: true });
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
