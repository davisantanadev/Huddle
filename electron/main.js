"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  clipboard,
  dialog,
  screen,
  shell,
  desktopCapturer,
  session,
  powerMonitor,
  net
} = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { DiscordBackendServer } = require("./backendServer");
const { registerScreenCaptureHandlers } = require("./screenCapture");
const { loadAppConfig } = require("./appConfig");
const { startGameDetector } = require("./gameDetector");
const { prepareHelper, trimProcesses, isLightTrimAvailable } = require("./memTrimmer");

// productName "Discord" made Electron use %APPDATA%\discord, the official
// Discord client's folder: both apps then shared settings.json, caches and
// Local Storage. Use our own folder, copying (never moving) the data the app
// created in the shared one.
const SHARED_DISCORD_DATA_DIR = path.join(app.getPath("appData"), "discord");
// ECO_USER_DATA_DIR lets tests run against a throwaway profile
const APP_DATA_DIR = process.env.ECO_USER_DATA_DIR || path.join(app.getPath("appData"), "Eco");
const DB_FILE = "discord_platform_v2.sqlite";

function migrateFromSharedDiscordFolder() {
  if (fs.existsSync(path.join(APP_DATA_DIR, DB_FILE))) return;
  if (!fs.existsSync(path.join(SHARED_DISCORD_DATA_DIR, DB_FILE))) return;
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = path.join(SHARED_DISCORD_DATA_DIR, DB_FILE + suffix);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(APP_DATA_DIR, DB_FILE + suffix));
    }
    const uploads = path.join(SHARED_DISCORD_DATA_DIR, "uploads");
    if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(APP_DATA_DIR, "uploads"), { recursive: true });
  } catch (err) {
    console.error("Failed to copy data from the shared Discord folder:", err);
  }
}

app.setPath("userData", APP_DATA_DIR);
// Lets electron/appConfig.js find app.config.local.json (API keys) in the data
// folder, so keys never have to be packaged inside the executable
process.env.ECO_DATA_DIR = APP_DATA_DIR;
migrateFromSharedDiscordFolder();

// Phase 7: V8 & Chromium Memory Optimization Flags
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=64 --initial-old-space-size=4 --OptimizeForSize --expose-gc");
app.commandLine.appendSwitch("disable-site-isolation-trials");
// Audio and network services run inside the main process instead of two extra
// utility processes (measured: 105 MB -> 93 MB without trimming)
app.commandLine.appendSwitch(
  "disable-features",
  [
    "SpareRendererForSitePerProcess",
    "BackForwardCache",
    "Translate",
    "OptimizationHints",
    "MediaRouter",
    "CalculateNativeWinOcclusion",
    "AudioServiceOutOfProcess"
  ].join(",")
);
// Windows Graphics Capture for screens and windows: GPU capture, no GDI copies.
// Camera/screen capture runs inside the main process too (no extra utility process).
app.commandLine.appendSwitch(
  "enable-features",
  [
    "WebRtcAllowWgcScreenCapturer",
    "WebRtcAllowWgcWindowCapturer",
    "NetworkServiceInProcess2",
    "NetworkServiceInProcess",
    "RunVideoCaptureServiceInBrowserProcess"
  ].join(",")
);
// The GPU process is folded into the main one: the app shows as two processes
// (app + page) instead of three
app.commandLine.appendSwitch("in-process-gpu");
app.commandLine.appendSwitch("disk-cache-size", "16777216");
app.commandLine.appendSwitch("media-cache-size", "8388608");
// GPU acceleration is on by default: without it GIFs, video and screen shares
// are decoded and drawn on the CPU (choppy) and video can't be hardware-encoded.
// It can be turned off in Configurações > Windows & Memória (saves ~100 MB).
// Read straight from settings.json: it must be decided before the app is ready.
function isGpuAccelerationEnabled() {
  try {
    const p = path.join(APP_DATA_DIR, "settings.json");
    const value = JSON.parse(fs.readFileSync(p, "utf8")).GPU_ACCELERATION;
    return value === undefined ? true : Boolean(value);
  } catch (_) {
    return true;
  }
}
if (!isGpuAccelerationEnabled()) {
  app.disableHardwareAcceleration();
  // No SwiftShader: the compositor already rasterises on the CPU, and the GPU
  // process drops from ~12 MB to ~6 MB
  app.commandLine.appendSwitch("disable-software-rasterizer");
}

