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
  globalShortcut,
  net,
  nativeImage
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFile } = require("child_process");
const { DiscordBackendServer } = require("./backendServer");
const { registerScreenCaptureHandlers } = require("./screenCapture");
const { loadAppConfig } = require("./appConfig");
const { startGameDetector } = require("./gameDetector");
const { prepareHelper, trimProcesses, capProcesses, isLightTrimAvailable } = require("./memTrimmer");
const { readSignedManifest } = require("./updateSignature");
const { pathToFileURL } = require("url");

// Every IPC channel answers only the app's own pages (file:// inside the app
// folder, top frame). Anything else (a page the window was tricked into
// loading, an embedded frame) is ignored. Wrapped here, before any handler is
// registered, so no channel can be forgotten.
const APP_PAGES_URL = pathToFileURL(path.join(__dirname, "..")).href.toLowerCase() + "/";
function isTrustedIpcSender(event) {
  const frame = event && event.senderFrame;
  if (!frame || frame.parent) return false;
  return String(frame.url || "").toLowerCase().startsWith(APP_PAGES_URL);
}
{
  const { ipcMain } = require("electron");
  const on = ipcMain.on.bind(ipcMain);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.on = (channel, listener) =>
    on(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) {
        event.returnValue = undefined;
        return;
      }
      return listener(event, ...args);
    });
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) throw new Error("IPC recusado: origem não confiável");
      return listener(event, ...args);
    });
}

// productName "Discord" made Electron use %APPDATA%\discord, the official
// Discord client's folder: both apps then shared settings.json, caches and
// Local Storage. Use our own folder, copying (never moving) the data the app
// created in the shared one.
const SHARED_DISCORD_DATA_DIR = path.join(app.getPath("appData"), "discord");
// ECO_USER_DATA_DIR lets tests run against a throwaway profile
const APP_DATA_DIR = process.env.ECO_USER_DATA_DIR || path.join(app.getPath("appData"), "Eco");
const DB_FILE = "discord_platform_v2.sqlite";
// Shown everywhere: window and taskbar titles, tray, notifications (the
// executable's own name/description is set by scripts/build-exe.js)
const APP_DISPLAY_NAME = loadAppConfig().appName || "Huddle";
// The app was called this up to 1.2.10: its shortcuts are renamed on start
const OLD_DISPLAY_NAME = "Invadominio zak' zak";
app.setName(APP_DISPLAY_NAME);
// (kept from the old name: taskbar pins and notification settings stay valid)
if (process.platform === "win32") app.setAppUserModelId("com.invadominio.zakzak"); // same as APP_USER_MODEL_ID

// Shortcuts made under the old name (Desktop, Start menu) become "Huddle"
// shortcuts pointing at this executable
function renameOldShortcuts() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const startMenu = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  for (const dir of [app.getPath("desktop"), startMenu]) {
    const oldLink = path.join(dir, `${OLD_DISPLAY_NAME}.lnk`);
    if (!fs.existsSync(oldLink)) continue;
    try {
      shell.writeShortcutLink(path.join(dir, `${APP_DISPLAY_NAME}.lnk`), "create", {
        target: process.execPath,
        cwd: path.dirname(process.execPath),
        icon: process.execPath,
        iconIndex: 0,
        description: APP_DISPLAY_NAME,
        appUserModelId: "com.invadominio.zakzak"
      });
      fs.rmSync(oldLink, { force: true });
    } catch (err) {
      console.error("Failed to rename the old shortcut:", err);
    }
  }
}

