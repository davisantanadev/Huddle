// ==========================================================================
// Discord Native, Backend SQLite RPC, Call Audio & WebRTC Screen Share Layer
// ==========================================================================

export const IntegrationMetadata = {
  observedEndpoints: {
    webappEndpoint: "https://discord.com",
    webappPaths: { APP: "/app", CONFERENCE_MODE: "/conference-mode" },
    updaterEndpoint: "https://discord.com/api/updates/",
    releaseChannel: "stable",
    hostVersion: "1.0.9262"
  },
  mode:
    typeof window !== "undefined" && window.DiscordNative
      ? "ELECTRON_NATIVE_IPC + SQLITE_BACKEND_SERVER"
      : "HTTP_RPC + SQLITE_BACKEND_SERVER"
};

export const NativeBridge = {
  isElectron() {
    return typeof window !== "undefined" && Boolean(window.DiscordNative);
  },

  getBackendInfo() {
    // Fixed for the app's lifetime: ask the main process once
    if (this.backendInfo) return this.backendInfo;
    if (this.isElectron() && window.DiscordNative.backend?.getInfoSync) {
      this.backendInfo = window.DiscordNative.backend.getInfoSync() || {};
      return this.backendInfo;
    }
    if (typeof window !== "undefined" && window.__DISCORD_BACKEND_URL__) {
      return { httpUrl: window.__DISCORD_BACKEND_URL__ };
    }
    return {};
  },

  // Saved login (session + accounts on this device). In Electron it lives in a
  // file owned by the main process; in a plain browser it falls back to localStorage.
  readAuthStore() {
    try {
      if (this.isElectron() && window.DiscordNative.authStore) return window.DiscordNative.authStore.get();
      return JSON.parse(localStorage.getItem("eco_auth_store_v1") || "null");
    } catch (_) {
      return null;
    }
  },

  writeAuthStore(data) {
    try {
      if (this.isElectron() && window.DiscordNative.authStore) return window.DiscordNative.authStore.set(data);
      localStorage.setItem("eco_auth_store_v1", JSON.stringify(data));
      return true;
    } catch (_) {
      return false;
    }
  },

  // Session token of the logged-in account; sent with every RPC and the event stream
  sessionToken: null,

  setSessionToken(token) {
    this.sessionToken = token || null;
  },

  // Raw call with an explicit token and no session side effects (used to probe
  // saved accounts' sessions without signing the current one out)
  async rpcAs(token, action, params = {}) {
    // Local backend: Electron IPC. Hosted server (remote): HTTPS below.
    if (this.isElectron() && window.DiscordNative.backend?.rpc && !this.getBackendInfo().remote) {
      return window.DiscordNative.backend.rpc(action, params, token);
    }
    const info = this.getBackendInfo();
    const baseUrl = info.httpUrl || info.url || (typeof window !== "undefined" ? window.location.origin : "");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const httpRes = await fetch(`${baseUrl}/api/rpc`, { method: "POST", headers, body: JSON.stringify({ action, params }) });
    return httpRes.json();
  },

  async rpc(action, params = {}) {
    const res = await this.rpcAs(this.sessionToken, action, params);
    if (res && res.code === "UNAUTHENTICATED" && typeof this.onUnauthenticated === "function") {
      this.onUnauthenticated();
    }
    if (res && res.code === "EMAIL_NOT_VERIFIED" && typeof this.onEmailNotVerified === "function") {
      this.onEmailNotVerified();
    }
    return res;
  },

  connectEventStream(onEvent) {
    const info = this.getBackendInfo();
    const baseUrl =
      info.httpUrl ||
      info.url ||
      (typeof window !== "undefined" && window.location.protocol.startsWith("http") ? window.location.origin : null);
    if (!baseUrl || typeof EventSource === "undefined") {
      return () => {};
    }
    if (!this.sessionToken) {
      return () => {};
    }
    const es = new EventSource(`${baseUrl}/api/events?token=${encodeURIComponent(this.sessionToken)}`);
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed && onEvent) onEvent(parsed);
      } catch (_) {}
    };
    return () => {
      try {
        es.close();
      } catch (_) {}
    };
  },

  minimizeWindow() {
    if (this.isElectron()) window.DiscordNative.window.minimize();
  },

  maximizeWindow() {
    if (this.isElectron()) window.DiscordNative.window.maximize();
  },

  closeWindow() {
    if (this.isElectron()) window.DiscordNative.window.close();
  },

  copyText(text) {
    if (this.isElectron()) {
      window.DiscordNative.clipboard.copy(String(text));
      return true;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).catch(() => {});
      return true;
    }
    return false;
  },

  setBadgeCount(count) {
    if (this.isElectron() && window.DiscordNative.app?.setBadgeCount) {
      window.DiscordNative.app.setBadgeCount(count);
    }
  },

  saveCache(data) {
    if (this.isElectron() && window.DiscordNative.userDataCache) {
      window.DiscordNative.userDataCache.cacheUserData(data);
    }
  },

  setSetting(key, value) {
    if (this.isElectron() && window.DiscordNative.settings) {
      window.DiscordNative.settings.set(key, value);
    }
  },

  getGpuAcceleration() {
    if (this.isElectron() && window.DiscordNative.gpuSettings) return window.DiscordNative.gpuSettings.getEnableHardwareAcceleration();
    return false;
  },

  setGpuAcceleration(enabled) {
    if (this.isElectron() && window.DiscordNative.gpuSettings) window.DiscordNative.gpuSettings.setEnableHardwareAcceleration(Boolean(enabled));
  },

  getOpenOnStartup() {
    if (this.isElectron() && window.DiscordNative.startup) return window.DiscordNative.startup.getOpenOnStartup();
    return false;
  },

  setOpenOnStartup(enabled) {
    if (this.isElectron() && window.DiscordNative.startup) return window.DiscordNative.startup.setOpenOnStartup(enabled);
    return false;
  },

  updateBackgroundColor(color) {
    if (this.isElectron() && window.DiscordNative.settings?.updateBackgroundColor) {
      window.DiscordNative.settings.updateBackgroundColor(color);
    }
  },

  getSettingSync(key, defaultValue) {
    if (this.isElectron() && window.DiscordNative.settings?.getSync) {
      return window.DiscordNative.settings.getSync(key, defaultValue);
    }
    return defaultValue;
  },

  // While in a call or sharing, the main process must not page our memory out
  setMediaSessionActive(active) {
    if (this.isElectron()) window.DiscordNative.desktopCapture?.setMediaSessionActive?.(active);
  },

  async purgeMemory() {
    if (this.isElectron() && window.DiscordNative.processUtils?.purgeMemory) {
      return window.DiscordNative.processUtils.purgeMemory();
    }
    return { ok: true };
  },

  subscribeIpc(channel, handler) {
    if (this.isElectron() && window.DiscordNative.ipc?.on) {
      return window.DiscordNative.ipc.on(channel, handler);
    }
    return () => {};
  }
};