const BUILD_INFO = {
  releaseChannel: "stable",
  sentryDist: "stable-win-x64",
  sentryRelease: "discord-desktop-7e0a1fef1fc1295b33b9404e5b77f1ae39d0c6e0",
  version: app.getVersion()
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 940;
const MIN_HEIGHT = 500;
const DEFAULT_BACKGROUND_COLOR = "#313338";
const DISCORD_NAMESPACE = "DISCORD_";

let splashWindow = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
// Set when Windows starts the app at login (see applyOpenOnStartup)
let startHidden = process.argv.includes("--start-minimized");
let backendServer = null;
let remoteServerUrl = null;
// True while the user is in a call or sharing the screen (reported by the
// renderer). Then only the compiled helper is used (no PowerShell CPU spike,
// which made the stream and audio stutter) and the main-process GC is skipped.
let mediaSessionActive = false;
let lastTrimAt = 0;

// Emptying the working set makes every page fault back in on the next frame,
// which showed up as stutter in GIFs, video and screen shares. So it only runs
// while the app is out of sight (tray/minimized) and no call is going on.
function appInView() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
}

function trimProcessWorkingSets({ force = false } = {}) {
  if (!force && (mediaSessionActive || appInView())) return;
  const light = mediaSessionActive;
  if (light && !isLightTrimAvailable()) return;
  if (!light) {
    try {
      if (typeof global.gc === "function") global.gc();
    } catch (_) {}
  }
  const pids = app
    .getAppMetrics()
    .map((mt) => mt.pid)
    .filter(Boolean);
  if (trimProcesses(pids, { light })) lastTrimAt = Date.now();
}

const IDLE_TRIM_DELAY_MS = 15 * 1000;
const IDLE_TRIM_INTERVAL_MS = 90 * 1000;
let idleTrimTimer = null;

function scheduleIdleTrim() {
  if (idleTrimTimer) return;
  idleTrimTimer = setTimeout(function trimWhileIdle() {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) {
      idleTrimTimer = null;
      return;
    }
    try {
      mainWindow.webContents.session.clearCodeCaches({}).catch(() => {});
    } catch (_) {}
    trimProcessWorkingSets();
    idleTrimTimer = setTimeout(trimWhileIdle, IDLE_TRIM_INTERVAL_MS);
  }, IDLE_TRIM_DELAY_MS);
}

function cancelIdleTrim() {
  clearTimeout(idleTrimTimer);
  idleTrimTimer = null;
}