// Windows shows a notification under the name and icon of the Start menu
// shortcut that carries the app's ID. The installers made shortcuts without
// it, so notifications came from "electron.app.Electron": the shortcuts are
// created/fixed here on every start (cheap when already right).
const APP_USER_MODEL_ID = "com.invadominio.zakzak";
function ensureNotificationShortcut() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const options = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    icon: process.execPath,
    iconIndex: 0,
    description: APP_DISPLAY_NAME,
    appUserModelId: APP_USER_MODEL_ID
  };
  const startMenuLink = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${APP_DISPLAY_NAME}.lnk`);
  const desktopLink = path.join(app.getPath("desktop"), `${APP_DISPLAY_NAME}.lnk`);
  for (const link of [startMenuLink, desktopLink]) {
    let current = null;
    try {
      current = fs.existsSync(link) ? shell.readShortcutLink(link) : null;
    } catch (_) {}
    // The Desktop one only when it already exists (the user may have deleted it)
    if (!current && link === desktopLink) continue;
    if (current && current.appUserModelId === APP_USER_MODEL_ID && path.resolve(current.target || "") === path.resolve(process.execPath)) continue;
    try {
      shell.writeShortcutLink(link, current ? "replace" : "create", options);
    } catch (err) {
      console.error("Failed to set up the notification shortcut:", err);
    }
  }
}

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
app.commandLine.appendSwitch("disk-cache-size", "16777216");
app.commandLine.appendSwitch("media-cache-size", "8388608");
// ---------------------------------------------------------------------------
// Diagnostics: %APPDATA%\Eco\logs\huddle.log (tray > "Abrir registro de erros").
// What a friend sends when the app shows a white window or closes by itself.
// ---------------------------------------------------------------------------
const LOG_DIR = path.join(APP_DATA_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "huddle.log");
function logLine(...parts) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    } catch (_) {}
    const text = parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${text}\n`);
  } catch (_) {}
}

// Start-up guard. Some antivirus programs (they inject code into other apps)
// and some graphics drivers crash Chromium's GPU code or its sandbox: the
// window stays white, or the whole app closes while opening. A start that did
// not reach "healthy" makes the next one use a safer mode, one step at a time:
//   1 = GPU in its own process (a GPU crash no longer takes the app down)
//   2 = no hardware acceleration
//   3 = no Chromium sandbox for the app's own pages
const STARTUP_STATE_FILE = path.join(APP_DATA_DIR, "startup-state.json");
const MAX_COMPAT_LEVEL = 3;
function readStartupState() {
  try {
    const s = JSON.parse(fs.readFileSync(STARTUP_STATE_FILE, "utf8"));
    return { pending: Boolean(s.pending), compat: Math.min(MAX_COMPAT_LEVEL, Math.max(0, Number(s.compat) || 0)) };
  } catch (_) {
    return { pending: false, compat: 0 };
  }
}
function writeStartupState(state) {
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(STARTUP_STATE_FILE, JSON.stringify(state));
  } catch (_) {}
}
const startupState = readStartupState();
if (startupState.pending && startupState.compat < MAX_COMPAT_LEVEL) startupState.compat += 1;
const COMPAT_LEVEL = startupState.compat;
// Restart in the next safer mode (the page or the GPU died while opening)
function relaunchSafer(reason) {
  const next = Math.min(MAX_COMPAT_LEVEL, COMPAT_LEVEL + 1);
  logLine("relaunch:", reason, "compat", COMPAT_LEVEL, "->", next);
  if (next === COMPAT_LEVEL) return false;
  writeStartupState({ pending: false, compat: next });
  app.relaunch();
  app.exit(0);
  return true;
}
if (COMPAT_LEVEL >= 3) app.commandLine.appendSwitch("no-sandbox");
const PAGE_SANDBOX = COMPAT_LEVEL < 3;

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
if (isGpuAccelerationEnabled() && COMPAT_LEVEL < 2) {
  // The GPU process is folded into the main one: the app shows as two
  // processes (app + page) instead of three. Only with acceleration on:
  // in-process GPU with acceleration off crashed the app on every start
  // (access violation before the window opened).
  if (COMPAT_LEVEL < 1) app.commandLine.appendSwitch("in-process-gpu");
} else {
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

// "Modo economia de memória" (Configurações > Windows & Memória, off by
// default): every app process gets a hard working-set ceiling (MemTrim --cap),
// which keeps Task Manager's "Memory" column low. It is off by default because
// a ceiling below what the app is using makes Windows page memory in and out
// non-stop: measured with a 1080p/60 share between two copies of the app, 37
// FPS and stalls with the ceiling against 54-57 FPS and none without it, and
// the window took twice as long to open (0.70 s vs 0.30 s).
const MAIN_PROCESS_CAP_MB = 85; // app + GPU + capture/encoding (in-process)
const PAGE_PROCESS_CAP_MB = 30; // each page (window)
let cappedPids = "";

function isMemorySaverOn() {
  return Boolean(getSetting("MEMORY_SAVER", false));
}

function applyMemoryCaps() {
  const metrics = app.getAppMetrics();
  if (!isMemorySaverOn()) {
    // Turned off while running: lift the ceilings that were set
    if (cappedPids) {
      capProcesses(metrics.map((mt) => ({ pid: mt.pid, mb: 0 })));
      cappedPids = "";
    }
    return;
  }
  const key = metrics.map((mt) => mt.pid).sort().join(",");
  if (key === cappedPids) return;
  const entries = metrics.map((mt) => ({ pid: mt.pid, mb: mt.type === "Browser" ? MAIN_PROCESS_CAP_MB : PAGE_PROCESS_CAP_MB }));
  if (capProcesses(entries)) cappedPids = key;
}

// Keyboard shortcut that mutes/unmutes the microphone from anywhere (also in a
// game). Changed in Configurações > Voz, Vídeo & Sons; "" turns it off.
const DEFAULT_MUTE_HOTKEY = "CommandOrControl+Shift+M";
let activeMuteHotkey = "";

function getMuteHotkey() {
  const value = getSetting("MUTE_HOTKEY", DEFAULT_MUTE_HOTKEY);
  return typeof value === "string" ? value : DEFAULT_MUTE_HOTKEY;
}

// Registers the shortcut; { ok:false } when Windows or another app already uses it
function applyMuteHotkey(accelerator) {
  if (activeMuteHotkey) {
    try {
      globalShortcut.unregister(activeMuteHotkey);
    } catch (_) {}
    activeMuteHotkey = "";
  }
  if (!accelerator) return { ok: true };
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => webContentsSend("HOTKEY_TOGGLE_MUTE"));
  } catch (_) {
    ok = false;
  }
  if (ok) activeMuteHotkey = accelerator;
  return ok ? { ok: true } : { ok: false, error: "Esse atalho já está em uso por outro programa ou não é válido." };
}