// ==========================================================================
// Phase 6 & 7: Call Join, Leave, Mute & Unmute Audio Engine & Devices
// ==========================================================================
// Paths are relative to src/index.html (loaded via file://), so they must climb
// out of src/. Mute/unmute have no recorded asset and use the synthesized tones below.
export const AUDIO_ASSETS = {
  join: "../assets/audio/entrar-na-call.mp3", // discord-join: server voice join & answered DM call
  leave: "../assets/audio/discord-leave-noise.mp3", // played when you or someone else leaves the call
  ringtone: "../assets/audio/ligando.mp3", // SomLigandoPraAlguemDiscord: loops while a DM call rings (DMs only)
  notification: "../assets/audio/notificacao.mp3"
};

export const SOUND_PRESETS = {
  join: [
    { id: "discord-default", label: "Discord Padrão (Clássico)" },
    { id: "chime-crystal", label: "Cristal Harmônico" },
    { id: "synth-pulse", label: "Pulso Synthwave" },
    { id: "soft-pop", label: "Pop Suave Minimalista" },
    { id: "retro-8bit", label: "Arcade 8-Bit" },
    { id: "custom", label: "Arquivo de Áudio Personalizado" }
  ],
  leave: [
    { id: "discord-default", label: "Discord Padrão (Clássico)" },
    { id: "chime-crystal", label: "Cristal Harmônico" },
    { id: "synth-pulse", label: "Pulso Synthwave" },
    { id: "soft-pop", label: "Pop Suave Minimalista" },
    { id: "retro-8bit", label: "Arcade 8-Bit" },
    { id: "custom", label: "Arquivo de Áudio Personalizado" }
  ],
  mute: [
    { id: "discord-default", label: "Discord Padrão (Silenciar Microfone)" },
    { id: "chime-crystal", label: "Cristal Mudo" },
    { id: "synth-pulse", label: "Pulso Baixo" },
    { id: "soft-pop", label: "Pop Silencioso" },
    { id: "retro-8bit", label: "Arcade Mute" },
    { id: "custom", label: "Arquivo de Áudio Personalizado" }
  ],
  unmute: [
    { id: "discord-default", label: "Discord Padrão (Ativar Microfone)" },
    { id: "chime-crystal", label: "Cristal Brilho" },
    { id: "synth-pulse", label: "Pulso Alto" },
    { id: "soft-pop", label: "Pop Aberto" },
    { id: "retro-8bit", label: "Arcade Unmute" },
    { id: "custom", label: "Arquivo de Áudio Personalizado" }
  ]
};