// Also once after a few minutes with nobody at the PC (and no call going on)
const SYSTEM_IDLE_TRIM_SECONDS = 5 * 60;
let systemIdleTrimmed = false;
function startSystemIdleWatch() {
  setInterval(() => {
    let idleSeconds = 0;
    try {
      idleSeconds = powerMonitor.getSystemIdleTime();
    } catch (_) {
      return;
    }
    if (idleSeconds >= SYSTEM_IDLE_TRIM_SECONDS && !systemIdleTrimmed && !mediaSessionActive) {
      systemIdleTrimmed = true;
      trimProcessWorkingSets({ force: true });
      return;
    }
    if (idleSeconds < SYSTEM_IDLE_TRIM_SECONDS) systemIdleTrimmed = false;
  }, 15 * 1000).unref();
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

// Saved login (session token + accounts used on this device). Kept by the main
// process and written synchronously, so it survives tray exits, crashes and
// Task Manager kills. Plain JSON in the user's profile folder: safeStorage was
// tried, but its key lives in Chromium's lazily written "Local State" file and
// is lost on a forced kill, which made the saved login unreadable.
function getAuthStorePath() {
  return path.join(app.getPath("userData"), "auth-store.json");
}

function readAuthStore() {
  try {
    const data = JSON.parse(fs.readFileSync(getAuthStorePath(), "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch (_) {
    return null;
  }
}

function writeAuthStore(data) {
  try {
    const target = getAuthStorePath();
    fs.writeFileSync(target + ".tmp", JSON.stringify(data || {}), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(target + ".tmp", target);
    return true;
  } catch (e) {
    console.error("Failed to save auth store:", e);
    return false;
  }
}

function getUserDataCachePath() {
  return path.join(app.getPath("userData"), "userDataCache.json");
}

function loadSettings() {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch (e) {
    console.error("Failed to read settings.json:", e);
  }
  return {
    BACKGROUND_COLOR: DEFAULT_BACKGROUND_COLOR,
    IS_MAXIMIZED: false,
    MINIMIZE_TO_TRAY: true,
    OPEN_ON_STARTUP: false,
    START_MINIMIZED: false,
    enableHardwareAcceleration: true
  };
}

let appSettings = null;

function saveSettings() {
  try {
    if (!appSettings) return;
    fs.writeFileSync(getSettingsPath(), JSON.stringify(appSettings, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save settings.json:", e);
  }
}

function getSetting(key, defaultValue) {
  if (!appSettings) appSettings = loadSettings();
  return appSettings[key] !== undefined ? appSettings[key] : defaultValue;
}

function setSetting(key, value) {
  if (!appSettings) appSettings = loadSettings();
  appSettings[key] = value;
  saveSettings();
}

// "Iniciar com o Windows": registers the app in the user's login items.
// In development (electron .) the app folder has to be passed to electron.exe.
function loginItemOptions() {
  const args = app.isPackaged ? ["--start-minimized"] : [app.getAppPath(), "--start-minimized"];
  return { path: process.execPath, args };
}

function isOpenOnStartupEnabled() {
  try {
    return Boolean(app.getLoginItemSettings(loginItemOptions()).openAtLogin);
  } catch (_) {
    return Boolean(getSetting("OPEN_ON_STARTUP", false));
  }
}

function applyOpenOnStartup(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), ...loginItemOptions() });
  } catch (e) {
    console.error("Failed to update login item:", e);
  }
  setSetting("OPEN_ON_STARTUP", Boolean(enabled));
  return isOpenOnStartupEnabled();
}

function getBackgroundColor() {
  return getSetting("BACKGROUND_COLOR", DEFAULT_BACKGROUND_COLOR) || DEFAULT_BACKGROUND_COLOR;
}

function getSavedWindowBounds() {
  const bounds = getSetting("WINDOW_BOUNDS", null);
  if (!bounds || typeof bounds !== "object") return null;
  bounds.width = Math.max(MIN_WIDTH, Number(bounds.width) || DEFAULT_WIDTH);
  bounds.height = Math.max(MIN_HEIGHT, Number(bounds.height) || DEFAULT_HEIGHT);
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const area = d.workArea;
    return (
      bounds.x >= area.x - 100 &&
      bounds.y >= area.y - 100 &&
      bounds.x < area.x + area.width &&
      bounds.y < area.y + area.height
    );
  });
  return visible ? bounds : null;
}

function saveWindowConfig(browserWindow) {
  try {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    setSetting("IS_MAXIMIZED", browserWindow.isMaximized());
    setSetting("IS_MINIMIZED", browserWindow.isMinimized());
    if (!browserWindow.isMaximized() && !browserWindow.isMinimized()) {
      setSetting("WINDOW_BOUNDS", browserWindow.getBounds());
    }
  } catch (e) {
    console.error("saveWindowConfig failed:", e);
  }
}

function webContentsSend(event, ...options) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(`${DISCORD_NAMESPACE}${event}`, ...options);
}

function setupSystemTray() {
  try {
    const iconPath = path.join(__dirname, "..", "assets", "app.ico");
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(iconPath);
    tray.setToolTip("Discord");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Discord (v" + BUILD_INFO.version + ")",
        enabled: false
      },
      { type: "separator" },
      {
        label: "Open Discord",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: "Mute",
        type: "checkbox",
        checked: false,
        click: () => webContentsSend("SYSTEM_TRAY_TOGGLE_MUTE")
      },
      {
        label: "Deafen",
        type: "checkbox",
        checked: false,
        click: () => webContentsSend("SYSTEM_TRAY_TOGGLE_DEAFEN")
      },
      {
        label: "Voice & Video Settings",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
          webContentsSend("SYSTEM_TRAY_OPEN_VOICE_SETTINGS");
        }
      },
      { type: "separator" },
      {
        label: "Check for Updates...",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            webContentsSend("CHECK_FOR_UPDATES");
          }
        }
      },
      { type: "separator" },
      {
        label: "Quit Discord",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
        }
      }
    });
  } catch (e) {
    console.error("Failed to create system tray:", e);
  }
}