// During a call or screen share the app runs "above normal": a game at normal
// priority no longer starves the capture, the video encoder and the audio
// (all of them live in the app's processes)
function setMediaPriority(active) {
  const level = active ? os.constants.priority.PRIORITY_ABOVE_NORMAL : os.constants.priority.PRIORITY_NORMAL;
  for (const mt of app.getAppMetrics()) {
    try {
      os.setPriority(mt.pid, level);
    } catch (_) {}
  }
}

// Emptying the working set entirely is only done while the app is out of
// sight (tray/minimized) or right after a call: the next frames would fault
// all those pages back in, a visible hitch.
function appInView() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
}

function trimProcessWorkingSets({ force = false } = {}) {
  // Automatic trimming starts a helper that touches the app's processes every
  // minute, which antivirus programs flag: only in "modo economia" (or when asked)
  if (!force && !isMemorySaverOn()) return;
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

// Out of sight: empty the working sets every HIDDEN_TRIM_INTERVAL_MS. Also
// re-applies the ceilings when a process was replaced (e.g. a page reload).
const HIDDEN_TRIM_INTERVAL_MS = 60 * 1000;
function startSystemIdleWatch() {
  setInterval(() => {
    applyMemoryCaps();
    if (mediaSessionActive || appInView()) return;
    if (Date.now() - lastTrimAt >= HIDDEN_TRIM_INTERVAL_MS) trimProcessWorkingSets();
  }, 10 * 1000).unref();
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

// Web links go to the browser; any other scheme (file:, ms-*, custom
// protocols that could launch programs) is never handed to Windows
function openWebLink(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch (_) {
    return;
  }
  if (parsed.protocol === "https:" || parsed.protocol === "http:") shell.openExternal(parsed.href);
}

function webContentsSend(event, ...options) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(`${DISCORD_NAMESPACE}${event}`, ...options);
}

// Buttons on the taskbar preview while in a call: microphone, audio, leave.
// The page sends the state and the icons (drawn from its own SVGs).
let callThumbar = null; // { muted, deafened, icons: { mic, micOff, headphones, deafenOff, leave } } or null
function applyCallThumbar() {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return;
  if (!callThumbar) {
    mainWindow.setThumbarButtons([]);
    return;
  }
  const img = (dataUrl) => nativeImage.createFromDataURL(dataUrl);
  const { muted, deafened, icons } = callThumbar;
  mainWindow.setThumbarButtons([
    {
      tooltip: muted ? "Ativar microfone" : "Silenciar microfone",
      icon: img(muted ? icons.micOff : icons.mic),
      click: () => webContentsSend("SYSTEM_TRAY_TOGGLE_MUTE")
    },
    {
      tooltip: deafened ? "Ativar áudio" : "Desativar áudio",
      icon: img(deafened ? icons.deafenOff : icons.headphones),
      click: () => webContentsSend("SYSTEM_TRAY_TOGGLE_DEAFEN")
    },
    {
      tooltip: "Sair da call",
      icon: img(icons.leave),
      click: () => webContentsSend("CALL_LEAVE")
    }
  ]);
}

function setupSystemTray() {
  try {
    const iconPath = path.join(__dirname, "..", "assets", "app.ico");
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(iconPath);
    tray.setToolTip(APP_DISPLAY_NAME);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `${APP_DISPLAY_NAME} (v${BUILD_INFO.version})`,
        enabled: false
      },
      { type: "separator" },
      {
        label: `Abrir ${APP_DISPLAY_NAME}`,
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: "Silenciar microfone",
        type: "checkbox",
        checked: false,
        click: () => webContentsSend("SYSTEM_TRAY_TOGGLE_MUTE")
      },
      {
        label: "Desativar áudio",
        type: "checkbox",
        checked: false,
        click: () => webContentsSend("SYSTEM_TRAY_TOGGLE_DEAFEN")
      },
      {
        label: "Configurações de voz e vídeo",
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
        label: "Verificar atualizações...",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            webContentsSend("CHECK_FOR_UPDATES");
          }
        }
      },
      {
        label: "Abrir registro de erros",
        click: () => {
          fs.mkdirSync(LOG_DIR, { recursive: true });
          shell.openPath(LOG_DIR);
        }
      },
      { type: "separator" },
      {
        label: `Sair do ${APP_DISPLAY_NAME}`,
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

const STARTED_AT = Date.now();
const HEALTHY_AFTER_MS = 15 * 1000;
let markedHealthy = false;

function watchPageHealth(win) {
  const wc = win.webContents;
  wc.on("did-finish-load", () => {
    logLine("page loaded", wc.getURL().split("/").pop());
    setTimeout(() => {
      if (markedHealthy || win.isDestroyed() || wc.isCrashed()) return;
      markedHealthy = true;
      writeStartupState({ pending: false, compat: COMPAT_LEVEL });
      logLine("healthy, compat", COMPAT_LEVEL);
    }, HEALTHY_AFTER_MS);
  });
  wc.on("did-fail-load", (_e, code, description, url) => logLine("page failed to load", code, description, url));
  wc.on("unresponsive", () => logLine("page unresponsive"));
  wc.on("render-process-gone", (_e, details) => {
    logLine("page process gone", details);
    if (isQuitting || details.reason === "clean-exit") return;
    // While opening: try the next safer mode. Later: just reload the page.
    if (Date.now() - STARTED_AT < 60 * 1000 && relaunchSafer(`page ${details.reason}`)) return;
    if (!win.isDestroyed()) wc.reload();
  });
  // Errors on the page (a white window is usually one of these)
  wc.on("console-message", (...args) => {
    const ev = args[0] && typeof args[0] === "object" && "message" in args[0] ? args[0] : null;
    const level = ev ? ev.level : args[1];
    const message = ev ? ev.message : args[2];
    const source = ev ? ev.sourceId : args[4];
    if (level === "error" || level === 3) logLine("page error:", String(message).slice(0, 500), String(source || "").split("/").pop());
  });
}

function launchMainWindow(showImmediately = false) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const iconPath = path.join(__dirname, "..", "assets", "app.ico");
  const mainWindowOptions = {
    title: APP_DISPLAY_NAME,
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
      // The page runs in Chromium's sandbox; the preload only needs the
      // electron bridge (contextBridge/ipcRenderer/webFrame), which works there
      // (off only in the start-up guard's last safe mode, see COMPAT_LEVEL)
      sandbox: PAGE_SANDBOX,
      preload: path.join(__dirname, "mainScreenPreload.js"),
      spellcheck: false,
      contextIsolation: true,
      webviewTag: false,
      // Developer tools only in a development checkout (or HUDDLE_DEVTOOLS=1)
      devTools: !app.isPackaged || process.env.HUDDLE_DEVTOOLS === "1",
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
  watchPageHealth(mainWindow);
  mainWindow.on("maximize", () => webContentsSend("WINDOW_MAXIMIZED_CHANGE", true));
  mainWindow.on("unmaximize", () => webContentsSend("WINDOW_MAXIMIZED_CHANGE", false));

  // Return memory to Windows while the app is in the background: once shortly
  // after it loses focus, then periodically until it is focused again
  mainWindow.on("blur", scheduleIdleTrim);
  mainWindow.on("hide", scheduleIdleTrim);
  mainWindow.on("minimize", () => setTimeout(() => trimProcessWorkingSets(), 300));
  mainWindow.on("focus", cancelIdleTrim);
  mainWindow.on("show", () => {
    // Windows forgets the preview buttons while the window is hidden
    setTimeout(applyCallThumbar, 100);
    if (mainWindow.isFocused()) cancelIdleTrim();
  });

  mainWindow.on("close", (e) => {
    saveWindowConfig(mainWindow);
    if (!isQuitting && getSetting("MINIMIZE_TO_TRAY", true) && tray && !process.argv.includes("--no-tray-hide")) {
      e.preventDefault();
      // Closing the window leaves the call even though the app keeps running in the tray
      webContentsSend("CALL_LEAVE");
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
        { label: "Abrir link no navegador", click: () => openWebLink(params.linkURL) },
        { label: "Copiar link", click: () => clipboard.writeText(params.linkURL) }
      );
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // The app window never navigates away from the app: web links go to the browser
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    event.preventDefault();
    openWebLink(url);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openWebLink(details.url);
    return { action: "deny" };
  });

  const indexPath = path.join(__dirname, "..", "src", "index.html");
  // The page's own <title> would replace the app name in the taskbar
  mainWindow.on("page-title-updated", (e) => e.preventDefault());
  mainWindow.loadFile(indexPath);

  // Interface size chosen in Configurações > Aparência
  mainWindow.webContents.on("did-finish-load", () => {
    const zoom = Math.min(1.75, Math.max(0.7, Number(getSetting("UI_ZOOM", 1)) || 1));
    if (zoom !== 1) mainWindow.webContents.setZoomFactor(zoom);
  });

  // Never stay stuck on the splash: if the page takes too long to paint, show it anyway
  let shown = false;
  const showFallback = setTimeout(() => {
    if (!shown && mainWindow && !mainWindow.isDestroyed()) mainWindow.emit("ready-to-show");
  }, 10000);

  mainWindow.once("ready-to-show", () => {
    shown = true;
    clearTimeout(showFallback);
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
    setTimeout(() => applyMemoryCaps(), 400);
  });
}

function launchSplashWindow() {
  const iconPath = path.join(__dirname, "..", "assets", "app.ico");
  splashWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
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
      sandbox: PAGE_SANDBOX,
      contextIsolation: true,
      webviewTag: false,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, "splashPreload.js")
    }
  });

  const splashHtml = path.join(__dirname, "..", "assets", "splash", "index.html");
  splashWindow.on("page-title-updated", (e) => e.preventDefault());
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
    const ended = mediaSessionActive && !active;
    if (Boolean(active) !== mediaSessionActive) setMediaPriority(Boolean(active));
    mediaSessionActive = Boolean(active);
    // Call/share over: give back what it used
    if (ended) setTimeout(() => trimProcessWorkingSets(), 2000);
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
    // privateBytes is Windows' private working-set figure (no PowerShell needed)
    const kb = app.getAppMetrics().reduce((sum, mt) => sum + (mt.memory?.privateBytes || mt.memory?.workingSetSize || 0), 0);
    return kb ? Math.round(kb / 1024) : null;
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
  // "Atualizar agora": the app downloads the new version itself, showing the
  // progress (UPDATE_PROGRESS), checks its SHA-256, and only then closes. A
  // short script swaps the files from the downloaded zip (seconds, not the
  // minute-long download it used to do after the app had already closed) and
  // reopens the app. Accounts/settings live in the data folder, never touched.
  let updateInProgress = false;
  ipcMain.handle("DISCORD_UPDATE_INSTALL", async () => {
    const base = updateBase();
    if (!/^https:\/\//.test(base) || !app.isPackaged) return { ok: false, error: "Atualização automática só funciona no app instalado." };
    if (updateInProgress) return { ok: false, error: "A atualização já está sendo baixada." };
    updateInProgress = true;
    const dir = path.join(app.getPath("temp"), "eco-update");
    const zipPath = path.join(dir, "update.zip");
    try {
      fs.mkdirSync(dir, { recursive: true });
      // The signed manifest says which version, size and SHA-256 to expect;
      // nothing is downloaded or installed unless its signature checks out
      // (electron/updateSignature.js)
      const [manRes, sigRes] = await Promise.all([
        net.fetch(`${base}/download/manifest.json`, { cache: "no-store" }),
        net.fetch(`${base}/download/manifest.sig`, { cache: "no-store" })
      ]);
      if (!manRes.ok || !sigRes.ok) throw new Error("signature");
      const manifest = readSignedManifest(Buffer.from(await manRes.arrayBuffer()), await sigRes.text(), BUILD_INFO.version);
      const expected = manifest.sha256;

      const res = await net.fetch(`${base}/download/Eco.zip`, { cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      const hash = require("crypto").createHash("sha256");
      const out = fs.createWriteStream(zipPath);
      let received = 0;
      let lastSent = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
        if (Date.now() - lastSent > 200) {
          lastSent = Date.now();
          webContentsSend("UPDATE_PROGRESS", { received, total });
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (received !== manifest.size || hash.digest("hex") !== expected) throw new Error("hash");
      webContentsSend("UPDATE_PROGRESS", { received: total || received, total: total || received, done: true });

      // Unpacked right away with Windows' own tar.exe, while the file is the
      // one just checked; then a plain .cmd (robocopy) swaps the folder once
      // the app has quit and opens it again. No PowerShell: antivirus programs
      // block apps that start PowerShell scripts.
      const installDir = path.dirname(process.execPath);
      const exeName = path.basename(process.execPath);
      const staging = path.join(dir, "staging");
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      const tarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      await new Promise((resolve, reject) =>
        execFile(tarExe, ["-xf", zipPath, "-C", staging], { windowsHide: true, timeout: 180000 }, (e) => (e ? reject(e) : resolve()))
      );
      if (!fs.existsSync(path.join(staging, exeName))) throw new Error("package");
      fs.rmSync(zipPath, { force: true });
      // %-signs are doubled for cmd; paths are quoted
      const c = (s) => String(s).replace(/%/g, "%%");
      const lines = [
        "@echo off",
        "chcp 65001 >nul",
        "title Atualizando",
        "echo.",
        "echo   Instalando a atualização... o app abre sozinho em seguida.",
        "set /a tries=0",
        ":wait",
        `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul`,
        "if not errorlevel 1 (",
        "  set /a tries+=1",
        "  if %tries% lss 30 (",
        "    timeout /t 1 /nobreak >nul",
        "    goto wait",
        "  )",
        ")",
        `taskkill /F /IM "${c(exeName)}" >nul 2>&1`,
        "timeout /t 1 /nobreak >nul",
        // Mirror the new files in; the uninstaller copied there by the installer stays
        `robocopy "${c(staging)}" "${c(installDir)}" /MIR /XF Desinstalar.exe /R:5 /W:1 /NFL /NDL /NJH /NJS /NP >nul`,
        "if errorlevel 8 (",
        "  echo   Não foi possível instalar a atualização. Feche o app e tente de novo.",
        "  timeout /t 8 >nul",
        ")",
        `rmdir /s /q "${c(staging)}" >nul 2>&1`,
        `start "" "${c(path.join(installDir, exeName))}"`,
        "exit"
      ];
      // Opened like a double-click (shell.openPath): keeps running after this
      // app closes. (Spawning it straight from the app died silently.)
      const cmd = path.join(dir, "atualizar.cmd");
      fs.writeFileSync(cmd, lines.join("\r\n") + "\r\n", "utf8");
      logLine("update ready", manifest.version || "");
      const err = await shell.openPath(cmd);
      if (err) throw new Error(err);
    } catch (err) {
      updateInProgress = false;
      try {
        fs.rmSync(zipPath, { force: true });
      } catch (_) {}
      const msg = String(err?.message || "");
      return {
        ok: false,
        error:
          msg === "hash"
            ? "O arquivo baixado veio corrompido. Tente de novo."
            : msg === "signature" || msg === "manifest"
              ? "A atualização não tem uma assinatura válida do Huddle e foi recusada por segurança."
              : msg === "downgrade"
                ? "O servidor ofereceu uma versão igual ou mais antiga que a sua; nada foi instalado."
                : "Não foi possível baixar a atualização. Verifique a internet e tente de novo."
      };
    }
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 600);
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
        webContentsSend("CALL_LEAVE");
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

  // The page may only change these settings, each with its own type (a
  // compromised page must not be able to rewrite anything else in settings.json)
  const RENDERER_SETTINGS = {
    SHOW_GAME_ACTIVITY: (v) => typeof v === "boolean",
    SPOTIFY_SYNC: (v) => typeof v === "boolean",
    MINIMIZE_TO_TRAY: (v) => typeof v === "boolean",
    enableHardwareAcceleration: (v) => typeof v === "boolean",
    UI_ZOOM: (v) => typeof v === "number" && v >= 0.7 && v <= 1.75
  };
  ipcMain.handle("DISCORD_SETTINGS_SET", (_e, key, value) => {
    const valid = Object.prototype.hasOwnProperty.call(RENDERER_SETTINGS, key) && RENDERER_SETTINGS[key](value);
    if (!valid) return false;
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

  ipcMain.on("DISCORD_MUTE_HOTKEY_GET_SYNC", (event) => {
    event.returnValue = { accelerator: getMuteHotkey(), active: Boolean(activeMuteHotkey) };
  });

  ipcMain.on("DISCORD_MUTE_HOTKEY_SET_SYNC", (event, accelerator) => {
    const next = typeof accelerator === "string" ? accelerator.slice(0, 80) : "";
    const res = applyMuteHotkey(next);
    if (res.ok) {
      setSetting("MUTE_HOTKEY", next);
    } else {
      applyMuteHotkey(getMuteHotkey()); // keep the previous one working
    }
    event.returnValue = { ...res, accelerator: res.ok ? next : getMuteHotkey() };
  });

  ipcMain.on("DISCORD_MEMORY_SAVER_GET_SYNC", (event) => {
    event.returnValue = isMemorySaverOn();
  });

  ipcMain.on("DISCORD_MEMORY_SAVER_SET_SYNC", (event, enabled) => {
    setSetting("MEMORY_SAVER", Boolean(enabled));
    applyMemoryCaps();
    event.returnValue = isMemorySaverOn();
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

  // "Salvar" on images and files: Windows' save dialog, then a normal download
  ipcMain.on("DISCORD_CALL_THUMBAR", (_e, payload) => {
    const valid = payload && payload.icons && ["mic", "micOff", "headphones", "deafenOff", "leave"].every((k) => /^data:image\/png;base64,/.test(String(payload.icons[k] || "")));
    callThumbar = valid ? { muted: Boolean(payload.muted), deafened: Boolean(payload.deafened), icons: payload.icons } : null;
    applyCallThumbar();
  });

  // Downloads only over HTTPS (files people send come from the server's /uploads)
  ipcMain.on("DISCORD_DOWNLOAD_URL", (_e, url) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    let parsed;
    try {
      parsed = new URL(String(url || ""));
    } catch (_) {
      return;
    }
    const localBackend = parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    if (parsed.protocol !== "https:" && !localBackend) return;
    mainWindow.webContents.downloadURL(parsed.href);
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
// Only eco://convite/<code> (or /invite/) with a plain code is passed on
const DEEP_LINK_PATTERN = /^eco:\/\/+(?:convite|invite)\/[A-Za-z0-9_-]{4,64}\/?$/i;
let pendingDeepLink = findDeepLink(process.argv);

function findDeepLink(argv) {
  return (argv || []).find((arg) => typeof arg === "string" && arg.length <= 120 && DEEP_LINK_PATTERN.test(arg)) || null;
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
  // Cleared once the window has run for a while (watchPageHealth) or on a normal quit
  writeStartupState({ pending: true, compat: COMPAT_LEVEL });
  logLine(`start v${app.getVersion()}`, `windows ${os.release()}`, `compat ${COMPAT_LEVEL}`, `gpu ${isGpuAccelerationEnabled() ? "on" : "off"}`);
  app.on("child-process-gone", (_e, details) => {
    logLine("process gone", details);
    // The graphics part crashing (driver or antivirus): turn acceleration off
    if (details.type === "GPU" && details.reason !== "clean-exit" && !isQuitting && COMPAT_LEVEL < 2) relaunchSafer(`gpu ${details.reason}`);
  });
  // Only the installed app claims eco:// (a dev checkout would steal the links)
  if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  ipcMain.handle("DISCORD_DEEP_LINK_TAKE", () => {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    return url;
  });
  // Browser permissions (microphone, camera, screen, notifications...) only for
  // the app's own pages; anything else that ends up loaded gets nothing
  const isAppPage = (url) => String(url || "").toLowerCase().startsWith(APP_PAGES_URL);
  // A development checkout (or a test run) never shows Windows notifications:
  // it is not the installed app, so Windows would title them with a raw id
  const allowed = (permission, url) => isAppPage(url) && (app.isPackaged || permission !== "notifications");
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed(permission, (details && details.requestingUrl) || (wc && wc.getURL())));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => {
    return allowed(permission, (details && details.requestingUrl) || (wc && wc.getURL()));
  });
  // No <webview>, no navigation away from the app's pages, no new windows, in
  // any web contents (the main window also sends web links to the browser)
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-navigate", (event, url) => {
      if (!isAppPage(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
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
  renameOldShortcuts();
  ensureNotificationShortcut();
  setupSystemTray();
  applyMuteHotkey(getMuteHotkey());
  // Compiles the tiny memory helper the first time (a second or two, in the background)
  prepareHelper(app.getPath("userData"))
    .then(() => applyMemoryCaps())
    .catch(() => null);
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

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  // A normal quit is not a failed start
  if (gotSingleInstanceLock && !markedHealthy) writeStartupState({ pending: false, compat: COMPAT_LEVEL });
});

process.on("uncaughtException", (err) => logLine("uncaught exception:", String((err && err.stack) || err).slice(0, 1500)));
process.on("unhandledRejection", (err) => logLine("unhandled rejection:", String((err && err.stack) || err).slice(0, 800)));

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