export class CallAudioEngine {
  constructor() {
    this.activeSessionKey = null;
    this.lastPlayedJoinKey = null;
    this.lastPlayedLeaveKey = null;
    this.lastMuteToggleTime = 0;
    this.lastPlayedEvent = null;
    this.audioCtx = null;
    this.activeHtmlAudio = null;
    this.ringAudio = null;
  }

  getContext() {
    if (!this.audioCtx || this.audioCtx.state === "closed") {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.audioCtx = new Ctx();
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  synthesizePreset(presetId, type = "join", volumeScalar = 0.8) {
    try {
      const ctx = this.getContext();
      if (!ctx) return true;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      const clampedVol = Math.max(0.01, Math.min(1, Number(volumeScalar) || 0.8)) * 0.35;
      gain.gain.setValueAtTime(clampedVol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      gain.connect(ctx.destination);

      const playNote = (freq, startOffset, duration, wave = "sine") => {
        const osc = ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, now + startOffset);
        osc.connect(gain);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + duration);
      };

      const isLeave = type === "leave";
      const isMute = type === "mute";
      const isUnmute = type === "unmute";

      if (isMute) {
        playNote(392.0, 0, 0.09, "sine");
        playNote(261.63, 0.07, 0.16, "sine");
        return true;
      }
      if (isUnmute) {
        playNote(261.63, 0, 0.09, "sine");
        playNote(392.0, 0.07, 0.16, "sine");
        return true;
      }

      switch (presetId) {
        case "discord-default":
        case "classic_chime":
        case "classic_leave":
          if (isLeave) {
            playNote(783.99, 0, 0.11, "sine");
            playNote(523.25, 0.09, 0.19, "sine");
          } else {
            playNote(587.33, 0, 0.11, "sine");
            playNote(880.0, 0.09, 0.18, "sine");
          }
          break;
        case "chime-crystal":
        case "crystal_synth":
        case "crystal_fade":
          if (isLeave) {
            playNote(880.0, 0, 0.09, "triangle");
            playNote(659.25, 0.07, 0.09, "triangle");
            playNote(440.0, 0.14, 0.16, "sine");
          } else {
            playNote(523.25, 0, 0.09, "triangle");
            playNote(659.25, 0.07, 0.09, "triangle");
            playNote(1046.5, 0.14, 0.16, "sine");
          }
          break;
        case "synth-pulse":
        case "warm_marimba":
        case "warm_low":
          if (isLeave) {
            playNote(493.88, 0, 0.12, "sine");
            playNote(329.63, 0.08, 0.18, "triangle");
          } else {
            playNote(392.0, 0, 0.12, "sine");
            playNote(587.33, 0.08, 0.18, "triangle");
          }
          break;
        case "soft-pop":
        case "soft_pop":
        case "soft_drop":
          if (isLeave) {
            playNote(587.33, 0, 0.1, "triangle");
            playNote(392.0, 0.08, 0.16, "sine");
          } else {
            playNote(440.0, 0, 0.08, "triangle");
            playNote(659.25, 0.06, 0.14, "sine");
          }
          break;
        case "retro-8bit":
        case "minimal_click":
        case "minimal_off":
          playNote(isLeave ? 420.0 : 840.0, 0, 0.08, "square");
          break;
        default:
          playNote(isLeave ? 500.0 : 700.0, 0, 0.14, "sine");
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  async play(type, prefs = {}, sessionKey = null, options = {}) {
    const now = Date.now();
    if (!options.force && (type === "mute" || type === "unmute")) {
      if (now - this.lastMuteToggleTime < 200) {
        return { played: false, reason: "debounced" };
      }
      this.lastMuteToggleTime = now;
    }

    if (!options.force && sessionKey) {
      if (type === "join") {
        if (this.lastPlayedJoinKey === sessionKey) {
          return { played: false, reason: "already_played_for_session" };
        }
        this.lastPlayedJoinKey = sessionKey;
      } else if (type === "leave") {
        if (this.lastPlayedLeaveKey === sessionKey) {
          return { played: false, reason: "already_played_for_session" };
        }
        this.lastPlayedLeaveKey = sessionKey;
      }
    }
    return this.playSoundInternal(type, prefs);
  }

  async playSoundInternal(type, prefs = {}) {
    const isJoin = type === "join";
    const isLeave = type === "leave";
    const isMute = type === "mute";
    const isUnmute = type === "unmute";

    let enabled = true;
    if (isJoin) enabled = prefs.joinSoundEnabled !== false && prefs.callJoinSoundEnabled !== false;
    else if (isLeave) enabled = prefs.leaveSoundEnabled !== false && prefs.callLeaveSoundEnabled !== false;
    else if (isMute) enabled = prefs.muteSoundEnabled !== false && prefs.callMuteSoundEnabled !== false;
    else if (isUnmute) enabled = prefs.unmuteSoundEnabled !== false && prefs.callUnmuteSoundEnabled !== false;

    if (!enabled) return { played: false, reason: "disabled" };

    const volumeScalar = Math.max(0, Math.min(100, Number(prefs.callSoundVolume ?? 80))) / 100;
    if (volumeScalar === 0) return { played: false, reason: "muted_volume" };

    let preset = "discord-default";
    let customUrl = "";
    if (isJoin) {
      preset = prefs.joinSoundPreset || prefs.callJoinSoundPreset || "discord-default";
      customUrl = prefs.joinSoundCustomUrl || prefs.callJoinCustomUrl;
    } else if (isLeave) {
      preset = prefs.leaveSoundPreset || prefs.callLeaveSoundPreset || "discord-default";
      customUrl = prefs.leaveSoundCustomUrl || prefs.callLeaveCustomUrl;
    } else if (isMute) {
      preset = prefs.muteSoundPreset || prefs.callMuteSoundPreset || "discord-default";
      customUrl = prefs.muteSoundCustomUrl || prefs.callMuteCustomUrl;
    } else if (isUnmute) {
      preset = prefs.unmuteSoundPreset || prefs.callUnmuteSoundPreset || "discord-default";
      customUrl = prefs.unmuteSoundCustomUrl || prefs.callUnmuteCustomUrl;
    }

    if (preset === "custom" && customUrl) {
      try {
        if (this.activeHtmlAudio) {
          this.activeHtmlAudio.pause();
          this.activeHtmlAudio.src = "";
          this.activeHtmlAudio = null;
        }
        const audio = new Audio(customUrl);
        audio.volume = volumeScalar;
        this.activeHtmlAudio = audio;
        await audio.play();
        this.lastPlayedEvent = { type, preset: "custom", timestamp: Date.now() };
        return { played: true, preset: "custom" };
      } catch (_) {
        const fallback = "discord-default";
        this.synthesizePreset(fallback, type, volumeScalar);
        this.lastPlayedEvent = { type, preset: fallback, fallbackFromCustom: true, timestamp: Date.now() };
        return { played: true, preset: fallback, fallbackFromCustom: true };
      }
    }

    // For discord-default, try playing authentic audio asset, with synthesize fallback
    if (preset === "discord-default" && AUDIO_ASSETS[type]) {
      try {
        if (this.activeHtmlAudio) {
          this.activeHtmlAudio.pause();
          this.activeHtmlAudio.src = "";
          this.activeHtmlAudio = null;
        }
        const audio = new Audio(AUDIO_ASSETS[type]);
        audio.volume = volumeScalar;
        this.activeHtmlAudio = audio;
        await audio.play();
        this.lastPlayedEvent = { type, preset: "discord-default", file: AUDIO_ASSETS[type], timestamp: Date.now() };
        return { played: true, preset: "discord-default" };
      } catch (_) {
        // Fallback to Web Audio oscillator synthesis
      }
    }

    const ok = this.synthesizePreset(preset, type, volumeScalar);
    this.lastPlayedEvent = { type, preset, timestamp: Date.now() };
    return { played: ok, preset };
  }

  async onCallJoinConfirmed(guildId, channelId, prefs) {
    const key = `${guildId}::${channelId}`;
    if (this.activeSessionKey === key) {
      return { played: false, reason: "already_in_session" };
    }
    this.activeSessionKey = key;
    return this.playSoundInternal("join", prefs || {});
  }

  async onCallLeaveConfirmed(prefs) {
    if (!this.activeSessionKey) {
      return { played: false, reason: "not_in_session" };
    }
    this.activeSessionKey = null;
    return this.playSoundInternal("leave", prefs || {});
  }

  // Looping "calling someone" tone; uses its own element so one-shot sounds don't cut it
  startRinging(prefs = {}) {
    this.stopRinging();
    const volumeScalar = Math.max(0, Math.min(100, Number(prefs.callSoundVolume ?? 80))) / 100;
    const audio = new Audio(AUDIO_ASSETS.ringtone);
    audio.loop = true;
    audio.volume = volumeScalar;
    this.ringAudio = audio;
    audio
      .play()
      .then(() => {
        this.lastPlayedEvent = { type: "ringtone", file: AUDIO_ASSETS.ringtone, timestamp: Date.now() };
      })
      .catch(() => {});
  }

  stopRinging() {
    if (!this.ringAudio) return;
    this.ringAudio.pause();
    this.ringAudio.src = "";
    this.ringAudio = null;
  }

  isRinging() {
    return Boolean(this.ringAudio);
  }

  playNotification(prefs = {}) {
    const volumeScalar = Math.max(0, Math.min(100, Number(prefs.callSoundVolume ?? 80))) / 100;
    if (volumeScalar === 0) return { played: false, reason: "muted_volume" };
    const audio = new Audio(AUDIO_ASSETS.notification);
    audio.volume = volumeScalar;
    audio
      .play()
      .then(() => {
        this.lastPlayedEvent = { type: "notification", file: AUDIO_ASSETS.notification, timestamp: Date.now() };
      })
      .catch(() => {});
    return { played: true };
  }

  async preview(type, preset, customUrl, volume = 80) {
    return this.playSoundInternal(type, {
      joinSoundEnabled: true,
      leaveSoundEnabled: true,
      muteSoundEnabled: true,
      unmuteSoundEnabled: true,
      joinSoundPreset: preset,
      leaveSoundPreset: preset,
      muteSoundPreset: preset,
      unmuteSoundPreset: preset,
      joinSoundCustomUrl: customUrl,
      leaveSoundCustomUrl: customUrl,
      muteSoundCustomUrl: customUrl,
      unmuteSoundCustomUrl: customUrl,
      callSoundVolume: volume
    });
  }
}

export const CallSounds = new CallAudioEngine();

// ==========================================================================
// Phase 7: Real Audio Device Enumeration, Mic Test & Live Level Meter
// ==========================================================================
class VoiceDeviceManager {
  constructor() {
    this.activeMicStream = null;
    this.micTestCtx = null;
    this.micTestTimer = null;
  }

  async enumerateDevices() {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
        return {
          inputDevices: [{ deviceId: "default", label: "Microfone Padrão do Sistema (Realtek Audio)" }],
          outputDevices: [{ deviceId: "default", label: "Alto-falantes / Fones Padrão (Realtek Audio)" }]
        };
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputDevices = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId || `input-${i}`,
          label: d.label || (i === 0 ? "Microfone Padrão do Sistema" : `Microfone ${i + 1}`)
        }));
      const outputDevices = devices
        .filter((d) => d.kind === "audiooutput")
        .map((d, i) => ({
          deviceId: d.deviceId || `output-${i}`,
          label: d.label || (i === 0 ? "Alto-falantes / Fones Padrão" : `Dispositivo de Saída ${i + 1}`)
        }));

      if (inputDevices.length === 0) {
        inputDevices.push({ deviceId: "default", label: "Microfone Padrão do Sistema" });
      }
      if (outputDevices.length === 0) {
        outputDevices.push({ deviceId: "default", label: "Alto-falantes / Fones Padrão" });
      }

      return { inputDevices, outputDevices };
    } catch (_) {
      return {
        inputDevices: [{ deviceId: "default", label: "Microfone Padrão do Sistema" }],
        outputDevices: [{ deviceId: "default", label: "Alto-falantes / Fones Padrão" }]
      };
    }
  }