function launchMainWindow(showImmediately = false) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const iconPath = path.join(__dirname, "..", "assets", "app.ico");
  const mainWindowOptions = {
    title: "Discord",
    backgroundColor: getBackgroundColor(),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    transparent: false,
    frame: false,
    resizable: true,
    show: showImmediately,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      enableBlinkFeatures: "EnumerateDevices,AudioOutputDevices",
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "mainScreenPreload.js"),
      spellcheck: false,
      contextIsolation: true,
      devTools: true,
      backgroundThrottling: true
    }
  };

  const savedBounds = getSavedWindowBounds();
  if (savedBounds) {
    mainWindowOptions.width = savedBounds.width;
    mainWindowOptions.height = savedBounds.height;
    mainWindowOptions.x = savedBounds.x;
    mainWindowOptions.y = savedBounds.y;
  } else {
    mainWindowOptions.center = true;
  }

  mainWindow = new BrowserWindow(mainWindowOptions);

  if (getSetting("IS_MAXIMIZED", false) && showImmediately) {
    mainWindow.maximize();
  }

  mainWindow.on("resize", () => saveWindowConfig(mainWindow));
  mainWindow.on("move", () => saveWindowConfig(mainWindow));
  mainWindow.on("maximize", () => webContentsSend("WINDOW_MAXIMIZED_CHANGE", true));
  mainWindow.on("unmaximize", () => webContentsSend("WINDOW_MAXIMIZED_CHANGE", false));

  // Return memory to Windows while the app is in the background: once shortly
  // after it loses focus, then periodically until it is focused again
  mainWindow.on("blur", scheduleIdleTrim);
  mainWindow.on("hide", scheduleIdleTrim);
  mainWindow.on("minimize", scheduleIdleTrim);
  mainWindow.on("focus", cancelIdleTrim);
  mainWindow.on("show", () => {
    if (mainWindow.isFocused()) cancelIdleTrim();
  });

  mainWindow.on("close", (e) => {
    saveWindowConfig(mainWindow);
    if (!isQuitting && getSetting("MINIMIZE_TO_TRAY", true) && tray && !process.argv.includes("--no-tray-hide")) {
      e.preventDefault();
      mainWindow.hide();
      trimProcessWorkingSets();
    }
  });

  // Standard right-click menu for text boxes, selected text and links (the
  // renderer shows its own menu for messages and servers)
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.isEditable) {
      const f = params.editFlags;
      template.push(
        { label: "Desfazer", role: "undo", enabled: f.canUndo },
        { label: "Refazer", role: "redo", enabled: f.canRedo },
        { type: "separator" },
        { label: "Recortar", role: "cut", enabled: f.canCut },
        { label: "Copiar", role: "copy", enabled: f.canCopy },
        { label: "Colar", role: "paste", enabled: f.canPaste },
        { label: "Colar sem formatação", role: "pasteAndMatchStyle", enabled: f.canPaste },
        { label: "Excluir", role: "delete", enabled: f.canDelete },
        { type: "separator" },
        { label: "Selecionar tudo", role: "selectAll", enabled: f.canSelectAll }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      template.push({ label: "Copiar", role: "copy" });
    }
    if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
      if (template.length) template.push({ type: "separator" });
      template.push(
        { label: "Abrir link no navegador", click: () => shell.openExternal(params.linkURL) },
        { label: "Copiar link", click: () => clipboard.writeText(params.linkURL) }
      );
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // The app window never navigates away from the app: web links go to the browser
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith("https://") || details.url.startsWith("http://")) {
      shell.openExternal(details.url);
    }
    return { action: "deny" };
  });

  const indexPath = path.join(__dirname, "..", "src", "index.html");
  mainWindow.loadFile(indexPath);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    if (getSetting("IS_MAXIMIZED", false)) {
      mainWindow.maximize();
    }
    // Opened by Windows at login: stay in the tray until the user opens it
    if (startHidden && tray) {
      startHidden = false;
      setTimeout(() => trimProcessWorkingSets(), 400);
      return;
    }
    mainWindow.show();
    mainWindow.focus();
    setTimeout(() => trimProcessWorkingSets(), 400);
  });
}

function launchSplashWindow() {
  const iconPath = path.join(__dirname, "..", "assets", "app.ico");
  splashWindow = new BrowserWindow({
    width: 300,
    height: 300,
    transparent: false,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: "#282b30",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      sandbox: false,
      contextIsolation: true,
      preload: path.join(__dirname, "splashPreload.js")
    }
  });

  const splashHtml = path.join(__dirname, "..", "assets", "splash", "index.html");
  splashWindow.loadFile(splashHtml);

  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });
}

