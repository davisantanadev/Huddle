"use strict";

const { contextBridge, ipcRenderer, webFrame } = require("electron");

const DISCORD_NAMESPACE = "DISCORD_";

const DiscordNative = {
  isRenderer: process.type === "renderer",
  process: {
    platform: process.platform,
    arch: process.arch,
    env: {
      NODE_ENV: process.env.NODE_ENV || "production"
    }
  },
  os: {
    arch: process.arch,
    release: process.getSystemVersion ? process.getSystemVersion() : "10.0.26200"
  },
  app: {
    getReleaseChannel: () => ipcRenderer.sendSync("DISCORD_APP_GET_RELEASE_CHANNEL_SYNC"),
    getVersion: () => ipcRenderer.sendSync("DISCORD_APP_GET_HOST_VERSION_SYNC"),
    getBuildNumber: () => 348291,
    getArch: () => process.arch,
    setBadgeCount: (count) => ipcRenderer.invoke("DISCORD_APP_SET_BADGE_COUNT", count),
    checkForUpdates: () => ipcRenderer.invoke("DISCORD_UPDATE_CHECK"),
    installUpdate: () => ipcRenderer.invoke("DISCORD_UPDATE_INSTALL"),
    // Interface size (everything: text, icons, spacing); remembered in settings.json
    setZoomFactor: (factor) => {
      const f = Math.min(1.75, Math.max(0.7, Number(factor) || 1));
      webFrame.setZoomFactor(f);
      ipcRenderer.invoke("DISCORD_SETTINGS_SET", "UI_ZOOM", f);
      return f;
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
    relaunch: () => ipcRenderer.send("DISCORD_APP_RELAUNCH")
  },
  window: {
    minimize: () => ipcRenderer.send("DISCORD_WINDOW_MINIMIZE"),
    maximize: () => ipcRenderer.send("DISCORD_WINDOW_MAXIMIZE"),
    restore: () => ipcRenderer.send("DISCORD_WINDOW_RESTORE"),
    close: () => ipcRenderer.send("DISCORD_WINDOW_CLOSE"),
    focus: () => ipcRenderer.send("DISCORD_WINDOW_FOCUS"),
    blur: () => ipcRenderer.send("DISCORD_WINDOW_BLUR"),
    flashFrame: (flag) => ipcRenderer.send("DISCORD_WINDOW_FLASH_FRAME", flag),
    toggleFullscreen: () => ipcRenderer.send("DISCORD_WINDOW_TOGGLE_FULLSCREEN"),
    isAlwaysOnTop: () => ipcRenderer.invoke("DISCORD_WINDOW_IS_ALWAYS_ON_TOP"),
    setAlwaysOnTop: (enabled) => ipcRenderer.invoke("DISCORD_WINDOW_SET_ALWAYS_ON_TOP", enabled)
  },
  clipboard: {
    copy: (text) => ipcRenderer.send("DISCORD_CLIPBOARD_COPY", text),
    readText: () => ipcRenderer.sendSync("DISCORD_CLIPBOARD_READ_TEXT")
  },
  settings: {
    get: (key, defaultValue) => ipcRenderer.invoke("DISCORD_SETTINGS_GET", key, defaultValue),
    set: (key, value) => ipcRenderer.invoke("DISCORD_SETTINGS_SET", key, value),
    getSync: (key, defaultValue) => ipcRenderer.sendSync("DISCORD_SETTINGS_GET_SYNC", key, defaultValue),
    downloadUrl: (url) => ipcRenderer.send("DISCORD_DOWNLOAD_URL", url),
    updateBackgroundColor: (color) => ipcRenderer.send("DISCORD_SETTINGS_UPDATE_BACKGROUND_COLOR", color)
  },
  userDataCache: {
    getCached: () => ipcRenderer.invoke("DISCORD_USER_DATA_CACHE_GET"),
    cacheUserData: (data) => ipcRenderer.send("DISCORD_USER_DATA_CACHE_SAVE", data),
    deleteCache: () => ipcRenderer.send("DISCORD_USER_DATA_CACHE_DELETE")
  },
  fileManager: {
    showOpenDialog: (options) => ipcRenderer.invoke("DISCORD_FILE_MANAGER_SHOW_OPEN_DIALOG", options),
    showSaveDialog: (options) => ipcRenderer.invoke("DISCORD_FILE_MANAGER_SHOW_SAVE_DIALOG", options)
  },
  gpuSettings: {
    getEnableHardwareAcceleration: () => ipcRenderer.sendSync("DISCORD_GPU_SETTINGS_GET_ENABLE_HWACCEL_SYNC"),
    setEnableHardwareAcceleration: (enabled) => ipcRenderer.send("DISCORD_GPU_SETTINGS_SET_ENABLE_HWACCEL", enabled)
  },
  desktopCapture: {
    getSources: (options) => ipcRenderer.invoke("DISCORD_DESKTOP_CAPTURER_GET_SOURCES", options),
    selectSource: (sourceId, includeAudio) =>
      ipcRenderer.invoke("DISCORD_DESKTOP_CAPTURER_SELECT_SOURCE", { sourceId, includeAudio }),
    setMediaSessionActive: (active) => ipcRenderer.send("DISCORD_MEDIA_SESSION", Boolean(active))
  },
  startup: {
    getOpenOnStartup: () => ipcRenderer.sendSync("DISCORD_APP_GET_OPEN_ON_STARTUP_SYNC"),
    setOpenOnStartup: (enabled) => ipcRenderer.sendSync("DISCORD_APP_SET_OPEN_ON_STARTUP_SYNC", Boolean(enabled))
  },
  authStore: {
    get: () => ipcRenderer.sendSync("DISCORD_AUTH_STORE_GET_SYNC"),
    set: (data) => ipcRenderer.sendSync("DISCORD_AUTH_STORE_SET_SYNC", data)
  },
  backend: {
    getInfo: () => ipcRenderer.sendSync("DISCORD_BACKEND_GET_INFO_SYNC"),
    getInfoSync: () => ipcRenderer.sendSync("DISCORD_BACKEND_GET_INFO_SYNC"),
    rpc: (action, params, sessionToken) => ipcRenderer.invoke("DISCORD_BACKEND_RPC", action, params, sessionToken)
  },
  processUtils: {
    purgeMemory: async () => {
      try {
        webFrame.clearCache();
        if (typeof window.gc === "function") window.gc();
      } catch (_) {}
      return ipcRenderer.invoke("DISCORD_MEMORY_OPTIMIZE");
    },
    getTaskManagerMemoryMB: () => ipcRenderer.invoke("DISCORD_MEMORY_GET_TASK_MANAGER_MB"),
    getMemoryStats: async () => {
      const procMem = await process.getProcessMemoryInfo();
      const mainStats = await ipcRenderer.invoke("DISCORD_MEMORY_GET_STATS");
      return {
        rendererPrivateKB: procMem.private,
        rendererSharedKB: procMem.shared,
        mainStats
      };
    }
  },
  ipc: {
    send: (channel, ...args) => {
      const fullChannel = channel.startsWith(DISCORD_NAMESPACE) ? channel : `${DISCORD_NAMESPACE}${channel}`;
      ipcRenderer.send(fullChannel, ...args);
    },
    invoke: (channel, ...args) => {
      const fullChannel = channel.startsWith(DISCORD_NAMESPACE) ? channel : `${DISCORD_NAMESPACE}${channel}`;
      return ipcRenderer.invoke(fullChannel, ...args);
    },
    on: (channel, callback) => {
      const fullChannel = channel.startsWith(DISCORD_NAMESPACE) ? channel : `${DISCORD_NAMESPACE}${channel}`;
      const wrapped = (_event, ...args) => callback(...args);
      ipcRenderer.on(fullChannel, wrapped);
      return () => ipcRenderer.removeListener(fullChannel, wrapped);
    }
  }
};

contextBridge.exposeInMainWorld("DiscordNative", DiscordNative);

// The interface size (UI_ZOOM) is applied by the main process once the window
// is up: setting it here, before the first paint, kept the window from ever
// being shown (stuck on the splash screen)