  async testOutput(deviceId, volume = 80) {
    const volScalar = Math.max(0, Math.min(100, Number(volume) || 80)) / 100;
    try {
      const audio = new Audio(AUDIO_ASSETS.join);
      audio.volume = volScalar;
      if (typeof audio.setSinkId === "function" && deviceId && deviceId !== "default") {
        await audio.setSinkId(deviceId).catch(() => {});
      }
      await audio.play().catch(() => {
        CallSounds.synthesizePreset("discord-default", "join", volScalar);
      });
      return { ok: true };
    } catch (_) {
      CallSounds.synthesizePreset("discord-default", "join", volScalar);
      return { ok: true };
    }
  }

  async startMicTest(deviceId, onLevel) {
    this.stopMicTest();
    try {
      const constraints = {
        audio: deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeMicStream = stream;

      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return { ok: false, error: "AudioContext indisponível" };
      const ctx = new Ctx();
      this.micTestCtx = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.micTestTimer = setInterval(() => {
        if (!this.micTestCtx || !this.activeMicStream) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        if (typeof onLevel === "function") {
          onLevel(level);
        }
      }, 50);

      return { ok: true };
    } catch (err) {
      this.stopMicTest();
      // In headless test or virtual environments without audio hardware, run simulated meter
      let simLevel = 10;
      let goingUp = true;
      this.micTestTimer = setInterval(() => {
        if (goingUp) {
          simLevel += 8;
          if (simLevel >= 65) goingUp = false;
        } else {
          simLevel -= 6;
          if (simLevel <= 10) goingUp = true;
        }
        if (typeof onLevel === "function") {
          onLevel(simLevel);
        }
      }, 50);
      return { ok: true, simulated: true };
    }
  }

  stopMicTest() {
    if (this.micTestTimer) {
      clearInterval(this.micTestTimer);
      this.micTestTimer = null;
    }
    if (this.activeMicStream) {
      for (const track of this.activeMicStream.getTracks()) {
        try { track.stop(); } catch (_) {}
      }
      this.activeMicStream = null;
    }
    if (this.micTestCtx) {
      try { this.micTestCtx.close(); } catch (_) {}
      this.micTestCtx = null;
    }
  }
}

export const VoiceDevices = new VoiceDeviceManager();

// ==========================================================================
// Phase 8: Real-Time Voice Activity Detection (VAD)
// ==========================================================================
class VoiceActivityDetector {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.timer = null;
    this.isSpeaking = false;
    this.lastSpokeTime = 0;
    this.onSpeakingChange = null;
    this.threshold = 12; // Level threshold (0..100)
    this.holdTimeMs = 350;
  }