function registerIpcHandlers(backend) {
  ipcMain.on("DISCORD_AUTH_STORE_GET_SYNC", (event) => {
    event.returnValue = readAuthStore();
  });

  ipcMain.on("DISCORD_AUTH_STORE_SET_SYNC", (event, data) => {
    event.returnValue = writeAuthStore(data);
  });

  ipcMain.on("DISCORD_BACKEND_GET_INFO_SYNC", (event) => {
    // Hosted server: the renderer talks to it over HTTPS directly
    if (!backend) {
      event.returnValue = { httpUrl: remoteServerUrl, remote: true, port: 0, dbPath: null, uploadsDir: null };
      return;
    }
    event.returnValue = {
      httpUrl: backend.port ? `http://127.0.0.1:${backend.port}` : null,
      port: backend.port,
      dbPath: backend.dbPath,
      uploadsDir: backend.uploadsDir
    };
  });

  ipcMain.handle("DISCORD_BACKEND_RPC", async (_e, action, params, sessionToken) => {
    if (!backend) return { ok: false, error: "Backend server not initialized." };
    try {
      return await backend.handleClientRequest(action, params || {}, sessionToken || null);
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // Real capture: lists every monitor and open window, answers getDisplayMedia()
  registerScreenCaptureHandlers(ipcMain, session.defaultSession);

  ipcMain.on("DISCORD_MEDIA_SESSION", (_e, active) => {
    mediaSessionActive = Boolean(active);
  });

  ipcMain.handle("DISCORD_MEMORY_OPTIMIZE", async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.webContents.session.clearCodeCaches({});
      }
    } catch (_) {}
    trimProcessWorkingSets({ force: true });
    return { ok: true };
  });

  // Same figure as the "Memory" column of Windows' Task Manager: the private
  // working set of every app process (getAppMetrics' workingSetSize includes
  // shared pages and reads several times higher)
  ipcMain.handle("DISCORD_MEMORY_GET_TASK_MANAGER_MB", async () => {
    if (process.platform !== "win32") return null;
    const pids = app.getAppMetrics().map((mt) => mt.pid).filter(Boolean);
    const script = `$ids = @(${pids.join(",")}); $sum = 0; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess } | ForEach-Object { $sum += $_.WorkingSetPrivate }; [math]::Round($sum / 1MB, 1)`;
    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000, windowsHide: true }, (err, stdout) => {
        const value = Number(String(stdout).trim().replace(",", "."));
        resolve(err || !Number.isFinite(value) ? null : value);
      });
    });
  });

  ipcMain.handle("DISCORD_MEMORY_GET_STATS", async () => {
    const mainMem = process.memoryUsage();
    const procMem = await process.getProcessMemoryInfo();
    const metrics = app.getAppMetrics().map((m) => ({
      type: m.type,
      pid: m.pid,
      workingSetSizeKB: m.memory.workingSetSize,
      privateBytesKB: m.memory.privateBytes
    }));
    return {
      mainRssMB: +(mainMem.rss / 1048576).toFixed(2),
      mainHeapUsedMB: +(mainMem.heapUsed / 1048576).toFixed(2),
      mainPrivateMB: +(procMem.private / 1024).toFixed(2),
      processes: metrics
    };
  });

  ipcMain.on("DISCORD_SPLASH_SCREEN_READY", (event) => {
    let quotes = ["Optimizing the People", "Satisfying the Constraints"];
    try {
      const quotesPath = path.join(__dirname, "..", "assets", "data", "quotes_copy.json");
      if (fs.existsSync(quotesPath)) {
        quotes = JSON.parse(fs.readFileSync(quotesPath, "utf8"));
      }
    } catch (_) {}
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    event.sender.send("DISCORD_SPLASH_SCREEN_QUOTE", randomQuote);
    event.sender.send("DISCORD_SPLASH_UPDATE_STATE", { status: "checking-for-updates" });

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send("DISCORD_SPLASH_UPDATE_STATE", {
          status: "downloading-updates",
          current: 1,
          total: 1,
          progress: 55
        });
      }
    }, 300);

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send("DISCORD_SPLASH_UPDATE_STATE", {
          status: "downloading-updates",
          current: 1,
          total: 1,
          progress: 100
        });
      }
    }, 600);

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send("DISCORD_SPLASH_UPDATE_STATE", {
          status: "launching"
        });
      }
      launchMainWindow(false);
    }, 900);
  });

  ipcMain.on("DISCORD_SPLASH_SCREEN_QUIT", () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.on("DISCORD_APP_GET_RELEASE_CHANNEL_SYNC", (event) => {
    event.returnValue = BUILD_INFO.releaseChannel;
  });

  ipcMain.on("DISCORD_APP_GET_HOST_VERSION_SYNC", (event) => {
    event.returnValue = BUILD_INFO.version;
  });

  // Updates: the server publishes /download/version.json next to Eco.zip.
  // Installing runs the same installer as the first install (it downloads,
  // checks the SHA-256, closes this app, replaces the files and reopens it).
  const updateBase = () => {
    const cfg = loadAppConfig();
    return String(cfg.serverUrl || cfg.publicUrl || "").replace(/\/+$/, "");
  };
  const newerVersion = (a, b) => {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  };
  ipcMain.handle("DISCORD_UPDATE_CHECK", async () => {
    const base = updateBase();
    if (!/^https:\/\//.test(base)) return { ok: false, error: "Este app não está ligado a um servidor de atualizações." };
    try {
      const res = await net.fetch(`${base}/download/version.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = await res.json();
      const latest = String(info.version || "");
      return {
        ok: true,
        current: BUILD_INFO.version,
        latest,
        notes: String(info.notes || "").slice(0, 2000),
        available: Boolean(latest) && newerVersion(latest, BUILD_INFO.version)
      };
    } catch (err) {
      return { ok: false, error: "Não foi possível falar com o servidor de atualizações." };
    }
  });
  ipcMain.handle("DISCORD_UPDATE_INSTALL", async () => {
    const base = updateBase();
    if (!/^https:\/\//.test(base) || !app.isPackaged) return { ok: false, error: "Atualização automática só funciona no app instalado." };
    const { spawn } = require("child_process");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm '${base}/download/install.ps1' | iex`],
      { detached: true, stdio: "ignore", windowsHide: false }
    );
    child.unref();
    return { ok: true };
  });

  ipcMain.handle("DISCORD_APP_SET_BADGE_COUNT", (_e, count) => {
    if (typeof app.setBadgeCount === "function") {
      return app.setBadgeCount(Number(count) || 0);
    }
    return false;
  });

  ipcMain.on("DISCORD_APP_RELAUNCH", () => {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  });

  ipcMain.on("DISCORD_WINDOW_MINIMIZE", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on("DISCORD_WINDOW_MAXIMIZE", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });

  ipcMain.on("DISCORD_WINDOW_RESTORE", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.restore();
  });

  ipcMain.on("DISCORD_WINDOW_CLOSE", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (getSetting("MINIMIZE_TO_TRAY", true) && tray && !process.argv.includes("--no-tray-hide")) {
        mainWindow.hide();
        trimProcessWorkingSets();
      } else {
        isQuitting = true;
        mainWindow.close();
        app.quit();
      }
    }
  });

  ipcMain.on("DISCORD_WINDOW_FOCUS", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });

  ipcMain.on("DISCORD_WINDOW_BLUR", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.blur();
  });

  ipcMain.on("DISCORD_WINDOW_FLASH_FRAME", (_e, flag) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(Boolean(flag));
  });

  ipcMain.on("DISCORD_WINDOW_TOGGLE_FULLSCREEN", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  ipcMain.handle("DISCORD_WINDOW_IS_ALWAYS_ON_TOP", () => {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.isAlwaysOnTop();
    return false;
  });

  ipcMain.handle("DISCORD_WINDOW_SET_ALWAYS_ON_TOP", (_e, enabled) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(Boolean(enabled));
      return mainWindow.isAlwaysOnTop();
    }
    return false;
  });

  ipcMain.on("DISCORD_CLIPBOARD_COPY", (_e, text) => {
    if (typeof text === "string") clipboard.writeText(text);
  });

  ipcMain.on("DISCORD_CLIPBOARD_READ_TEXT", (event) => {
    event.returnValue = clipboard.readText();
  });

  ipcMain.handle("DISCORD_SETTINGS_GET", (_e, key, defaultValue) => {
    return getSetting(key, defaultValue);
  });

  ipcMain.handle("DISCORD_SETTINGS_SET", (_e, key, value) => {
    setSetting(key, value);
    return true;
  });

  ipcMain.on("DISCORD_SETTINGS_GET_SYNC", (event, key, defaultValue) => {
    event.returnValue = getSetting(key, defaultValue);
  });

  ipcMain.on("DISCORD_SETTINGS_UPDATE_BACKGROUND_COLOR", (_e, color) => {
    if (typeof color === "string") {
      setSetting("BACKGROUND_COLOR", color);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(color);
      }
    }
  });

  ipcMain.on("DISCORD_APP_GET_OPEN_ON_STARTUP_SYNC", (event) => {
    event.returnValue = isOpenOnStartupEnabled();
  });

  ipcMain.on("DISCORD_APP_SET_OPEN_ON_STARTUP_SYNC", (event, enabled) => {
    event.returnValue = applyOpenOnStartup(enabled);
  });

  ipcMain.on("DISCORD_GPU_SETTINGS_GET_ENABLE_HWACCEL_SYNC", (event) => {
    event.returnValue = Boolean(getSetting("GPU_ACCELERATION", true));
  });

  ipcMain.on("DISCORD_GPU_SETTINGS_SET_ENABLE_HWACCEL", (_e, enabled) => {
    setSetting("GPU_ACCELERATION", Boolean(enabled));
  });

  ipcMain.handle("DISCORD_USER_DATA_CACHE_GET", () => {
    try {
      const p = getUserDataCachePath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {}
    return null;
  });

  ipcMain.on("DISCORD_USER_DATA_CACHE_SAVE", (_e, data) => {
    try {
      fs.writeFileSync(getUserDataCachePath(), JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to save userDataCache:", e);
    }
  });

  ipcMain.on("DISCORD_USER_DATA_CACHE_DELETE", () => {
    try {
      const p = getUserDataCachePath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  });

  ipcMain.handle("DISCORD_FILE_MANAGER_SHOW_OPEN_DIALOG", async (_e, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, options || {});
  });

  ipcMain.handle("DISCORD_FILE_MANAGER_SHOW_SAVE_DIALOG", async (_e, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true };
    return dialog.showSaveDialog(mainWindow, options || {});
  });
}