  start(stream, onSpeakingChange) {
    this.stop();
    this.onSpeakingChange = onSpeakingChange;
    this.stream = stream;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !stream) return;
      this.ctx = new Ctx();
      const source = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.timer = setInterval(() => {
        if (!this.stream || !this.ctx) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        const now = Date.now();

        if (level >= this.threshold) {
          this.lastSpokeTime = now;
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            if (typeof this.onSpeakingChange === "function") {
              this.onSpeakingChange(true);
            }
          }
        } else {
          if (this.isSpeaking && (now - this.lastSpokeTime > this.holdTimeMs)) {
            this.isSpeaking = false;
            if (typeof this.onSpeakingChange === "function") {
              this.onSpeakingChange(false);
            }
          }
        }
      }, 50);
    } catch (_) {}
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      try { this.ctx.close(); } catch (_) {}
      this.ctx = null;
    }
    this.stream = null;
    if (this.isSpeaking) {
      this.isSpeaking = false;
      if (typeof this.onSpeakingChange === "function") {
        this.onSpeakingChange(false);
      }
    }
  }
}

export const VAD = new VoiceActivityDetector();

// ==========================================================================
// Voice: WebRTC mesh
// ==========================================================================
// Every pair of people in a call holds one RTCPeerConnection carrying audio
// straight between their PCs (encrypted, DTLS-SRTP). The Eco server only
// relays the setup messages (RTC_SIGNAL, delivered to the target user alone);
// STUN finds a direct path, and the TURN relay (when the server provides one)
// covers networks where a direct path is impossible.
//
// To avoid both sides offering at once, the user with the smaller id always
// makes the offer; the other answers. Each connection has exactly one audio
// transceiver (created by the offerer, adopted by the answerer from the offer),
// so a microphone that arrives later or a device switch is attached with
// replaceTrack, without renegotiating.
class VoiceMesh {
  constructor() {
    this.channelId = null;
    this.meId = null;
    this.iceServers = [];
    this.localTrack = null;
    this.peers = new Map(); // userId -> { pc, audio, pendingCandidates, initiator, restartTimer }
    this.muted = false;
    this.deafened = false;
    this.outputDeviceId = "default";
    this.outputVolume = 1;
    this.sendSignal = null; // (targetUserId, signalType, signalData) => Promise
  }

  isActive() {
    return Boolean(this.channelId);
  }

  start({ channelId, meId, iceServers, sendSignal }) {
    this.stop();
    this.channelId = channelId;
    this.meId = meId;
    this.iceServers = iceServers || [];
    this.sendSignal = sendSignal;
  }

  // Microphone track to send (null = nothing yet)
  setLocalStream(stream) {
    this.localTrack = stream?.getAudioTracks()[0] || null;
    if (this.localTrack) this.localTrack.enabled = !this.muted && !this.deafened;
    for (const peer of this.peers.values()) {
      const sender = peer.pc.getTransceivers()[0]?.sender;
      if (sender) sender.replaceTrack(this.localTrack).catch(() => {});
    }
  }

  // Connect to people who joined, drop people who left
  syncParticipants(userIds) {
    if (!this.channelId) return;
    const others = new Set(userIds.filter((id) => id && id !== this.meId));
    for (const id of [...this.peers.keys()]) {
      if (!others.has(id)) this.closePeer(id);
    }
    for (const id of others) {
      if (!this.peers.has(id) && this.meId < id) this.createPeer(id, true);
    }
  }

  createPeer(userId, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    // The answerer must not add its own transceiver: the offer creates one, and
    // a second, unmatched transceiver would leave our microphone unsent
    if (initiator) {
      const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
      if (this.localTrack) transceiver.sender.replaceTrack(this.localTrack).catch(() => {});
    }

    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = this.deafened;
    audio.volume = this.outputVolume;
    this.applySink(audio);

    const peer = { pc, audio, pendingCandidates: [], initiator, restartTimer: null };
    this.peers.set(userId, peer);

    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      audio.play().catch(() => {});
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(userId, "ice", e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" && peer.initiator) this.restartIce(userId);
      // A brief network hiccup: try an ICE restart if it does not recover alone
      if (state === "disconnected" && peer.initiator) {
        clearTimeout(peer.restartTimer);
        peer.restartTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected") this.restartIce(userId);
        }, 4000);
      }
    };

    if (initiator) this.makeOffer(userId);
    return peer;
  }

  async makeOffer(userId, { iceRestart = false } = {}) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    try {
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(offer);
      this.signal(userId, "offer", { type: offer.type, sdp: offer.sdp });
    } catch (_) {}
  }

  restartIce(userId) {
    this.makeOffer(userId, { iceRestart: true });
  }

  async handleSignal({ fromUserId, signalType, signalData }) {
    if (!this.channelId || !fromUserId || fromUserId === this.meId) return;
    let peer = this.peers.get(fromUserId);
    try {
      if (signalType === "offer") {
        if (!peer) peer = this.createPeer(fromUserId, false);
        await peer.pc.setRemoteDescription(signalData);
        // Send our microphone on the audio transceiver the offer created
        const transceiver = peer.pc.getTransceivers()[0];
        if (transceiver) {
          transceiver.direction = "sendrecv";
          if (this.localTrack) await transceiver.sender.replaceTrack(this.localTrack).catch(() => {});
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.signal(fromUserId, "answer", { type: answer.type, sdp: answer.sdp });
        await this.flushCandidates(peer);
      } else if (signalType === "answer" && peer) {
        await peer.pc.setRemoteDescription(signalData);
        await this.flushCandidates(peer);
      } else if (signalType === "ice" && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signalData).catch(() => {});
        else peer.pendingCandidates.push(signalData);
      }
    } catch (_) {}
  }

  async flushCandidates(peer) {
    const queued = peer.pendingCandidates.splice(0);
    for (const c of queued) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  signal(targetUserId, signalType, signalData) {
    if (typeof this.sendSignal === "function") this.sendSignal(targetUserId, signalType, signalData);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.localTrack) this.localTrack.enabled = !this.muted && !this.deafened;
  }

  // Deafened: hear nobody and send nothing (like Discord)
  setDeafened(deafened) {
    this.deafened = Boolean(deafened);
    for (const peer of this.peers.values()) peer.audio.muted = this.deafened;
    if (this.localTrack) this.localTrack.enabled = !this.muted && !this.deafened;
  }

  setOutputDevice(deviceId) {
    this.outputDeviceId = deviceId || "default";
    for (const peer of this.peers.values()) this.applySink(peer.audio);
  }

  // 0–100 from the settings slider
  setOutputVolume(percent) {
    this.outputVolume = Math.max(0, Math.min(1, (Number(percent) || 0) / 100));
    for (const peer of this.peers.values()) peer.audio.volume = this.outputVolume;
  }

  applySink(audio) {
    if (typeof audio.setSinkId === "function") {
      audio.setSinkId(this.outputDeviceId === "default" ? "" : this.outputDeviceId).catch(() => {});
    }
  }

  // For diagnostics/tests: per-peer connection state and remote stream
  getPeerInfo() {
    return [...this.peers.entries()].map(([userId, peer]) => ({
      userId,
      state: peer.pc.connectionState,
      stream: peer.audio.srcObject || null
    }));
  }

  closePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    clearTimeout(peer.restartTimer);
    try {
      peer.pc.close();
    } catch (_) {}
    peer.audio.pause();
    peer.audio.srcObject = null;
    this.peers.delete(userId);
  }

  stop() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.channelId = null;
    this.localTrack = null;
    this.sendSignal = null;
  }
}