// Only one copy of the app per profile: opening it again (shortcut, Windows
// startup) brings the existing window forward instead of starting another set
// of processes. The lock is tied to the userData folder set above.
// eco://convite/<code> links (the "Entrar no servidor" button of the invite
// page) start the app, or reach the running copy through second-instance.
const DEEP_LINK_PROTOCOL = "eco";
let pendingDeepLink = findDeepLink(process.argv);

function findDeepLink(argv) {
  return (argv || []).find((arg) => typeof arg === "string" && arg.toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}://`)) || null;
}

function deliverDeepLink(url) {
  if (!url) return;
  pendingDeepLink = url;
  webContentsSend("DEEP_LINK", url);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    deliverDeepLink(findDeepLink(argv));
    startHidden = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  // Only the installed app claims eco:// (a dev checkout would steal the links)
  if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  ipcMain.handle("DISCORD_DEEP_LINK_TAKE", () => {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    return url;
  });
  appSettings = loadSettings();
  // app.config.json → serverUrl set: everyone shares that hosted server, so no
  // local backend is started. Empty: the app runs its own backend on this PC.
  remoteServerUrl = loadAppConfig().serverUrl || null;
  if (!remoteServerUrl) {
    backendServer = new DiscordBackendServer({ dataDir: app.getPath("userData") });
    await backendServer.startHttpServer(0);
  }

  registerIpcHandlers(backendServer);
  setupSystemTray();
  // Compiles the tiny memory helper the first time (a second or two, in the background)
  prepareHelper(app.getPath("userData")).catch(() => null);
  startSystemIdleWatch();
  // Running games feed the profile's "Atividade" tab (the renderer reports them for the signed-in account)
  startGameDetector((activity) => webContentsSend(activity.kind === "spotify" ? "SPOTIFY_ACTIVITY" : "GAME_ACTIVITY", activity), {
    isSpotifyEnabled: () => Boolean(getSetting("SPOTIFY_SYNC", false)),
    isGameActivityEnabled: () => getSetting("SHOW_GAME_ACTIVITY", true) !== false
  });

  if (startHidden && tray) {
    launchMainWindow(false);
  } else if (process.argv.includes("--skip-splash")) {
    launchMainWindow(true);
  } else {
    launchSplashWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  // localStorage (the saved login) is written lazily; flush it so it survives quitting
  try {
    session.defaultSession.flushStorageData();
  } catch (_) {}
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