export const Voice = new VoiceMesh();

// ==========================================================================
// Phase 9: Screen Share
// ==========================================================================
// Real screen capture: the main process answers getDisplayMedia() with the
// source picked in our own picker (electron/screenCapture.js), so frames come
// straight from the GPU as a live MediaStream. The local preview plays that
// stream in one long-lived <video> (moved into the page on each render rather
// than recreated), and viewers get small, throttled JPEG snapshots.
const VIEWER_FRAME_INTERVAL_MS = 500; // ~2 snapshots/s for people watching
const VIEWER_FRAME_WIDTH = 640;

class ScreenShareManager {
  constructor() {
    this.localStream = null;
    this.previewVideo = null;
    this.snapshotCanvas = null;
    this.snapshotTimer = null;
    this.fpsTimer = null;
    this.framesThisSecond = 0;
    this.onTrackEnded = null;
    this.onFrame = null;
    this.stats = this.emptyStats();
  }

  emptyStats() {
    return { requestedFps: 0, capturedFps: 0, sentFps: 0, resolution: "", width: 0, height: 0 };
  }

  getStream() {
    return this.localStream;
  }

  getStats() {
    return { ...this.stats };
  }

  // The one <video> element showing our own stream; the UI mounts it where needed
  getPreviewElement() {
    return this.previewVideo;
  }

  async getSources() {
    return this.getAvailableSources();
  }

  // Every monitor and every open app window, with thumbnail and app icon
  async getAvailableSources() {
    if (NativeBridge.isElectron() && window.DiscordNative.desktopCapture?.getSources) {
      const sources = await window.DiscordNative.desktopCapture.getSources({ thumbnailSize: { width: 320, height: 180 } });
      return Array.isArray(sources) ? sources : [];
    }
    return [];
  }

  async startCapture(sourceId, { width = 1280, height = 720, frameRate = 30, includeAudio = false } = {}) {
    this.stopCapture();
    const fps = Number(frameRate) || 30;
    try {
      if (NativeBridge.isElectron() && window.DiscordNative.desktopCapture?.selectSource) {
        await window.DiscordNative.desktopCapture.selectSource(sourceId, includeAudio);
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { max: width },
          height: { max: height },
          frameRate: { ideal: fps, max: fps }
        },
        audio: Boolean(includeAudio)
      });

      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("A fonte escolhida não entregou vídeo.");
      track.contentHint = "motion";
      track.onended = () => {
        // The shared window was closed (or the screen disconnected)
        this.stopCapture();
        if (typeof this.onTrackEnded === "function") this.onTrackEnded();
      };

      this.localStream = stream;
      const settings = track.getSettings();
      this.stats = {
        requestedFps: fps,
        capturedFps: 0,
        sentFps: Math.round(1000 / VIEWER_FRAME_INTERVAL_MS),
        width: settings.width || 0,
        height: settings.height || 0,
        resolution: settings.width ? `${settings.width}x${settings.height}` : ""
      };

      const video = document.createElement("video");
      video.id = "local-screenshare-video";
      video.className = "screenshare-video";
      video.setAttribute("data-testid", "screenshare-video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      this.previewVideo = video;
      await video.play().catch(() => {});

      this.startFpsMeter(video);
      this.startViewerSnapshots(video);
      return { ok: true, stream, stats: this.getStats() };
    } catch (err) {
      this.stopCapture();
      if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) {
        return { ok: false, canceled: true, error: "A janela escolhida não está mais disponível. Escolha outra." };
      }
      return { ok: false, error: err?.message || "Falha ao capturar a tela." };
    }
  }

  // Counts frames actually delivered by the capture, once per second
  startFpsMeter(video) {
    if (typeof video.requestVideoFrameCallback !== "function") return;
    const onFrame = () => {
      if (this.previewVideo !== video) return;
      this.framesThisSecond++;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    this.fpsTimer = setInterval(() => {
      this.stats.capturedFps = this.framesThisSecond;
      this.framesThisSecond = 0;
      const s = this.localStream?.getVideoTracks()[0]?.getSettings();
      if (s?.width) {
        this.stats.width = s.width;
        this.stats.height = s.height;
        this.stats.resolution = `${s.width}x${s.height}`;
      }
    }, 1000);
  }

  // Small JPEG snapshots for the other people in the call (only when someone listens)
  startViewerSnapshots(video) {
    this.snapshotCanvas = document.createElement("canvas");
    const ctx = this.snapshotCanvas.getContext("2d", { alpha: false });
    this.snapshotTimer = setInterval(() => {
      if (typeof this.onFrame !== "function" || !video.videoWidth) return;
      const scale = Math.min(1, VIEWER_FRAME_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (this.snapshotCanvas.width !== w) this.snapshotCanvas.width = w;
      if (this.snapshotCanvas.height !== h) this.snapshotCanvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      this.onFrame(this.snapshotCanvas.toDataURL("image/jpeg", 0.7));
    }, VIEWER_FRAME_INTERVAL_MS);
  }

  stopCapture() {
    clearInterval(this.snapshotTimer);
    clearInterval(this.fpsTimer);
    this.snapshotTimer = null;
    this.fpsTimer = null;
    this.framesThisSecond = 0;
    this.snapshotCanvas = null;

    if (this.previewVideo) {
      try {
        this.previewVideo.pause();
        this.previewVideo.srcObject = null;
        this.previewVideo.remove();
      } catch (_) {}
      this.previewVideo = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.onended = null;
          track.stop();
        } catch (_) {}
      }
      this.localStream = null;
    }
    this.stats = this.emptyStats();
  }

  getActiveTrackCount() {
    if (!this.localStream) return 0;
    return this.localStream.getTracks().filter((t) => t.readyState === "live").length;
  }
}

export const ScreenShare = new ScreenShareManager();
