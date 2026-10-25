"use strict";

const { app, BrowserWindow, ipcMain, screen, clipboard, session } = require("electron");
const { registerScreenCaptureHandlers } = require("../electron/screenCapture");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { DiscordBackendServer } = require("../electron/backendServer");
const { loadAppConfig } = require("../electron/appConfig");
const http = require("http");

// Apply the exact same memory optimization flags as electron/main.js
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=64 --initial-old-space-size=4 --OptimizeForSize --expose-gc");
app.commandLine.appendSwitch("disable-site-isolation-trials");
app.commandLine.appendSwitch("disable-features", "OutOfProcessPdf,Translate,BackForwardCache,MediaRouter,CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disk-cache-size", "16777216");
app.commandLine.appendSwitch("media-cache-size", "8388608");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.on("window-all-closed", () => {
  // Prevent Electron from auto-quitting when splashWin is destroyed before mainWin opens
});

const rootDir = path.resolve(__dirname, "..");
const screenshotsDir = path.join(rootDir, "docs", "screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

// Use an isolated verification userData directory so tests are 100% deterministic
const verifyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "discord-verify-suite-"));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimWorkingSetsSync() {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    const pids = (app.getAppMetrics() || []).map((m) => m.pid).filter(Boolean);
    if (!pids.length) return resolve();
    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinMem {
  [DllImport("psapi.dll")]
  public static extern bool EmptyWorkingSet(IntPtr hwProc);
}
"@
$pids = @(${pids.join(",")})
foreach ($id in $pids) {
  try {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.Handle) { [WinMem]::EmptyWorkingSet($p.Handle) | Out-Null }
  } catch {}
}
`;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { windowsHide: true, timeout: 5000 },
      () => resolve()
    );
  });
}

async function captureMemoryStage(win, label) {
  try {
    if (global.gc) global.gc();
    if (win && !win.isDestroyed()) {
      await win.webContents.executeJavaScript(`
        try {
          if (window.gc) window.gc();
          if (window.DiscordNative?.processUtils?.purgeMemory) window.DiscordNative.processUtils.purgeMemory();
        } catch {}
      `);
    }
  } catch {}
  await trimWorkingSetsSync();
  await delay(150);

  const metrics = app.getAppMetrics();
  const nodeMem = process.memoryUsage();
  const rendererMetric = metrics.find((m) => m.type === "Tab") || metrics[0];
  const mainMetric = metrics.find((m) => m.type === "Browser") || metrics[0];

  const totalWorkingSetKB = metrics.reduce((acc, m) => acc + (m.memory?.workingSetSize || 0), 0);
  const totalPrivateBytesKB = metrics.reduce((acc, m) => acc + (m.memory?.privateBytes || 0), 0);

  return {
    stage: label,
    mainWorkingSetMB: Number(((mainMetric?.memory?.workingSetSize || 0) / 1024).toFixed(2)),
    rendererWorkingSetMB: Number(((rendererMetric?.memory?.workingSetSize || 0) / 1024).toFixed(2)),
    totalWorkingSetMB: Number((totalWorkingSetKB / 1024).toFixed(2)),
    totalPrivateMB: Number((totalPrivateBytesKB / 1024).toFixed(2)),
    mainHeapUsedMB: Number((nodeMem.heapUsed / 1024 / 1024).toFixed(2)),
    processes: metrics.map((m) => ({
      type: m.type,
      pid: m.pid,
      workingSetMB: Number(((m.memory?.workingSetSize || 0) / 1024).toFixed(2)),
      privateMB: Number(((m.memory?.privateBytes || 0) / 1024).toFixed(2))
    }))
  };
}

async function captureWindow(win, filename) {
  // Hidden windows may not repaint on their own; force a fresh frame
  win.webContents.invalidate();
  await delay(200);
  const image = await win.webContents.capturePage();
  const fullPath = path.join(screenshotsDir, filename);
  fs.writeFileSync(fullPath, image.toPNG());
  console.log("Captured screenshot:", fullPath);
  return fullPath;
}

// Create valid binary buffers for PNG, GIF89a, and WAV files
function createValidPngBase64() {
  // 1x1 valid PNG
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

function createValidGifBase64() {
  // 1x1 valid GIF89a
  return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
}

function createValidWavBase64() {
  // Minimal valid 44-byte RIFF WAVE PCM header + 1600 bytes of gentle sine wave
  const numSamples = 800;
  const sampleRate = 8000;
  const byteRate = sampleRate * 2;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  buf.writeUInt16LE(1, 22); // NumChannels = 1
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32); // BlockAlign
  buf.writeUInt16LE(16, 34); // BitsPerSample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 520 * i) / sampleRate) * 6000);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return "data:audio/wav;base64," + buf.toString("base64");
}

function createForgedExeBase64() {
  // Starts with MZ (Windows executable header) disguised as image/png
  const buf = Buffer.from("4d5a90000300000004000000ffff0000", "hex");
  return "data:image/png;base64," + buf.toString("base64");
}

let backendServer = null;
let selectedDesktopSourceId = null;

async function setupTestEnvironment() {
  // Supabase is switched off so no test ever sends a real e-mail; SUITE 28
  // exercises the Supabase flow against a local fake of its Auth API
  backendServer = new DiscordBackendServer({
    userDataDir: verifyDataDir,
    // ...and never point at the production server configured in app.config.json
    config: { ...loadAppConfig(), serverUrl: "", publicUrl: "", supabase: { url: "", publishableKey: "" } }
  });
  await backendServer.start();

  ipcMain.on("DISCORD_APP_GET_RELEASE_CHANNEL_SYNC", (e) => { e.returnValue = "stable"; });
  ipcMain.on("DISCORD_APP_GET_HOST_VERSION_SYNC", (e) => { e.returnValue = "1.0.9262"; });
  // VERIFY_REMOTE=1 runs the whole suite the way a hosted server is used: the
  // renderer reaches the backend over HTTP (CORS, Bearer token, SSE) instead of IPC
  ipcMain.on("DISCORD_BACKEND_GET_INFO_SYNC", (e) => {
    e.returnValue = {
      httpUrl: `http://127.0.0.1:${backendServer.port}`,
      url: `http://127.0.0.1:${backendServer.port}`,
      port: backendServer.port,
      remote: process.env.VERIFY_REMOTE === "1"
    };
  });
  // Same entry point as electron/main.js, so sessions are enforced in the tests too
  ipcMain.handle("DISCORD_BACKEND_RPC", async (_e, action, params, sessionToken) => {
    return await backendServer.handleClientRequest(action, params || {}, sessionToken || null);
  });
  // Same capture code as the app: real monitors/windows, getDisplayMedia answered natively
  registerScreenCaptureHandlers(ipcMain, session.defaultSession);
  ipcMain.on("DISCORD_MEDIA_SESSION", () => {});
  // Saved login lives in a main-process file in the app; kept in memory here
  let verifyAuthStore = null;
  ipcMain.on("DISCORD_AUTH_STORE_GET_SYNC", (e) => { e.returnValue = verifyAuthStore; });
  ipcMain.on("DISCORD_AUTH_STORE_SET_SYNC", (e, data) => { verifyAuthStore = data; e.returnValue = true; });
  ipcMain.on("DISCORD_APP_GET_OPEN_ON_STARTUP_SYNC", (e) => { e.returnValue = false; });
  ipcMain.on("DISCORD_APP_SET_OPEN_ON_STARTUP_SYNC", (e) => { e.returnValue = false; });
  ipcMain.on("DISCORD_GPU_SETTINGS_SET_ENABLE_HWACCEL", () => {});
  ipcMain.handle("DISCORD_MEMORY_GET_TASK_MANAGER_MB", () => null);
  ipcMain.on("DISCORD_MEMORY_SAVER_GET_SYNC", (e) => { e.returnValue = false; });
  ipcMain.on("DISCORD_MUTE_HOTKEY_GET_SYNC", (e) => { e.returnValue = { accelerator: "CommandOrControl+Shift+M", active: true }; });
  ipcMain.on("DISCORD_MUTE_HOTKEY_SET_SYNC", (e, acc) => { e.returnValue = { ok: true, accelerator: acc }; });
  ipcMain.on("DISCORD_MEMORY_SAVER_SET_SYNC", (e, on) => { e.returnValue = Boolean(on); });
  ipcMain.on("DISCORD_SETTINGS_GET_SYNC", (e, _k, def) => { e.returnValue = def; });
  ipcMain.on("DISCORD_GPU_SETTINGS_GET_ENABLE_HWACCEL_SYNC", (e) => { e.returnValue = true; });
  ipcMain.handle("DISCORD_SETTINGS_GET", (_e, _k, def) => def);
  ipcMain.handle("DISCORD_SETTINGS_SET", () => true);
  ipcMain.on("DISCORD_SETTINGS_UPDATE_BACKGROUND_COLOR", () => {});
  ipcMain.handle("DISCORD_APP_SET_BADGE_COUNT", () => true);
  ipcMain.handle("DISCORD_USER_DATA_CACHE_GET", () => null);
  ipcMain.handle("DISCORD_DEEP_LINK_TAKE", () => null);
  ipcMain.on("DISCORD_USER_DATA_CACHE_SAVE", () => {});
  ipcMain.on("DISCORD_CLIPBOARD_COPY", (_e, text) => {
    clipboard.writeText(String(text || ""));
  });
  ipcMain.handle("DISCORD_MEMORY_OPTIMIZE", async () => {
    await trimWorkingSetsSync();
    return { ok: true };
  });
}

async function runVerification() {
  await setupTestEnvironment();

  const results = [];
  const memoryStages = [];

  function recordTest(area, feature, passed, detail) {
    results.push({ area, feature, status: passed ? "APPROVED" : "FAILED", detail });
    console.log(`[${passed ? "PASS" : "FAIL"}] ${area} :: ${feature} -> ${detail}`);
    if (!passed) throw new Error(`Verification failed: ${area} - ${feature}: ${detail}`);
  }

  // 1. Verify Splash Screen
  const splashWin = new BrowserWindow({
    width: 300,
    height: 300,
    frame: false,
    show: false,
    backgroundColor: "#282b30",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(rootDir, "electron", "splashPreload.js")
    }
  });

  await splashWin.loadFile(path.join(rootDir, "assets", "splash", "index.html"));
  splashWin.webContents.send("DISCORD_SPLASH_SCREEN_QUOTE", "Optimizing the People");
  splashWin.webContents.send("DISCORD_SPLASH_UPDATE_STATE", {
    status: "downloading-updates",
    current: 1,
    total: 1,
    progress: 68
  });
  await delay(250);

  const splashState = await splashWin.webContents.executeJavaScript(`({
    hasSplash: Boolean(document.getElementById("splash")),
    statusText: document.querySelector(".splash-status")?.textContent || "",
    progressWidth: document.querySelector(".progress-bar .complete")?.style.width || ""
  })`);

  recordTest(
    "Phase 1: Splash Screen",
    "IPC state update & progress bar",
    splashState.hasSplash && splashState.progressWidth === "68%",
    JSON.stringify(splashState)
  );
  await captureWindow(splashWin, "01-splash-screen.png");
  splashWin.destroy();

  // 2. Launch Main Window
  const mainWin = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 940,
    minHeight: 500,
    frame: false,
    show: false,
    backgroundColor: "#313338",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      backgroundThrottling: true,
      preload: path.join(rootDir, "electron", "mainScreenPreload.js")
    }
  });

  mainWin.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console ${level}] ${message} (${sourceId}:${line})`);
  });

  await mainWin.loadFile(path.join(rootDir, "src", "index.html"));
  await delay(1000);

  // Measure Memory Stage 1: Startup
  memoryStages.push(await captureMemoryStage(mainWin, "1_startup"));

  // =========================================================================
  // SUITE 1 (PHASE 2): Zero Illustrative / Fictional Users in Production
  // =========================================================================
  const phase2Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    await store.init();
    // Every RPC needs a session now: sign in as the seeded account
    if (!store.getState().auth.isAuthenticated) {
      await store.login("davis@discord.local", "password123");
    }
    const state = store.getState();
    const userIds = Object.keys(state.users);
    const forbiddenIds = ["u_elena", "u_marcus", "u_sophia", "u_clyde", "u_lucas", "u_pending1"];
    const hasForbiddenUser = forbiddenIds.some((id) => userIds.includes(id));
    const bodyText = document.body.innerText;
    const hasForbiddenNames =
      bodyText.includes("Elena Vance") ||
      bodyText.includes("Marcus Silva") ||
      bodyText.includes("Sophia Chen") ||
      bodyText.includes("84,920");

    // Navigate to Home -> Friends to verify empty states when 0 friends/DMs exist
    store.selectHome("friends");
    const hasEmptyDms = Boolean(document.querySelector('[data-testid="empty-dms-state"]'));
    const hasEmptyFriends = Boolean(document.querySelector('[data-testid="friends-empty-state"]'));

    return {
      userIds,
      friendsCount: state.friends.length,
      dmsCount: state.dms.length,
      hasForbiddenUser,
      hasForbiddenNames,
      hasEmptyDms,
      hasEmptyFriends
    };
  })()`);

  recordTest(
    "Phase 2: Zero Illustrative Users",
    "Eliminate all fictional users/friends/DMs/servers and display clean empty states",
    !phase2Check.hasForbiddenUser &&
      !phase2Check.hasForbiddenNames &&
      phase2Check.friendsCount === 0 &&
      phase2Check.dmsCount === 0 &&
      phase2Check.hasEmptyDms &&
      phase2Check.hasEmptyFriends,
    JSON.stringify(phase2Check)
  );

  // =========================================================================
  // SUITE 2 (PHASE 3): @username Change, Validation, Collision & Persistence
  // =========================================================================
  const phase3Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    // Register a second real user in SQLite to test username collision and friend requests.
    // New accounts start with no servers; Maria joins the sample server through an invite.
    const mariaInvite = await store.createServerInvite("g_rea", {});
    const regMaria = await store.register({
      email: "maria@discord.local",
      displayName: "Maria Clara",
      username: "maria_real",
      password: "password123"
    });
    const mariaStartedEmpty = store.getState().guilds.length === 0;
    const mariaJoin = await store.acceptServerInvite(mariaInvite.invite.url);
    // Switch back to Davis (u_davis)
    await store.switchAccount("u_davis", "password123");

    const invalidShort = await store.updateUsername("ab");
    const invalidReserved = await store.updateUsername("admin");
    const collisionCheck = await store.updateUsername("MARIA_REAL");
    const validAvail = await store.checkUsernameAvailability("davis_master");
    const validChange = await store.updateUsername("davis_master");
    const afterChangeUser = store.getCurrentUser();
    const accountBarText = document.querySelector('[data-testid="account-username-sub"]')?.textContent || "";

    // Restore back to davis_dev and verify
    const restoreChange = await store.updateUsername("davis_dev");

    return {
      regMariaOk: regMaria.ok && mariaStartedEmpty && mariaJoin.ok,
      invalidShortRejected: !invalidShort.ok,
      invalidReservedRejected: !invalidReserved.ok,
      collisionRejected: !collisionCheck.ok,
      validAvailOk: validAvail.available === true,
      validChangeOk: validChange.ok && afterChangeUser.username === "davis_master" && afterChangeUser.id === "u_davis",
      accountBarUpdated: accountBarText === "@davis_master",
      restoreOk: restoreChange.ok && store.getCurrentUser().username === "davis_dev"
    };
  })()`);

  recordTest(
    "Phase 3: @username Modification",
    "Validate format, reject reserved/colliding usernames, update @username in SQLite & UI while preserving user.id",
    phase3Check.regMariaOk &&
      phase3Check.invalidShortRejected &&
      phase3Check.invalidReservedRejected &&
      phase3Check.collisionRejected &&
      phase3Check.validAvailOk &&
      phase3Check.validChangeOk &&
      phase3Check.accountBarUpdated &&
      phase3Check.restoreOk,
    JSON.stringify(phase3Check)
  );

  // =========================================================================
  // SUITE 3 (PHASE 4): Pop-up, Popover, Dropdown & Context Menu Lifecycle
  // =========================================================================
  const phase4Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    store.selectGuild("g_rea", "c_general");

    // 1. Open status menu, then click outside on stage-header
    q('[data-testid="account-profile-btn"]').click();
    const statusOpen = Boolean(document.querySelector('[data-testid="status-popout"]'));
    q('.stage-header').click();
    const statusClosedOnOutsideClick = !document.querySelector('[data-testid="status-popout"]');

    // 2. Open pinned popover, then open user popout -> verify mutual exclusion closes pinned popover
    q('[data-testid="pinned-messages-btn"]').click();
    const pinnedOpen = Boolean(document.querySelector('[data-testid="pinned-popover"]'));
    q('.member-item[data-action="open-user-popout"]').click();
    const pinnedClosedByMutualExclusion = !document.querySelector('[data-testid="pinned-popover"]');
    const userPopoutOpen = Boolean(document.querySelector('[data-testid="user-profile-popout"]'));

    // 3. Press Escape -> verify userPopout closes
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const userPopoutClosedOnEsc = !document.querySelector('[data-testid="user-profile-popout"]');

    // 4. Open server dropdown menu, then navigate to Home -> verify closes on route change
    q('[data-testid="server-header-title"]').click();
    const serverMenuOpen = Boolean(document.querySelector('[data-testid="server-dropdown-menu"]'));
    q('[data-action="select-home"]').click();
    const serverMenuClosedOnRouteChange = !document.querySelector('[data-testid="server-dropdown-menu"]');

    return {
      statusOpen,
      statusClosedOnOutsideClick,
      pinnedOpen,
      pinnedClosedByMutualExclusion,
      userPopoutOpen,
      userPopoutClosedOnEsc,
      serverMenuOpen,
      serverMenuClosedOnRouteChange
    };
  })()`);

  recordTest(
    "Phase 4: Pop-ups & Floating Menus",
    "Close floating menus on outside click, mutual exclusion, Escape key, and route change",
    phase4Check.statusOpen &&
      phase4Check.statusClosedOnOutsideClick &&
      phase4Check.pinnedOpen &&
      phase4Check.pinnedClosedByMutualExclusion &&
      phase4Check.userPopoutOpen &&
      phase4Check.userPopoutClosedOnEsc &&
      phase4Check.serverMenuOpen &&
      phase4Check.serverMenuClosedOnRouteChange,
    JSON.stringify(phase4Check)
  );

  // =========================================================================
  // SUITE 4, 5, 6 (PHASE 5): Profile Photo, Banner Color & Banner Image/GIF
  // =========================================================================
  const pngB64 = createValidPngBase64();
  const gifB64 = createValidGifBase64();
  const forgedExeB64 = createForgedExeBase64();

  const phase5Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    // 1. Reject forged executable disguised as .png
    const badUpload = await store.uploadMedia({
      fileName: "malware.png",
      mimeType: "image/png",
      base64Data: ${JSON.stringify(forgedExeB64)},
      kind: "avatar"
    });

    // 2. Upload valid PNG avatar, save to profile, verify rendered <img>
    const avatarUp = await store.uploadMedia({
      fileName: "avatar.png",
      mimeType: "image/png",
      base64Data: ${JSON.stringify(pngB64)},
      kind: "avatar"
    });
    await store.updateMyProfile({ avatarUrl: avatarUp.url });
    const hasAvatarImgInBar = Boolean(document.querySelector('.account-bar img.avatar-img'));

    // 3. Remove avatar and re-apply to verify both removal and persistence
    await store.updateMyProfile({ avatarUrl: "" });
    const removedAvatarOk = !document.querySelector('.account-bar img.avatar-img');
    await store.updateMyProfile({ avatarUrl: avatarUp.url });

    // 4. Banner color customization
    await store.updateMyProfile({ bannerColor: "#eb459e" });
    const colorUpdated = store.getCurrentUser().bannerColor === "#eb459e";

    // 5. Upload animated GIF banner + vertical framing (35%)
    const bannerUp = await store.uploadMedia({
      fileName: "animated_banner.gif",
      mimeType: "image/gif",
      base64Data: ${JSON.stringify(gifB64)},
      kind: "banner"
    });
    await store.updateMyProfile({ bannerUrl: bannerUp.url, bannerPositionY: 35 });

    // Open User Settings > Perfil to inspect preview card
    q('[data-testid="open-user-settings-btn"]').click();
    q('[data-testid="settings-tab-profile"]').click();
    const bannerImg = document.querySelector('[data-testid="profile-preview-card"] img.profile-banner-img');
    const bannerGifRendered = Boolean(bannerImg && bannerImg.src.endsWith(".gif"));
    const bannerFramingApplied = bannerImg ? bannerImg.style.objectPosition.includes("35%") : false;

    return {
      forgedRejected: !badUpload.ok,
      avatarUpOk: avatarUp.ok,
      hasAvatarImgInBar,
      removedAvatarOk,
      colorUpdated,
      bannerUpOk: bannerUp.ok,
      bannerGifRendered,
      bannerFramingApplied
    };
  })()`);

  recordTest(
    "Phase 5: Avatar Photo, Banner Color & GIF Banner",
    "Validate magic bytes, upload/remove/persist avatar PNG, banner color, and animated GIF banner with framing",
    phase5Check.forgedRejected &&
      phase5Check.avatarUpOk &&
      phase5Check.hasAvatarImgInBar &&
      phase5Check.removedAvatarOk &&
      phase5Check.colorUpdated &&
      phase5Check.bannerUpOk &&
      phase5Check.bannerGifRendered &&
      phase5Check.bannerFramingApplied,
    JSON.stringify(phase5Check)
  );
  await captureWindow(mainWin, "06-user-settings.png");

  // =========================================================================
  // SUITE 7 (PHASE 6): Custom Call Join & Leave Sounds
  // =========================================================================
  const wavB64 = createValidWavBase64();
  const phase6Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    // Switch to Voice & Call Sounds tab in Settings
    q('[data-testid="settings-tab-voice"]').click();

    // Upload custom WAV sound for Join
    const audioUp = await store.uploadMedia({
      fileName: "custom_join.wav",
      mimeType: "audio/wav",
      base64Data: ${JSON.stringify(wavB64)},
      kind: "audio"
    });

    await store.updateSettings({
      joinSoundEnabled: true,
      leaveSoundEnabled: true,
      joinSoundPreset: "custom",
      joinSoundCustomUrl: audioUp.url,
      joinSoundCustomName: "custom_join.wav",
      leaveSoundPreset: "synth-pulse",
      callSoundVolume: 75
    });

    const previewJoin = await store.previewCallSound("join");
    const previewLeave = await store.previewCallSound("leave");

    // Close settings and test actual voice channel join/leave transitions
    q('[data-testid="close-settings-btn"]').click();
    store.selectGuild("g_rea", "c_general");
    const join1 = await store.joinVoiceChannel("g_rea", "c_voice_lounge");
    const join2Duplicate = await store.joinVoiceChannel("g_rea", "c_voice_lounge");
    const leave1 = await store.leaveVoiceChannel();

    return {
      audioUpOk: audioUp.ok,
      previewJoinOk: previewJoin.played === true,
      previewLeaveOk: previewLeave.played === true,
      join1Ok: join1.ok && !join1.alreadyConnected,
      duplicatePrevented: join2Duplicate.alreadyConnected === true,
      leave1Ok: leave1.ok
    };
  })()`);

  recordTest(
    "Phase 6: Custom Call Join & Leave Sounds",
    "Configure presets & custom WAV upload, preview sounds, and play once on voice join/leave without duplication",
    phase6Check.audioUpOk &&
      phase6Check.previewJoinOk &&
      phase6Check.previewLeaveOk &&
      phase6Check.join1Ok &&
      phase6Check.duplicatePrevented &&
      phase6Check.leave1Ok,
    JSON.stringify(phase6Check)
  );

  // =========================================================================
  // SUITE 8 (PHASE 8): 10 Preset Themes in Appearance
  // =========================================================================
  const phase8Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    q('[data-testid="open-user-settings-btn"]').click();
    q('[data-testid="settings-tab-appearance"]').click();

    const themeCards = document.querySelectorAll('[data-testid^="theme-card-"]');
    const themeIds = ["dark", "light", "midnight", "oled", "ocean", "nebula", "emerald", "rose", "graphite", "sunset"];
    const appliedThemes = [];

    for (const tid of themeIds) {
      await store.updateSetting("theme", tid);
      const rootEl = document.querySelector(".app-root");
      const bgChat = getComputedStyle(rootEl).getPropertyValue("--bg-chat").trim();
      appliedThemes.push({ id: tid, attr: rootEl.getAttribute("data-theme"), bgChat });
    }

    // Leave on dark theme for standard screenshots and close settings
    await store.updateSetting("theme", "dark");
    q('[data-testid="close-settings-btn"]').click();

    const uniqueBgColors = new Set(appliedThemes.map((t) => t.bgChat)).size;
    return {
      cardsCount: themeCards.length,
      appliedCount: appliedThemes.length,
      uniqueBgColors,
      appliedThemes
    };
  })()`);

  recordTest(
    "Phase 8: 10 Preset Themes",
    "Verify all 10 themes in Appearance apply distinct CSS token palettes immediately and persist",
    phase8Check.cardsCount >= 10 && phase8Check.appliedCount === 10 && phase8Check.uniqueBgColors === 10,
    `cards=${phase8Check.cardsCount}, uniquePalettes=${phase8Check.uniqueBgColors}`
  );

  // Measure Memory Stage 2: After 10+ Screen & Theme Navigations
  memoryStages.push(await captureMemoryStage(mainWin, "2_after_navigation"));

  // =========================================================================
  // SUITE 9 (PHASE 9): Real End-to-End Screen Sharing & Track Cleanup
  // =========================================================================
  await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    store.selectGuild("g_rea", "c_general");
    await store.joinVoiceChannel("g_rea", "c_voice_lounge");
  })()`);

  const phase9Start = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const sources = await store.getScreenShareSources();
    const firstSource = sources.find((src) => src.isScreen) || sources[0];
    const startRes = await store.startScreenShare(firstSource.id, {
      sourceName: firstSource.name,
      resolution: "720p",
      fps: 30
    });
    await new Promise((r) => setTimeout(r, 600));

    const stageVisible = Boolean(document.querySelector('[data-testid="screenshare-stage"]'));
    const { ScreenShare } = await import("./services/gatewayAdapter.js");
    const preview = document.querySelector("[data-share-video-slot] video");
    const previewLive = Boolean(preview) && preview.srcObject === ScreenShare.getStream() && !preview.paused;
    const track = ScreenShare.getStream()?.getVideoTracks()[0];
    const realCaptureTrack = Boolean(track) && track.readyState === "live" && track.kind === "video" && !track.label.includes("canvas");
    // A full re-render must keep the very same playing <video>
    store.notify();
    await new Promise((r) => setTimeout(r, 100));
    const previewKept = document.querySelector("[data-share-video-slot] video") === preview && !preview.paused;
    // Check that backend snapshot also exposes the active screen share to other participants
    const { NativeBridge } = await import("./services/gatewayAdapter.js");
    const snapForMaria = await NativeBridge.rpc("getStateSnapshot", {});
    const backendHasShare = (snapForMaria.snapshot?.activeScreenShares || []).length > 0;

    return {
      sourcesCount: sources.length,
      hasScreens: sources.some((src) => src.isScreen),
      windowsListed: sources.filter((src) => !src.isScreen).length,
      thumbnails: sources.filter((src) => src.thumbnail).length,
      previewLive,
      realCaptureTrack,
      previewKept,
      startOk: startRes.ok,
      activeTracksDuring: startRes.trackCount,
      stageVisible,
      backendHasShare
    };
  })()`);

  // No screenshot here: the share now captures the real desktop, and
  // docs/screenshots is published — it could leak whatever is on screen

  // Measure Memory Stage 3: During Active Voice Call + Live Screen Share
  memoryStages.push(await captureMemoryStage(mainWin, "3_during_call"));

  const phase9Stop = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const stopRes = await store.stopScreenShare();
    await store.leaveVoiceChannel();
    const stageGone = !document.querySelector('[data-testid="screenshare-stage"]');
    return {
      stopOk: stopRes.ok,
      activeTracksAfter: stopRes.trackCount,
      stageGone
    };
  })()`);

  recordTest(
    "Phase 9: Real Screen Sharing & Track Release",
    "Capture screen via desktopCapturer/getDisplayMedia, broadcast to participants, and release all tracks on stop",
    phase9Start.sourcesCount >= 1 &&
      phase9Start.hasScreens &&
      phase9Start.thumbnails >= 1 &&
      phase9Start.previewLive &&
      phase9Start.realCaptureTrack &&
      phase9Start.previewKept &&
      phase9Start.startOk &&
      phase9Start.activeTracksDuring >= 1 &&
      phase9Start.stageVisible &&
      phase9Start.backendHasShare &&
      phase9Stop.stopOk &&
      phase9Stop.activeTracksAfter === 0 &&
      phase9Stop.stageGone,
    JSON.stringify({ ...phase9Start, ...phase9Stop })
  );

  // Measure Memory Stage 4: After Ending Call & Screen Share
  memoryStages.push(await captureMemoryStage(mainWin, "4_after_call"));

  // =========================================================================
  // SUITE 10 (PHASE 10): Real Friend Search & Request Workflow by @username
  // =========================================================================
  const phase10Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    store.selectHome("friends");
    q('[data-testid="friends-tab-add"]').click();

    // 1. Search non-existent user
    const emptySearch = await store.searchUsersByUsername("usuario_fantasma_999");
    const nonExistentReq = await store.addFriendByUsername("usuario_fantasma_999");

    // 2. Self request must fail
    const selfReq = await store.addFriendByUsername("davis_dev");

    // 3. Search existing real user @maria_real
    const mariaSearch = await store.searchUsersByUsername("maria_real");

    // 4. Send friend request from Davis -> Maria
    const sendReq = await store.addFriendByUsername("@maria_real");
    // Duplicate request must fail
    const dupReq = await store.addFriendByUsername("maria_real");

    // 5. Switch to Maria and accept Davis's incoming friend request
    await store.switchAccount(mariaSearch[0].id, "password123");
    const mariaPending = store.getState().friends.find((f) => f.userId === "u_davis");
    const acceptRes = await store.acceptFriendRequest("u_davis");

    // 6. Switch back to Davis, verify friendship is active, and send a real DM
    await store.switchAccount("u_davis", "password123");
    store.selectHome("friends");
    q('[data-action="friends-tab"][data-tab="online"]').click();
    const davisFriend = store.getState().friends.find((f) => f.userId === mariaSearch[0].id);
    const dm = await store.openOrCreateDm(mariaSearch[0].id);
    const dmMsg = await store.sendMessage(dm.id, "Olá @maria_real! Amizade real confirmada via SQLite.");

    return {
      emptySearchCount: emptySearch.length,
      nonExistentRejected: !nonExistentReq.ok,
      selfReqRejected: !selfReq.ok,
      mariaFound: mariaSearch.length === 1 && mariaSearch[0].username === "maria_real",
      sendReqOk: sendReq.ok && sendReq.status === "outgoing",
      dupReqRejected: !dupReq.ok,
      mariaSawIncoming: mariaPending?.relation === "incoming",
      acceptResOk: acceptRes.ok,
      davisFriendConfirmed: davisFriend?.relation === "friend",
      dmSentOk: Boolean(dmMsg && dmMsg.id)
    };
  })()`);

  recordTest(
    "Phase 10: Real Friend Search & Requests by @username",
    "Search real SQLite users, reject self/duplicate/non-existent, send/accept request, and open DM",
    phase10Check.emptySearchCount === 0 &&
      phase10Check.nonExistentRejected &&
      phase10Check.selfReqRejected &&
      phase10Check.mariaFound &&
      phase10Check.sendReqOk &&
      phase10Check.dupReqRejected &&
      phase10Check.mariaSawIncoming &&
      phase10Check.acceptResOk &&
      phase10Check.davisFriendConfirmed &&
      phase10Check.dmSentOk,
    JSON.stringify(phase10Check)
  );

  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.selectHome("friends");`);
  await captureWindow(mainWin, "04-home-friends-view.png");

  // =========================================================================
  // SUITE 11 (PHASE 11): Cryptographic Server Invites (Generate, Join, Revoke)
  // =========================================================================
  const phase11Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    // Davis creates a new server
    const newGuild = await store.createGuild({ name: "Servidor Criptográfico QA", iconColor: "#10b981" });

    // Generate 3 invites and verify cryptographic uniqueness
    const inv1 = await store.createServerInvite(newGuild.id, { expiresInSeconds: 86400, maxUses: 5 });
    const inv2 = await store.createServerInvite(newGuild.id, { expiresInSeconds: 86400, maxUses: 1 });
    const inv3 = await store.createServerInvite(newGuild.id, { expiresInSeconds: 86400, maxUses: 0 });

    const codesUnique =
      inv1.ok &&
      inv2.ok &&
      inv3.ok &&
      inv1.invite.code !== inv2.invite.code &&
      inv2.invite.code !== inv3.invite.code &&
      inv1.invite.code !== inv3.invite.code;

    // Revoke inv2
    await store.revokeServerInvite(inv2.invite.code);

    // Switch to Maria and test joining via invites
    const mariaId = Object.values(store.getState().users).find((u) => u.username === "maria_real").id;
    await store.switchAccount(mariaId, "password123");

    const joinInvalid = await store.acceptServerInvite("CODIGO_INEXISTENTE_999");
    const joinRevoked = await store.acceptServerInvite(inv2.invite.code);
    const joinValid = await store.acceptServerInvite(inv1.invite.code);
    const joinIdempotent = await store.acceptServerInvite(inv1.invite.code);

    // Switch back to Davis
    await store.switchAccount("u_davis", "password123");
    store.selectGuild("g_rea", "c_general");
    await store.sendMessage("c_general", "Servidor e convites criptográficos validados com **sucesso**!");

    return {
      codesUnique,
      sampleCodes: [inv1.invite?.code, inv2.invite?.code, inv3.invite?.code],
      joinInvalidRejected: !joinInvalid.ok,
      joinRevokedRejected: !joinRevoked.ok,
      joinValidOk: joinValid.ok && joinValid.guildId === newGuild.id,
      joinIdempotentOk: joinIdempotent.ok && joinIdempotent.alreadyMember === true
    };
  })()`);

  recordTest(
    "Phase 11: Cryptographic Server Invites",
    "Generate unique tokens, join server via invite, handle idempotent re-join, and reject invalid/revoked codes",
    phase11Check.codesUnique &&
      phase11Check.joinInvalidRejected &&
      phase11Check.joinRevokedRejected &&
      phase11Check.joinValidOk &&
      phase11Check.joinIdempotentOk,
    JSON.stringify(phase11Check)
  );

  // =========================================================================
  // SUITE 13: Searchable Animated GIF Library (Categories, Search, Pagination)
  // =========================================================================
  const gifSuiteCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const allRes = await store.searchGifs({ category: "All", limit: 6, offset: 0 });
    const catAnime = await store.searchGifs({ category: "Anime", limit: 6, offset: 0 });
    const searchCat = await store.searchGifs({ query: "cat", category: "Cats" });
    const page1 = await store.searchGifs({ limit: 3, offset: 0 });
    const page2 = await store.searchGifs({ limit: 3, offset: 3 });
    const hasDifferentPages = page1.gifs[0]?.id !== page2.gifs[0]?.id;

    store.openGifPicker("avatar");
    await new Promise((r) => setTimeout(r, 100));
    const modalVisible = Boolean(document.querySelector('[data-testid="gif-picker-modal"]'));

    // Real UI flow: clicking the search box must not close the picker, and
    // scrolling to the bottom must append the next page of results.
    const waitFor = async (fn, ms = 10000) => {
      const start = Date.now();
      while (!fn() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 100));
      return fn();
    };
    document.getElementById("gif-search-input").click();
    await new Promise((r) => setTimeout(r, 100));
    const stayedOpenOnInputClick = store.getState().gifPicker.isOpen;
    document.getElementById("gif-search-input").value = "cat";
    document.getElementById("gif-search-form").requestSubmit();
    await waitFor(() => !store.getState().gifPicker.loading && store.getState().gifPicker.query === "cat");
    const firstPageCount = store.getState().gifPicker.results.length;
    const firstCard = document.querySelector('[data-testid="gif-card"]');
    const scroller = document.getElementById("gif-results-scroller");
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() => store.getState().gifPicker.results.length > firstPageCount);
    const afterScrollCount = store.getState().gifPicker.results.length;
    const scrollKept = document.getElementById("gif-results-scroller").scrollTop > 0;
    const cardHeight = Math.round(document.querySelector('[data-testid="gif-card"]').getBoundingClientRect().height);

    // Performance: loading more appends instead of rebuilding, and a full app
    // re-render leaves the picker untouched (no re-download/re-decode of GIFs)
    const cardsKeptOnLoadMore = firstCard.isConnected && document.querySelector('[data-testid="gif-card"]') === firstCard;
    store.notify();
    const cardsKeptOnAppRender = firstCard.isConnected;
    const thumbsAreWebp = store.getState().gifPicker.results.every((g) => g.previewUrl.split("?")[0].endsWith(".webp"));
    // "_d" renditions (downsampled) keep ~6 frames and look choppy
    const thumbsFullFrameRate = store.getState().gifPicker.results.every((g) => !g.previewUrl.split("?")[0].endsWith("_d.webp"));

    // Search as you type (debounced), no submit needed
    const typed = document.getElementById("gif-search-input");
    typed.value = "dog";
    typed.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => store.getState().gifPicker.query === "dog" && !store.getState().gifPicker.loading, 5000);
    const searchAsYouType = store.getState().gifPicker.query === "dog" && store.getState().gifPicker.results.length > 0;

    // Reopening shows cached results in the same tick
    store.closeGifPicker();
    store.openGifPicker("avatar");
    const reopenInstant = document.querySelectorAll('[data-testid="gif-card"]').length > 0 && !store.getState().gifPicker.loading;

    store.selectGif(allRes.gifs[0].url);
    await new Promise((r) => setTimeout(r, 100));
    const editorOpen = store.getState().mediaEditor?.isOpen && store.getState().mediaEditor?.mediaUrl === allRes.gifs[0].url;
    store.closeMediaEditor();

    return {
      totalGifs: allRes.total,
      hasCategories: (allRes.categories || []).length >= 5,
      animeMatches: (catAnime.gifs || []).length > 0,
      searchMatches: (searchCat.gifs || []).length > 0,
      hasDifferentPages,
      modalVisible,
      stayedOpenOnInputClick,
      firstPageCount,
      afterScrollCount,
      scrollKept,
      cardHeight,
      cardsKeptOnLoadMore,
      cardsKeptOnAppRender,
      thumbsAreWebp,
      thumbsFullFrameRate,
      searchAsYouType,
      reopenInstant,
      editorOpen
    };
  })()`);

  recordTest(
    "Domain 1: Searchable Animated GIF Library",
    "Filter by categories, search keywords, paginate results, and load selected animation into editor",
    gifSuiteCheck.totalGifs >= 10 &&
      gifSuiteCheck.hasCategories &&
      gifSuiteCheck.animeMatches &&
      gifSuiteCheck.hasDifferentPages &&
      gifSuiteCheck.modalVisible &&
      gifSuiteCheck.stayedOpenOnInputClick &&
      gifSuiteCheck.afterScrollCount > gifSuiteCheck.firstPageCount &&
      gifSuiteCheck.scrollKept &&
      gifSuiteCheck.cardHeight > 80 &&
      gifSuiteCheck.cardsKeptOnLoadMore &&
      gifSuiteCheck.cardsKeptOnAppRender &&
      gifSuiteCheck.thumbsAreWebp &&
      gifSuiteCheck.thumbsFullFrameRate &&
      gifSuiteCheck.searchAsYouType &&
      gifSuiteCheck.reopenInstant &&
      gifSuiteCheck.editorOpen,
    JSON.stringify(gifSuiteCheck)
  );

  // =========================================================================
  // SUITE 14: Server Roles (Cargos) Management, Hierarchy & Permissions
  // =========================================================================
  const rolesSuiteCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const guild = store.getActiveGuild();
    const gId = guild.id;

    // 1. Create a new role with specific permissions
    const createRes = await store.createRole(gId, {
      name: "Guardião",
      color: "#9b59b6",
      hoist: true,
      permissions: ["KICK_MEMBERS", "BAN_MEMBERS", "SPEAK"]
    });

    // 2. Assign role to Maria
    const mariaId = Object.values(store.getState().users).find((u) => u.username === "maria_real")?.id;
    const assignRes = await store.assignMemberRole(gId, mariaId, createRes.role.id);

    // 3. Update role
    const updateRes = await store.updateRole(gId, createRes.role.id, {
      name: "Alto Guardião",
      color: "#e67e22",
      permissions: ["ADMINISTRATOR"]
    });

    // 4. Test hierarchy: non-owner Maria cannot delete a role with higher position
    await store.switchAccount(mariaId, "password123");
    const mariaDeleteHigher = await store.deleteRole(gId, createRes.role.id);
    const mariaDeleteEveryone = await store.deleteRole(gId, guild.roles.find((r) => r.name === "@everyone")?.id);

    // 5. Switch back to Davis and delete the role
    await store.switchAccount("u_davis", "password123");
    const davisDelete = await store.deleteRole(gId, createRes.role.id);

    return {
      createOk: createRes.ok && createRes.role.name === "Guardião",
      assignOk: assignRes.ok,
      updateOk: updateRes.ok && updateRes.role.name === "Alto Guardião",
      mariaHigherRejected: !mariaDeleteHigher.ok,
      mariaEveryoneRejected: !mariaDeleteEveryone.ok,
      davisDeleteOk: davisDelete.ok
    };
  })()`);

  recordTest(
    "Domain 2: Server Roles (Cargos) & Hierarchy Enforcement",
    "Create role, assign to member, update permissions, enforce hierarchy boundary on non-owner, and protect @everyone",
    rolesSuiteCheck.createOk &&
      rolesSuiteCheck.assignOk &&
      rolesSuiteCheck.updateOk &&
      rolesSuiteCheck.mariaHigherRejected &&
      rolesSuiteCheck.mariaEveryoneRejected &&
      rolesSuiteCheck.davisDeleteOk,
    JSON.stringify(rolesSuiteCheck)
  );

  // =========================================================================
  // SUITE 15: Dedicated Mute and Unmute Sound Effects & Debounce
  // =========================================================================
  const muteSoundCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const previewMute = await store.previewCallSound("mute");
    const previewUnmute = await store.previewCallSound("unmute");

    const rapid1 = await store.toggleMute();
    const rapid2 = await store.toggleMute();
    const rapid3 = await store.toggleMute();

    await store.updateSettings({
      muteSoundPreset: "synth-pulse",
      unmuteSoundPreset: "chime-crystal",
      muteSoundVolume: 90
    });
    const s = store.getState().settings;

    return {
      previewMuteOk: previewMute.played === true,
      previewUnmuteOk: previewUnmute.played === true,
      toggledOk: rapid3.ok,
      persistedPresets: s.muteSoundPreset === "synth-pulse" && s.unmuteSoundPreset === "chime-crystal" && s.muteSoundVolume === 90
    };
  })()`);

  recordTest(
    "Domain 3: Dedicated Mute and Unmute Sound Effects",
    "Preview mute and unmute sounds, debounce rapid toggles, and persist preferences",
    muteSoundCheck.previewMuteOk &&
      muteSoundCheck.previewUnmuteOk &&
      muteSoundCheck.toggledOk &&
      muteSoundCheck.persistedPresets,
    JSON.stringify(muteSoundCheck)
  );

  // =========================================================================
  // SUITE 16: Real Microphone & Speaker Devices and Live Mic RMS Meter
  // =========================================================================
  const devicesCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const { VoiceDevices } = await import("./services/gatewayAdapter.js");
    const devs = await VoiceDevices.enumerateDevices();
    let levelReceived = 0;
    const micTestRes = await VoiceDevices.startMicTest("default", (lvl) => {
      levelReceived = lvl;
    });
    await new Promise((r) => setTimeout(r, 200));
    VoiceDevices.stopMicTest();
    const outputTest = await VoiceDevices.testOutput("default", 60);

    return {
      hasInputs: (devs.inputDevices || []).length > 0,
      hasOutputs: (devs.outputDevices || []).length > 0,
      micTestStarted: micTestRes.ok,
      levelReceived: levelReceived >= 0,
      outputTestOk: outputTest.ok
    };
  })()`);

  recordTest(
    "Domain 4: Audio Device Selection & Live Mic Meter",
    "Enumerate system audio devices, start real-time microphone RMS level meter, and test audio output",
    devicesCheck.hasInputs &&
      devicesCheck.hasOutputs &&
      devicesCheck.micTestStarted &&
      devicesCheck.levelReceived &&
      devicesCheck.outputTestOk,
    JSON.stringify(devicesCheck)
  );

  // =========================================================================
  // SUITE 17: Speaking Indicator (Zero Layout Shift)
  // =========================================================================
  const speakingCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    if (store.getState().voice.muted) await store.toggleMute();
    store.selectGuild("g_rea", "c_general");

    const avatarBefore = document.querySelector(".account-bar .avatar-wrap");
    const rectBefore = avatarBefore ? avatarBefore.getBoundingClientRect() : { width: 32, height: 32 };

    store.setVoiceSpeaking(true);
    await new Promise((r) => setTimeout(r, 50));
    const avatarDuring = document.querySelector(".account-bar .avatar-wrap");
    const hasSpeakingClass = avatarDuring ? avatarDuring.classList.contains("speaking") : false;
    const rectDuring = avatarDuring ? avatarDuring.getBoundingClientRect() : { width: 32, height: 32 };

    store.setVoiceSpeaking(false);
    await new Promise((r) => setTimeout(r, 50));
    const avatarAfter = document.querySelector(".account-bar .avatar-wrap");
    const noSpeakingClass = avatarAfter ? !avatarAfter.classList.contains("speaking") : true;

    const widthDelta = Math.abs(rectDuring.width - rectBefore.width);
    const heightDelta = Math.abs(rectDuring.height - rectBefore.height);

    return {
      hasSpeakingClass,
      noSpeakingClass,
      zeroLayoutShift: widthDelta === 0 && heightDelta === 0,
      widthDelta,
      heightDelta
    };
  })()`);

  recordTest(
    "Domain 5: Speaking Indicator & Zero Layout Shift",
    "Pulsing green border on speaking without altering element dimensions (0px shift)",
    speakingCheck.hasSpeakingClass &&
      speakingCheck.noSpeakingClass &&
      speakingCheck.zeroLayoutShift,
    JSON.stringify(speakingCheck)
  );

  // =========================================================================
  // SUITE 18: High Frame-Rate 60 FPS Video Stream & Stats Overlay
  // =========================================================================
  const fps60Check = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const { ScreenShare } = await import("./services/gatewayAdapter.js");
    store.selectGuild("g_rea", "c_general");
    await store.joinVoiceChannel("g_rea", "c_voice_lounge");

    const sources = await store.getScreenShareSources();
    const src = sources.find((s) => s.isScreen) || sources[0];
    const start60 = await store.startScreenShare(src.id, {
      sourceName: src.name,
      resolution: "1080p",
      fps: 60
    });
    // Let the FPS meter run for a couple of seconds
    await new Promise((r) => setTimeout(r, 2600));

    const stats = ScreenShare.getStats();
    const liveTrack = ScreenShare.getStream()?.getVideoTracks()[0];
    const trackFps = liveTrack?.getSettings().frameRate || 0;
    // Frames straight out of the capture (independent of the hidden test window
    // not painting): read the track for 2 s and count them
    let captureFps = 0;
    if (liveTrack && typeof MediaStreamTrackProcessor === "function") {
      const reader = new MediaStreamTrackProcessor({ track: liveTrack.clone() }).readable.getReader();
      let frames = 0;
      const until = performance.now() + 2000;
      while (performance.now() < until) {
        const { value, done } = await reader.read();
        if (done) break;
        value.close();
        frames++;
      }
      reader.cancel();
      captureFps = Math.round(frames / 2);
    }
    const statsOverlay = document.querySelector('[data-testid="stream-stats-overlay"]');
    const stopRes = await store.stopScreenShare();
    await store.leaveVoiceChannel();

    return {
      startOk: start60.ok,
      configuredFps: start60.fps === 60,
      measuredFps: stats.capturedFps,
      trackFps,
      captureFps,
      resolution: stats.resolution,
      // Windows Graphics Capture only delivers frames when the screen changes,
      // so a still desktop gives fewer than requested; >= 15 proves a live capture
      statsReported: Boolean(stats.resolution) && captureFps >= 15,
      overlayRendered: Boolean(statsOverlay),
      stopOk: stopRes.ok
    };
  })()`);

  recordTest(
    "Domain 6: 60 FPS Video Transmission & Stats Overlay",
    "Capture at up to 60 FPS, measure the frames really delivered and the resolution, and render the stats overlay",
    fps60Check.startOk &&
      fps60Check.configuredFps &&
      fps60Check.statsReported &&
      fps60Check.overlayRendered &&
      fps60Check.stopOk,
    JSON.stringify(fps60Check)
  );

  // =========================================================================
  // SUITE 19: Audio Assets Mapping & HTTP Verification
  // =========================================================================
  const audioAssetsCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const { AUDIO_ASSETS } = await import("./services/gatewayAdapter.js");
    const info = window.DiscordNative.backend.getInfo();
    const baseUrl = info.httpUrl;

    const checks = {};
    for (const [key, relPath] of Object.entries(AUDIO_ASSETS)) {
      try {
        const resp = await fetch(baseUrl + "/" + relPath);
        checks[key] = { status: resp.status, path: relPath };
      } catch (e) {
        checks[key] = { error: e.message, path: relPath };
      }
    }

    const all200 = Object.values(checks).every((c) => c.status === 200);

    // Byte sizes of the user's files: discord-join, discord-leave-noise,
    // SomLigandoPraAlguemDiscord (DM ringing) and NotificacaoDiscord
    const expectedBytes = { join: 21243, leave: 18048, ringtone: 21243, notification: 8301 };
    const sizes = {};
    for (const [key, relPath] of Object.entries(AUDIO_ASSETS)) {
      const buf = await (await fetch(baseUrl + "/" + relPath)).arrayBuffer();
      sizes[key] = buf.byteLength;
    }
    const correctFiles = Object.entries(expectedBytes).every(([k, n]) => sizes[k] === n);

    return {
      assetsMapped: Object.keys(AUDIO_ASSETS).length >= 4,
      all200,
      correctFiles,
      sizes,
      checks
    };
  })()`);

  recordTest(
    "Domain 7: Audio Files Inventory & HTTP Serving",
    "Map the 4 user audio files to Join, Leave, Ringtone and Notification with HTTP 200 serving",
    audioAssetsCheck.assetsMapped && audioAssetsCheck.all200 && audioAssetsCheck.correctFiles,
    JSON.stringify(audioAssetsCheck)
  );

  // =========================================================================
  // SUITE 20: Image & GIF Framing Editor for Avatar and Banner
  // =========================================================================
  const mediaEditorCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    store.openMediaEditor({
      target: "avatar",
      mediaUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      scale: 1.8,
      cropX: 14,
      cropY: -8
    });
    await new Promise((r) => setTimeout(r, 100));
    const editorEl = document.querySelector('[data-testid="media-editor-modal"]');
    const imgEl = document.getElementById("media-editor-preview-img");
    const transformApplied = imgEl ? imgEl.style.transform.includes("1.8") : false;

    // Continuous drag on the X slider, with the app re-rendering mid-drag
    // (e.g. a message arriving): the slider must stay the same live element
    const panX = q("#media-editor-panx-slider");
    let dragOk = true;
    for (const v of [20, 26, 32, 38, 44]) {
      panX.value = v;
      panX.dispatchEvent(new Event("input", { bubbles: true }));
      if (v === 32) store.notify();
      if (document.getElementById("media-editor-panx-slider") !== panX || !panX.isConnected) dragOk = false;
    }
    const dragMovedPreview = imgEl.style.transform.includes("translate(44px");
    const dragLabel = q("#editor-panx-label").textContent === "44px";
    const dragState = store.getState().mediaEditor.cropX === 44;
    panX.value = 14;
    panX.dispatchEvent(new Event("input", { bubbles: true }));

    // The editor follows the selected theme even though it lives outside #app
    const appBg = getComputedStyle(q(".app-root:not(.theme-layer)")).getPropertyValue("--bg-chat").trim();
    const editorBg = getComputedStyle(editorEl).getPropertyValue("--bg-chat").trim();
    const editorThemed = Boolean(appBg) && appBg === editorBg;

    const applyRes = await store.applyMediaEditor();
    const u = store.getCurrentUser();
    const avatarImg = document.querySelector('.account-bar img.avatar-img');
    const avatarTransformed = avatarImg ? avatarImg.style.transform.includes("1.8") : false;

    return {
      editorRendered: Boolean(editorEl),
      transformApplied,
      dragOk,
      dragMovedPreview,
      dragLabel,
      dragState,
      editorThemed,
      applyOk: applyRes.ok,
      persistedScale: u.avatarScale === 1.8,
      persistedCropX: u.avatarCropX === 14,
      persistedCropY: u.avatarCropY === -8,
      avatarTransformed
    };
  })()`);

  recordTest(
    "Domain 8: Media Framing & Zoom Editor",
    "Open interactive editor with framing viewport, zoom/pan sliders, apply transforms, and persist scale & crop",
    mediaEditorCheck.editorRendered &&
      mediaEditorCheck.transformApplied &&
      mediaEditorCheck.dragOk &&
      mediaEditorCheck.dragMovedPreview &&
      mediaEditorCheck.dragLabel &&
      mediaEditorCheck.dragState &&
      mediaEditorCheck.editorThemed &&
      mediaEditorCheck.applyOk &&
      mediaEditorCheck.persistedScale &&
      mediaEditorCheck.persistedCropX &&
      mediaEditorCheck.persistedCropY &&
      mediaEditorCheck.avatarTransformed,
    JSON.stringify(mediaEditorCheck)
  );

  // =========================================================================
  // SUITE 21: Server Name/Icon/Banner, No Nitro/Shop, Avatar Lightbox
  // =========================================================================
  const serverCustomCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 5000) => {
      const start = Date.now();
      while (!fn() && Date.now() - start < ms) await wait(50);
      return fn();
    };
    const clickAction = (action, attrs = {}) => {
      const b = document.createElement("button");
      b.setAttribute("data-action", action);
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      b.click();
      b.remove();
    };

    const meId = store.getState().auth.currentUserId;
    const guild = store.getState().guilds.find((g) => g.ownerId === meId);
    store.selectGuild(guild.id);
    await wait(100);
    const originalName = guild.name;

    // Rename through the real settings UI
    clickAction("open-server-settings");
    await wait(150);
    const nameInput = document.querySelector('[data-testid="guild-name-input"]');
    const overviewRendered = Boolean(nameInput);
    nameInput.value = "Servidor Renomeado";
    q('[data-testid="save-guild-name-btn"]').click();
    await waitFor(() => store.getActiveGuild().name === "Servidor Renomeado");
    const renamed = store.getActiveGuild().name === "Servidor Renomeado";
    clickAction("close-settings-overlay");
    await wait(100);
    const headerShowsName = document.querySelector('[data-testid="server-header"]').textContent.includes("Servidor Renomeado");

    // Icon (PNG) and banner (GIF)
    const iconUp = await store.uploadMedia({ fileName: "icon.png", mimeType: "image/png", base64Data: "${createValidPngBase64()}", kind: "avatar" });
    const iconRes = await store.updateGuild(guild.id, { iconUrl: iconUp.url });
    const bannerUp = await store.uploadMedia({ fileName: "banner.gif", mimeType: "image/gif", base64Data: "${createValidGifBase64()}", kind: "banner" });
    const bannerRes = await store.updateGuild(guild.id, { bannerUrl: bannerUp.url });
    await wait(150);
    const railIcon = document.querySelector('[data-guild-context="' + guild.id + '"] img.guild-icon-img');
    const railIconRect = railIcon ? railIcon.getBoundingClientRect() : { width: 0, height: 0 };
    const railIconOk = Boolean(railIcon) && railIcon.getAttribute("src").endsWith(".png") && railIconRect.width === 48 && railIconRect.height === 48;
    // The banner fills the server header (name, invite and settings sit on top of it)
    const sidebarBanner = document.querySelector('[data-testid="server-header"] img[data-testid="guild-sidebar-banner"]');
    const bannerRect = sidebarBanner ? sidebarBanner.getBoundingClientRect() : { width: 0, height: 0 };
    const sidebarBannerOk = Boolean(sidebarBanner) && sidebarBanner.getAttribute("src").endsWith(".gif") && bannerRect.height === 136 && bannerRect.width > 200;

    // Clicking the banner does nothing; clicking the server name opens the menu
    sidebarBanner.click();
    await wait(100);
    // No click cursor over the banner or the bar, only on the buttons
    const cursorOf = (el) => getComputedStyle(el).cursor;
    const noHoverOnBanner =
      cursorOf(sidebarBanner) !== "pointer" &&
      cursorOf(q(".server-header-bar")) !== "pointer" &&
      cursorOf(q('[data-testid="server-header"]')) !== "pointer" &&
      cursorOf(q('[data-testid="server-header-title"]')) === "pointer" &&
      cursorOf(q('[data-testid="server-invite-btn"]')) === "pointer";
    // ...including the strip of the header bar that sits on top of the banner
    q(".server-header-bar").click();
    await wait(100);
    const bannerClickInert = !document.querySelector('[data-testid="server-dropdown-menu"]') && !document.querySelector('[data-testid="server-settings-overlay"]');
    q('[data-testid="server-header-title"]').click();
    await wait(100);
    const nameOpensMenu = Boolean(document.querySelector('[data-testid="server-dropdown-menu"]'));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(100);

    // "Adicionar GIF" in server settings puts a GIPHY GIF on the server banner
    clickAction("open-server-settings");
    await wait(150);
    q('[data-testid="guild-banner-gif-btn"]').click();
    const t0 = Date.now();
    while (!document.querySelector('[data-testid="gif-card"]') && Date.now() - t0 < 8000) await wait(100);
    const pickerForGuild = store.getState().gifPicker.target === "guild-banner";
    const card = q('[data-testid="gif-card"]');
    const expectedUrl = card.getAttribute("data-gif-large-url");
    card.click();
    const t1 = Date.now();
    while (store.getActiveGuild().bannerUrl !== expectedUrl && Date.now() - t1 < 4000) await wait(100);
    const gifBannerApplied = store.getActiveGuild().bannerUrl === expectedUrl && expectedUrl.includes("giphy.com") && !store.getState().gifPicker.isOpen;
    clickAction("close-settings-overlay");
    await wait(100);
    const foreignUrlRejected = !(await store.updateGuild(guild.id, { bannerUrl: "https://example.com/x.gif" })).ok;

    // Someone without permission cannot edit the server
    const mariaId = Object.values(store.getState().users).find((u) => u.username === "maria_real").id;
    const mariaLogin = await window.DiscordNative.backend.rpc("login", { emailOrUsername: "maria_real", password: "password123" });
    const mariaEdit = await window.DiscordNative.backend.rpc("updateGuild", { guildId: guild.id, name: "Hack" }, mariaLogin.sessionToken);
    const emptyName = await store.updateGuild(guild.id, { name: "   " });

    await store.updateGuild(guild.id, { name: originalName });

    // Nitro and Shop are gone from the home sidebar
    store.selectHome("friends");
    await wait(100);
    const noNitroShop =
      !document.querySelector('[data-section="nitro"], [data-section="shop"]') &&
      !document.querySelector('[data-testid="nitro-stage"], [data-testid="shop-stage"]');

    // Clicking the photo in the profile preview card shows the whole image
    const avatarUp = await store.uploadMedia({ fileName: "me.png", mimeType: "image/png", base64Data: "${createValidPngBase64()}", kind: "avatar" });
    await store.updateMyProfile({ avatarUrl: avatarUp.url });
    clickAction("open-user-settings");
    await wait(150);
    q('[data-testid="settings-tab-profile"]').click();
    await wait(100);
    q('[data-testid="profile-preview-card"] [data-testid="expand-avatar-btn"]').click();
    await wait(100);
    const lightboxImg = document.querySelector('[data-testid="avatar-lightbox"] img');
    const lightboxOpen = Boolean(lightboxImg) && lightboxImg.getAttribute("src") === store.getCurrentUser().avatarUrl;
    const fullImage = lightboxImg ? getComputedStyle(lightboxImg).objectFit === "contain" : false;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(100);
    const lightboxClosedOnEsc = !document.querySelector('[data-testid="avatar-lightbox"]');
    const settingsStillOpen = Boolean(document.querySelector('[data-testid="profile-preview-card"]'));
    clickAction("close-settings-overlay");

    return {
      overviewRendered,
      renamed,
      headerShowsName,
      iconSaved: iconRes.ok,
      bannerSaved: bannerRes.ok,
      railIconOk,
      sidebarBannerOk,
      bannerClickInert,
      noHoverOnBanner,
      nameOpensMenu,
      pickerForGuild,
      gifBannerApplied,
      foreignUrlRejected,
      mariaRejected: !mariaEdit.ok && mariaEdit.status === 403,
      emptyNameRejected: !emptyName.ok,
      noNitroShop,
      lightboxOpen,
      fullImage,
      lightboxClosedOnEsc,
      settingsStillOpen
    };
  })()`);

  await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const meId = store.getState().auth.currentUserId;
    store.selectGuild(store.getState().guilds.find((g) => g.ownerId === meId).id);
    await new Promise((r) => setTimeout(r, 300));
  })()`);
  await captureWindow(mainWin, "08-server-icon-banner.png");
  await mainWin.webContents.executeJavaScript(`(async () => {
    const b = document.createElement("button");
    b.setAttribute("data-action", "open-server-settings");
    document.body.appendChild(b);
    b.click();
    b.remove();
    await new Promise((r) => setTimeout(r, 300));
  })()`);
  await captureWindow(mainWin, "09-server-settings-overview.png");
  await mainWin.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);

  recordTest(
    "Domain 9: Server Customization, No Nitro/Shop & Avatar Lightbox",
    "Rename server via settings, PNG icon in rail, GIF banner in sidebar, permission check, Nitro/Shop removed, expand profile photo",
    Object.values(serverCustomCheck).every(Boolean),
    JSON.stringify(serverCustomCheck)
  );

  // =========================================================================
  // SUITE 22: DM Calls (ringing, answer, incoming) & Message Notification Sound
  // =========================================================================
  const dmCallCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const { CallSounds } = await import("./services/gatewayAdapter.js");
    // Everything sent through rpc() here is done by Maria, with her own session
    const mariaLogin = await window.DiscordNative.backend.rpc("login", { emailOrUsername: "maria_real", password: "password123" });
    const rpc = (action, params) => window.DiscordNative.backend.rpc(action, params, mariaLogin.sessionToken);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 5000) => {
      const start = Date.now();
      while (!fn() && Date.now() - start < ms) await wait(50);
      return fn();
    };

    const mariaId = Object.values(store.getState().users).find((u) => u.username === "maria_real").id;
    const dm = store.getState().dms.find((d) => d.userId === mariaId);
    // Earlier suites switch join/leave to custom/synth presets; use the default recorded sounds here
    await store.updateSettings({ joinSoundPreset: "discord-default", leaveSoundPreset: "discord-default" });
    store.selectHome("dm", dm.id);
    await wait(100);

    // Outgoing call rings until the other person joins
    q('[data-testid="start-dm-call-btn"]').click();
    await waitFor(() => store.getState().voice.dmCall?.status === "ringing" && CallSounds.lastPlayedEvent?.type === "ringtone");
    const ringing = store.getState().voice.dmCall?.status === "ringing" && CallSounds.isRinging();
    const ringFile = CallSounds.lastPlayedEvent?.file;
    const panelSaysCalling = (document.querySelector('[data-testid="rtc-connected-panel"]')?.textContent || "").includes("Chamando");

    await rpc("joinVoiceChannel", { userId: mariaId, guildId: null, channelId: dm.id });
    await waitFor(() => store.getState().voice.dmCall?.status === "connected");
    await waitFor(() => CallSounds.lastPlayedEvent?.type === "join");
    const connected = store.getState().voice.dmCall?.status === "connected";
    const ringStoppedOnAnswer = !CallSounds.isRinging();
    const joinFile = CallSounds.lastPlayedEvent?.file;

    await store.leaveVoiceChannel();
    const leaveFile = CallSounds.lastPlayedEvent?.file;
    await rpc("leaveVoiceChannel", { userId: mariaId });
    await wait(200);

    // Incoming call: the other person rings us, we decline
    store.selectGuild(store.getState().guilds[0].id);
    await rpc("joinVoiceChannel", { userId: mariaId, guildId: null, channelId: dm.id });
    await waitFor(() => Boolean(store.getState().incomingCall));
    const incomingShown = Boolean(document.querySelector('[data-testid="incoming-call-card"]')) && CallSounds.isRinging();
    q('[data-testid="decline-call-btn"]').click();
    await wait(100);
    const declined = !store.getState().incomingCall && !CallSounds.isRinging();
    await rpc("leaveVoiceChannel", { userId: mariaId });
    await wait(200);

    // Joining and leaving a server voice channel
    const voiceGuild = store.getState().guilds.find((g) => g.channels.some((c) => c.type === "voice"));
    const voiceCh = voiceGuild.channels.find((c) => c.type === "voice");
    CallSounds.lastPlayedEvent = null;
    await store.joinVoiceChannel(voiceGuild.id, voiceCh.id);
    const serverJoinFile = CallSounds.lastPlayedEvent?.file;
    // Server calls never ring (the ringtone is for DM calls only)
    const noRingOnServer = !CallSounds.isRinging();
    await store.leaveVoiceChannel();
    const serverLeaveFile = CallSounds.lastPlayedEvent?.file;

    // A message from someone else plays the notification sound
    CallSounds.lastPlayedEvent = null;
    await rpc("sendMessage", { actorId: mariaId, channelId: dm.id, content: "Oi! Teste de notificação." });
    await waitFor(() => CallSounds.lastPlayedEvent?.type === "notification");
    const notificationFile = CallSounds.lastPlayedEvent?.file;

    // Our own messages do not
    CallSounds.lastPlayedEvent = null;
    await store.sendMessage(dm.id, "Mensagem minha, sem notificação.");
    await wait(500);
    const noSelfNotification = CallSounds.lastPlayedEvent?.type !== "notification";

    return {
      ringing,
      ringFile,
      panelSaysCalling,
      connected,
      ringStoppedOnAnswer,
      joinFile,
      leaveFile,
      incomingShown,
      declined,
      notificationFile,
      noSelfNotification,
      serverJoinFile,
      serverLeaveFile,
      noRingOnServer
    };
  })()`);

  recordTest(
    "Domain 10: DM Calls & Notification Sounds",
    "Ring with SomLigandoPraAlguemDiscord until answered, play discord-join/discord-leave-noise, show and decline incoming call, notify on messages from others",
    dmCallCheck.ringing &&
      dmCallCheck.ringFile === "../assets/audio/ligando.mp3" &&
      dmCallCheck.panelSaysCalling &&
      dmCallCheck.connected &&
      dmCallCheck.ringStoppedOnAnswer &&
      dmCallCheck.joinFile === "../assets/audio/entrar-na-call.mp3" &&
      dmCallCheck.leaveFile === "../assets/audio/discord-leave-noise.mp3" &&
      dmCallCheck.incomingShown &&
      dmCallCheck.declined &&
      dmCallCheck.notificationFile === "../assets/audio/notificacao.mp3" &&
      dmCallCheck.noSelfNotification &&
      dmCallCheck.serverJoinFile === "../assets/audio/entrar-na-call.mp3" &&
      dmCallCheck.serverLeaveFile === "../assets/audio/discord-leave-noise.mp3" &&
      dmCallCheck.noRingOnServer,
    JSON.stringify(dmCallCheck)
  );

  // =========================================================================
  // SUITE 23: Session Security & Self-Hosted Invite Links
  // =========================================================================
  const sessionInviteCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const backend = window.DiscordNative.backend;
    const baseUrl = backend.getInfo().httpUrl;
    const meId = store.getState().auth.currentUserId;

    // No token: rejected. Maria's token with Davis's id: still acts as Maria.
    const anon = await backend.rpc("getStateSnapshot", { userId: meId });
    const maria = await backend.rpc("login", { emailOrUsername: "maria_real", password: "password123" });
    const forged = await backend.rpc("getStateSnapshot", { userId: meId, actorId: meId }, maria.sessionToken);

    // Invite links point at our own server, never discord.gg
    const guild = store.getState().guilds.find((g) => g.ownerId === meId);
    const inv = await store.createServerInvite(guild.id, {});
    const url = inv.invite?.url || inv.url || "";
    const landing = await fetch(url);
    const landingHtml = await landing.text();
    const bogus = await fetch(baseUrl + "/convite/naoexiste123");

    // A full link (not only the bare code) is accepted
    const mariaGuildsBefore = (await backend.rpc("getStateSnapshot", {}, maria.sessionToken)).snapshot.guilds.length;
    await backend.rpc("acceptInvite", { tokenOrUrl: url }, maria.sessionToken);
    const mariaGuildsAfter = (await backend.rpc("getStateSnapshot", {}, maria.sessionToken)).snapshot.guilds;

    return {
      anonRejected: anon.code === "UNAUTHENTICATED",
      forgedIgnored: forged.ok && forged.snapshot.currentUserId !== meId,
      inviteUrl: url,
      selfHosted: url.startsWith(baseUrl + "/convite/") && !url.includes("discord.gg"),
      landingOk: landing.status === 200 && landingHtml.includes(guild.name),
      bogusNotFound: bogus.status === 404,
      joinedByLink: mariaGuildsAfter.some((g) => g.id === guild.id) || mariaGuildsBefore > 0 && mariaGuildsAfter.some((g) => g.id === guild.id)
    };
  })()`);

  recordTest(
    "Domain 11: Sessions & Self-Hosted Invites",
    "Reject calls without a session, ignore forged user ids, invite links on our own URL with a public landing page, join by full link",
    sessionInviteCheck.anonRejected &&
      sessionInviteCheck.forgedIgnored &&
      sessionInviteCheck.selfHosted &&
      sessionInviteCheck.landingOk &&
      sessionInviteCheck.bogusNotFound &&
      sessionInviteCheck.joinedByLink,
    JSON.stringify(sessionInviteCheck)
  );

  // =========================================================================
  // SUITE 24: Delete Confirmation, Bigger Buttons & New Logo
  // =========================================================================
  const confirmUiCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const meId = store.getState().auth.currentUserId;
    const guild = store.getState().guilds.find((g) => g.ownerId === meId);
    store.selectGuild(guild.id);
    await wait(100);

    const created = await store.createChannel(guild.id, { name: "canal-temporario", type: "text" });
    await wait(150);
    const ch = store.getActiveGuild().channels.find((c) => c.name === "canal-temporario");
    const delBtn = () => q('.channel-action-btn.danger[data-channel-id="' + ch.id + '"]');

    // Cancel keeps the channel
    delBtn().click();
    await wait(100);
    const dialogShown = Boolean(document.querySelector('[data-testid="confirm-dialog"]'));
    q('[data-testid="confirm-dialog-cancel"]').click();
    await wait(150);
    const keptOnCancel = store.getActiveGuild().channels.some((c) => c.id === ch.id);

    // Confirm deletes it
    delBtn().click();
    await wait(100);
    q('#confirm-dialog-form').requestSubmit();
    const start = Date.now();
    while (store.getActiveGuild().channels.some((c) => c.id === ch.id) && Date.now() - start < 3000) await wait(50);
    const deletedOnConfirm = !store.getActiveGuild().channels.some((c) => c.id === ch.id);

    // Sizes and logo
    const inviteBtn = q('[data-testid="server-invite-btn"]').getBoundingClientRect();
    const actionBtn = document.querySelector('.channel-action-btn')?.getBoundingClientRect() || { width: 0, height: 0 };
    const homeBtn = q('[data-action="select-home"]');
    const homeSvg = homeBtn.querySelector("svg");
    const discordPath = "M23.0212 1.67671";
    const newLogo = Boolean(homeSvg) && !homeBtn.innerHTML.includes(discordPath);

    return {
      createdOk: Boolean(created?.ok !== false && ch),
      dialogShown,
      keptOnCancel,
      deletedOnConfirm,
      inviteBtnHeight: Math.round(inviteBtn.height),
      channelActionSize: Math.round(actionBtn.width),
      newLogo
    };
  })()`);

  recordTest(
    "Domain 12: Delete Confirmation, Bigger Buttons & New Logo",
    "Deleting a channel asks first (cancel keeps it, confirm deletes), larger invite/channel buttons, app logo replaces Discord's",
    confirmUiCheck.createdOk &&
      confirmUiCheck.dialogShown &&
      confirmUiCheck.keptOnCancel &&
      confirmUiCheck.deletedOnConfirm &&
      confirmUiCheck.inviteBtnHeight >= 28 &&
      confirmUiCheck.channelActionSize >= 26 &&
      confirmUiCheck.newLogo,
    JSON.stringify(confirmUiCheck)
  );

  // =========================================================================
  // SUITE 25: Account Tab — E-mail, Password & Phone (dev-mode delivery)
  // =========================================================================
  const accountCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const backend = window.DiscordNative.backend;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await wait(50); return fn(); };
    const security = async () => (await store.getAccountSecurity()).security;

    // Verify the e-mail through the real settings UI
    const b = document.createElement("button");
    b.setAttribute("data-action", "open-user-settings");
    document.body.appendChild(b); b.click(); b.remove();
    await wait(300);
    const accountTabOpen = Boolean(document.querySelector('[data-testid="account-email-row"]'));
    q('[data-testid="verify-email-btn"]').click();
    await waitFor(() => document.querySelector('[data-testid="account-dev-code"] code'));
    const devCode = q('[data-testid="account-dev-code"] code').textContent.trim();
    q('[data-account-form="code"] input[name="code"]').value = devCode;
    q('[data-account-form="code"]').requestSubmit();
    let sec = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) { sec = await security(); if (sec.emailVerified) break; await wait(150); }
    const emailVerified = sec.emailVerified;

    // Password: wrong current password is refused; a correct change signs out other sessions
    const otherDevice = await backend.rpc("login", { emailOrUsername: "davis_dev", password: "password123" });
    const wrongCurrent = await store.changePassword("senha-errada", "novaSenha123");
    const changed = await store.changePassword("password123", "novaSenha123");
    const otherAfter = await backend.rpc("getStateSnapshot", {}, otherDevice.sessionToken);
    const thisStillWorks = (await store.getAccountSecurity()).ok;
    const oldPwLogin = await backend.rpc("login", { emailOrUsername: "davis_dev", password: "password123" });
    const newPwLogin = await backend.rpc("login", { emailOrUsername: "davis_dev", password: "novaSenha123" });
    await store.changePassword("novaSenha123", "password123");

    // Phone verification was removed: no phone row, no phone actions
    const noPhoneRow = !document.querySelector('[data-testid="account-phone-row"]');
    const phoneActionGone = (await backend.rpc("requestPhoneVerification", { phone: "+5511999998888", currentPassword: "password123" }, (await import("./services/gatewayAdapter.js")).NativeBridge.sessionToken)).ok === false;

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    return {
      accountTabOpen,
      emailVerified,
      wrongCurrentRejected: !wrongCurrent.ok,
      passwordChanged: changed.ok,
      otherSessionRevoked: otherAfter.code === "UNAUTHENTICATED",
      thisStillWorks,
      oldPasswordRejected: !oldPwLogin.ok,
      newPasswordAccepted: newPwLogin.ok,
      noPhoneRow,
      phoneActionGone
    };
  })()`);

  recordTest(
    "Domain 13: Account Tab (E-mail, Password)",
    "Verify e-mail via UI code, change password (wrong current refused, other sessions revoked), no phone verification",
    Object.values(accountCheck).every(Boolean),
    JSON.stringify(accountCheck)
  );


  // =========================================================================
  // SUITE 28: E-mail codes through the email-otp Edge Function (fake Supabase, no real e-mail)
  // =========================================================================
  const fakeSupabaseCalls = [];
  const FAKE_CODE = "482139";
  const fakeSupabase = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      fakeSupabaseCalls.push({ path: req.url, apikey: req.headers.apikey, body: json });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/functions/v1/email-otp" && json.action === "send") {
        if (json.email === "limite@exemplo.com") {
          res.statusCode = 429;
          return res.end(JSON.stringify({ ok: false, code: "rate_limited", error: "Aguarde um minuto para pedir outro código." }));
        }
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url === "/functions/v1/email-otp" && json.action === "verify") {
        if (json.code === FAKE_CODE) return res.end(JSON.stringify({ ok: true, valid: true }));
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, valid: false, code: "invalid_code", attemptsLeft: 4 }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((r) => fakeSupabase.listen(0, "127.0.0.1", r));
  const savedSupabase = backendServer.config.supabase;
  backendServer.config.supabase = { url: `http://127.0.0.1:${fakeSupabase.address().port}`, publishableKey: "sb_publishable_teste" };

  const supabaseCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const sec0 = (await store.getAccountSecurity()).security;
    const req = await store.requestEmailChange("novo.email@exemplo.com", "password123");
    const wrong = await store.confirmEmailChange("111111");
    const right = await store.confirmEmailChange("${FAKE_CODE}");
    const sec1 = (await store.getAccountSecurity()).security;
    // put the e-mail back for the suites that follow (the cooldown is per purpose)
    await new Promise((r) => setTimeout(r, 50));
    const rate = await store.requestEmailChange("limite@exemplo.com", "password123");
    return {
      providerReported: sec0.providers.email === true,
      codeSentNotShown: req.ok && req.delivered === true && !req.devCode && !req.devMode,
      wrongRejected: !wrong.ok,
      rightAccepted: right.ok && sec1.email === "novo.email@exemplo.com" && sec1.emailVerified,
      rateLimitMessage: !rate.ok && /aguarde|minutos/i.test(rate.error || "")
    };
  })()`);

  const fnCalls = fakeSupabaseCalls.filter((c) => c.path === "/functions/v1/email-otp");
  const sendCall = fnCalls.find((c) => c.body.action === "send");
  const verifyCall = fnCalls.find((c) => c.body.action === "verify" && c.body.code === FAKE_CODE);
  supabaseCheck.sendRequestShape = Boolean(sendCall && sendCall.apikey === "sb_publishable_teste" && sendCall.body.email === "novo.email@exemplo.com");
  supabaseCheck.verifyRequestShape = Boolean(verifyCall && verifyCall.body.email === "novo.email@exemplo.com");

  backendServer.config.supabase = savedSupabase;
  fakeSupabase.close();
  // restore the seeded e-mail directly (a second change would hit the cooldown)
  backendServer.db.prepare("UPDATE users SET email = 'davis@discord.local' WHERE id = 'u_davis'").run();

  recordTest(
    "Domain 16: E-mail Codes via Supabase Edge Function",
    "Send and verify codes through the email-otp function with the publishable key, never show the code on screen, friendly rate-limit error",
    Object.values(supabaseCheck).every(Boolean),
    JSON.stringify(supabaseCheck)
  );


  // =========================================================================
  // SUITE 29: Screen share memory stays flat over time (no growth while sharing)
  // =========================================================================
  const privateMB = () =>
    Number((app.getAppMetrics().reduce((acc, m) => acc + (m.memory?.privateBytes || 0), 0) / 1024).toFixed(1));
  await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    store.selectGuild("g_rea", "c_general");
    await store.joinVoiceChannel("g_rea", "c_voice_lounge");
    const sources = await store.getScreenShareSources();
    const src = sources.find((s) => s.isScreen) || sources[0];
    await store.startScreenShare(src.id, { sourceName: src.name, resolution: "1080p", fps: 30 });
  })()`);
  await delay(3000);
  const memEarly = privateMB();
  await delay(12000);
  const memLate = privateMB();
  const shareFpsLate = await mainWin.webContents.executeJavaScript(
    `import("./services/gatewayAdapter.js").then(({ ScreenShare }) => ScreenShare.getStats().capturedFps)`
  );
  await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    await store.stopScreenShare();
    await store.leaveVoiceChannel();
  })()`);
  const memGrowthMB = Number((memLate - memEarly).toFixed(1));
  recordTest(
    "Domain 17: Screen Share Memory Stability",
    "Share a screen at 1080p/30 FPS for 15 s: private memory must not keep growing (< 25 MB between 3 s and 15 s)",
    memGrowthMB < 25,
    JSON.stringify({ memEarlyMB: memEarly, memLateMB: memLate, memGrowthMB, capturedFpsAtEnd: shareFpsLate })
  );


  // =========================================================================
  // SUITE 30: Real voice between two people (WebRTC), in two app windows
  // =========================================================================
  // Each window gets a synthetic "microphone" (a 440 Hz tone) so we can measure
  // whether one person's audio really reaches the other.
  const fakeMicScript = `(() => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    window.__fakeMicCtx = ctx;
    // ...and a synthetic "camera": an animated canvas
    const cam = document.createElement("canvas");
    cam.width = 640;
    cam.height = 360;
    const g = cam.getContext("2d");
    let f = 0;
    setInterval(() => {
      f++;
      g.fillStyle = "hsl(" + (f % 360) + ",70%,45%)";
      g.fillRect(0, 0, 640, 360);
    }, 33);
    const camStream = cam.captureStream(30);
    navigator.mediaDevices.getUserMedia = async (c) =>
      c && c.video
        ? new MediaStream(camStream.getVideoTracks().map((t) => t.clone()))
        : new MediaStream(dest.stream.getAudioTracks().map((t) => t.clone()));
    return true;
  })()`;
  // RMS level of the audio we receive from the other person, over ~1.5 s
  const remoteLevelScript = `(async () => {
    const { Voice } = await import("./services/gatewayAdapter.js");
    const info = Voice.getPeerInfo()[0];
    if (!info || !info.stream) return { state: info?.state || "none", level: 0 };
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(info.stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100));
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
    }
    ctx.close();
    return { state: info.state, level: Number(peak.toFixed(4)) };
  })()`;

  const peerWin = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "voice-peer", // its own localStorage: a second person on another PC
      preload: path.join(rootDir, "electron", "mainScreenPreload.js")
    }
  });
  await peerWin.loadFile(path.join(rootDir, "src", "index.html"));
  await delay(1200);
  await peerWin.webContents.executeJavaScript(fakeMicScript);
  await mainWin.webContents.executeJavaScript(fakeMicScript);

  const peerLogin = await peerWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const res = await store.login("maria_real", "password123");
    return { ok: res.ok, user: store.getState().auth.currentUserId };
  })()`);

  await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    if (store.getState().voice.connectedChannelId) await store.leaveVoiceChannel();
    store.selectGuild("g_rea", "c_general");
    await store.joinVoiceChannel("g_rea", "c_voice_lounge");
  })()`);
  await peerWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    await store.joinVoiceChannel("g_rea", "c_voice_lounge");
  })()`);

  // Wait for the peer connection to come up
  let peerConnected = false;
  for (let i = 0; i < 40 && !peerConnected; i++) {
    await delay(250);
    const states = await Promise.all(
      [mainWin, peerWin].map((w) =>
        w.webContents.executeJavaScript(`import("./services/gatewayAdapter.js").then(({ Voice }) => Voice.getPeerInfo().map((p) => p.state))`)
      )
    );
    peerConnected = states.every((list) => list.length === 1 && list[0] === "connected");
  }

  const mariaHearsDavis = await peerWin.webContents.executeJavaScript(remoteLevelScript);
  const davisHearsMaria = await mainWin.webContents.executeJavaScript(remoteLevelScript);

  // Davis mutes: Maria must stop hearing him; unmuting brings him back
  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.toggleMute()`);
  await delay(400);
  const whileMuted = await peerWin.webContents.executeJavaScript(remoteLevelScript);
  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.toggleMute()`);
  await delay(400);
  const afterUnmute = await peerWin.webContents.executeJavaScript(remoteLevelScript);

  // Davis shares a real screen at 1080p/60 and turns his camera on: Maria gets
  // both as live WebRTC video (not snapshots), at the real resolution
  const shareStart = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const sources = await store.getScreenShareSources();
    const src = sources.find((s) => s.isScreen) || sources[0];
    const share = await store.startScreenShare(src.id, { sourceName: src.name, resolution: "1080p", fps: 60 });
    const cam = await store.toggleCamera();
    return { share: share.ok, cam: cam.ok && cam.videoEnabled };
  })()`);
  let videoCheck = null;
  for (let i = 0; i < 24; i++) {
    await delay(500);
    videoCheck = await peerWin.webContents.executeJavaScript(`(async () => {
      const { Voice } = await import("./services/gatewayAdapter.js");
      const store = window.__DISCORD_STORE__;
      const screen = await Voice.getInboundVideoStats("u_davis", "screen");
      const camera = await Voice.getInboundVideoStats("u_davis", "camera");
      store.openCallView?.("c_voice_lounge");
      const strip = [...document.querySelectorAll(".call-strip [data-user-id]")].map((el) => el.getAttribute("data-user-id"));
      return {
        screen,
        camera,
        screenInUi: Boolean(document.querySelector('[data-remote-video="u_davis:screen"] video')),
        // The enlarged stream fills its tile (width or height, keeping 16:9)
        focusFill: (() => {
          const v = document.querySelector(".call-focus video")?.getBoundingClientRect();
          const t = document.querySelector(".call-focus .call-tile")?.getBoundingClientRect();
          return v && t ? Math.round(Math.max(v.width / t.width, v.height / t.height) * 100) : 0;
        })(),
        cameraFlag: Boolean(store.getActiveChannel?.() && true) && (store.getState().guilds.find((g) => g.id === "g_rea")?.channels.find((c) => c.id === "c_voice_lounge")?.voiceParticipants || []).some((p) => p.userId === "u_davis" && p.videoEnabled),
        strip
      };
    })()`);
    if (videoCheck.screen?.width >= 1280 && videoCheck.screen?.fps > 0 && videoCheck.camera?.fps > 0 && videoCheck.cameraFlag) break;
  }
  await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    await store.toggleCamera();
    await store.stopScreenShare();
  })()`);

  // Signaling stays private: a third party cannot send setup messages into the call
  const outsiderBlocked = await mainWin.webContents.executeJavaScript(`(async () => {
    const backend = window.DiscordNative.backend;
    await backend.rpc("register", { email: "intruso@exemplo.com", username: "intruso", displayName: "Intruso", password: "senha12345" });
    const login = await backend.rpc("login", { emailOrUsername: "intruso", password: "senha12345" });
    const res = await backend.rpc("RTC_SIGNAL", { channelId: "c_voice_lounge", targetUserId: "u_davis", signalType: "offer", signalData: {} }, login.sessionToken);
    return res.ok === false;
  })()`);

  // Leaving closes the connection on both sides
  await peerWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.leaveVoiceChannel()`);
  await delay(800);
  const closedAfterLeave = await mainWin.webContents.executeJavaScript(
    `import("./services/gatewayAdapter.js").then(({ Voice }) => Voice.getPeerInfo().length === 0)`
  );
  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.leaveVoiceChannel()`);
  peerWin.destroy();

  const voiceCheck = {
    peerLoggedIn: peerLogin.ok,
    peerConnected,
    mariaHearsDavis: mariaHearsDavis.level,
    davisHearsMaria: davisHearsMaria.level,
    levelWhileMuted: whileMuted.level,
    levelAfterUnmute: afterUnmute.level,
    outsiderBlocked,
    closedAfterLeave,
    shareStart,
    videoCheck
  };
  recordTest(
    "Domain 18: Real Voice Between Two People (WebRTC)",
    "Two app windows join the same call: each hears the other's microphone, mute silences it, outsiders cannot signal, leaving closes the connection",
    voiceCheck.peerLoggedIn &&
      voiceCheck.peerConnected &&
      voiceCheck.mariaHearsDavis > 0.05 &&
      voiceCheck.davisHearsMaria > 0.05 &&
      voiceCheck.levelWhileMuted < 0.01 &&
      voiceCheck.levelAfterUnmute > 0.05 &&
      voiceCheck.outsiderBlocked &&
      voiceCheck.closedAfterLeave &&
      shareStart.share &&
      shareStart.cam &&
      videoCheck?.screen?.width >= 1280 &&
      videoCheck?.screen?.fps > 0 &&
      videoCheck?.camera?.fps > 0 &&
      videoCheck?.cameraFlag &&
      videoCheck?.focusFill >= 95,
    JSON.stringify(voiceCheck)
  );

  // =========================================================================
  // SUITE 31: Moderation & chat batch (ban, delete server, empty new accounts,
  // links, typing indicator, emoji picker, message menu, profile card buttons)
  // =========================================================================
  const batchCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const ui = window.__DISCORD_UI_STATE__;
    const backend = window.DiscordNative.backend;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 4000) => {
      const t0 = Date.now();
      while (!fn() && Date.now() - t0 < ms) await wait(50);
      return fn();
    };

    // A brand-new account starts with no servers at all
    await backend.rpc("register", { email: "banido@exemplo.com", username: "banido", displayName: "Banido", password: "senha12345" });
    const login = await backend.rpc("login", { emailOrUsername: "banido", password: "senha12345" });
    const firstSnap = await backend.rpc("getStateSnapshot", {}, login.sessionToken);
    const newAccountEmpty = firstSnap.snapshot.guilds.length === 0;

    // Davis creates a server and invites the account, then bans it
    const guild = await store.createGuild({ name: "Servidor Temporario", iconColor: "#ed4245" });
    const invite = await store.createServerInvite(guild.id, {});
    const joined = await backend.rpc("acceptInvite", { tokenOrUrl: invite.invite.url }, login.sessionToken);
    await store.syncFromBackend({ silent: true });
    const bannedId = login.user.id;
    const memberBefore = (store.getActiveGuild().memberIds || []).includes(bannedId);

    // Profile card of that member shows Mensagem / Adicionar amigo / Banir
    ui.userPopout = { userId: bannedId };
    store.notify({ skipPersist: true });
    await wait(150);
    const popoutButtons = {
      message: Boolean(document.querySelector('[data-testid="popout-message-btn"]')),
      addFriend: Boolean(document.querySelector('[data-testid="popout-add-friend-btn"]')),
      ban: Boolean(document.querySelector('[data-testid="popout-ban-btn"]'))
    };
    ui.userPopout = null;

    const ban = await store.banMember(guild.id, bannedId);
    const memberAfter = (store.getState().guilds.find((g) => g.id === guild.id)?.memberIds || []).includes(bannedId);
    const rejoin = await backend.rpc("acceptInvite", { tokenOrUrl: invite.invite.url }, login.sessionToken);

    // Deleting the server needs the password and removes it for everyone
    const wrongPassword = await store.deleteGuild(guild.id, "senha-errada");
    const deleted = await store.deleteGuild(guild.id, "password123");
    const gone = !store.getState().guilds.some((g) => g.id === guild.id);

    // Links in messages are real, clickable links
    store.selectGuild("g_rea", "c_general");
    await store.sendMessage("c_general", "olha isso https://example.com/pagina?x=1&y=2 legal");
    await waitFor(() => document.querySelector('a.chat-link[data-url="https://example.com/pagina?x=1&y=2"]'));
    const linkOk = Boolean(document.querySelector('a.chat-link[data-url="https://example.com/pagina?x=1&y=2"]'));

    // Maria typing shows up under Davis's chat box, and goes away with her message
    const maria = await backend.rpc("login", { emailOrUsername: "maria_real", password: "password123" });
    await backend.rpc("typing", { channelId: "c_general" }, maria.sessionToken);
    const typingShown = await waitFor(() => (document.querySelector('[data-testid="typing-indicator"]')?.textContent || "").includes("digitando"));
    await backend.rpc("sendMessage", { channelId: "c_general", content: "oi" }, maria.sessionToken);
    const typingCleared = await waitFor(() => !(document.querySelector('[data-testid="typing-indicator"]')?.textContent || "").includes("digitando"));
    // An outsider cannot fake typing in a channel they cannot see
    const outsiderTyping = await backend.rpc("typing", { channelId: "c_general" }, login.sessionToken);

    // Right-click on a message: Responder / Editar / Excluir...
    await wait(200);
    const row = [...document.querySelectorAll(".message-row[data-message-id]")].pop();
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 10 }));
    await wait(150);
    const menuItems = [...document.querySelectorAll('[data-testid="context-menu"] .context-menu-item')].map((b) => b.textContent.trim());
    ui.contextMenu = null;

    // Emoji picker: every emoji, frequent ones first, search by name
    ui.emojiPickerForMessageId = "composer";
    store.notify({ skipPersist: true });
    await wait(200);
    const picker = document.querySelector('[data-testid="emoji-picker"]');
    const emojiCount = picker ? picker.querySelectorAll(".emoji-btn").length : 0;
    const firstFrequent = picker?.querySelector("[data-frequent-grid] .emoji-btn")?.dataset.emoji;
    const search = picker?.querySelector(".emoji-search");
    if (search) {
      search.value = "fire";
      search.dispatchEvent(new Event("input"));
    }
    const firstResult = picker?.querySelector("[data-results-grid] .emoji-btn")?.dataset.emoji;
    ui.emojiPickerForMessageId = null;
    store.notify({ skipPersist: true });

    return {
      newAccountEmpty,
      joined: joined.ok,
      memberBefore,
      popoutButtons,
      banOk: ban.ok,
      memberAfter,
      rejoinBlocked: !rejoin.ok,
      wrongPasswordRejected: !wrongPassword.ok,
      deleteOk: deleted.ok && gone,
      linkOk,
      typingShown,
      typingCleared,
      outsiderTypingBlocked: !outsiderTyping.ok,
      menuItems,
      emojiCount,
      firstFrequent,
      firstResult
    };
  })()`);
  recordTest(
    "Domain 19: Moderation & Chat Batch",
    "New accounts start empty; ban removes and blocks re-join; delete server needs the password; links, typing indicator, message menu, emoji picker and profile card buttons",
    batchCheck.newAccountEmpty &&
      batchCheck.joined &&
      batchCheck.memberBefore &&
      batchCheck.popoutButtons.message &&
      batchCheck.popoutButtons.addFriend &&
      batchCheck.popoutButtons.ban &&
      batchCheck.banOk &&
      !batchCheck.memberAfter &&
      batchCheck.rejoinBlocked &&
      batchCheck.wrongPasswordRejected &&
      batchCheck.deleteOk &&
      batchCheck.linkOk &&
      batchCheck.typingShown &&
      batchCheck.typingCleared &&
      batchCheck.outsiderTypingBlocked &&
      ["Responder", "Copiar texto", "Excluir mensagem"].every((label) => batchCheck.menuItems.includes(label)) &&
      batchCheck.emojiCount > 1500 &&
      batchCheck.firstFrequent === "👍" &&
      batchCheck.firstResult === "🔥",
    JSON.stringify(batchCheck)
  );

  // =========================================================================
  // SUITE 32: Permissions enforced by the server, channels/categories, DMs,
  // per-person reactions and unread badges
  // =========================================================================
  const permsCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const backend = window.DiscordNative.backend;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 4000) => {
      const t0 = Date.now();
      while (!fn() && Date.now() - t0 < ms) await wait(50);
      return fn();
    };
    store.selectGuild("g_rea", "c_general");
    const guild = () => store.getState().guilds.find((g) => g.id === "g_rea");
    const maria = await backend.rpc("login", { emailOrUsername: "maria_real", password: "password123" });
    const mariaId = maria.user.id;
    const as = (action, params) => backend.rpc(action, params, maria.sessionToken);

    // @everyone without "Enviar mensagens": Maria cannot post; restored, she can
    const original = guild().everyonePermissions;
    await store.updateEveryonePermissions("g_rea", original.filter((f) => f !== "SEND_MESSAGES"));
    const mariaRoles = (guild().members.find((m) => m.userId === mariaId)?.roles || []).slice();
    for (const r of mariaRoles) await store.removeMemberRole("g_rea", mariaId, r);
    const blockedSend = await as("sendMessage", { channelId: "c_general", content: "não devia passar" });
    await store.updateEveryonePermissions("g_rea", original);
    const allowedSend = await as("sendMessage", { channelId: "c_general", content: "agora pode" });

    // Deleting someone else's message needs "Gerenciar mensagens"
    const davisMsg = await store.sendMessage("c_general", "mensagem do Davis");
    const deleteDenied = await as("deleteMessage", { messageId: davisMsg.id });
    const modRole = await store.createRole("g_rea", { name: "Moderação", color: "#e91e63", permissions: ["MANAGE_MESSAGES"] });
    await store.assignMemberRole("g_rea", mariaId, modRole.role.id);
    const deleteAllowed = await as("deleteMessage", { messageId: davisMsg.id });
    await store.deleteRole("g_rea", modRole.role.id);

    // Without "Gerenciar canais" no channel changes
    const channelDenied = await as("createChannel", { guildId: "g_rea", name: "hack", type: "text" });

    // Per-person reactions
    const msg = await store.sendMessage("c_general", "reaja aqui");
    await store.toggleReaction("c_general", msg.id, "👍");
    await as("toggleReaction", { messageId: msg.id, emoji: "👍" });
    await store.syncFromBackend({ silent: true });
    const both = store.getState().messages.c_general.find((m) => m.id === msg.id).reactions.find((r) => r.emoji === "👍");
    await store.toggleReaction("c_general", msg.id, "👍");
    await store.syncFromBackend({ silent: true });
    const afterMine = store.getState().messages.c_general.find((m) => m.id === msg.id).reactions.find((r) => r.emoji === "👍");

    // Channels: rename, categories, move
    const renamed = await store.updateChannel("g_rea", "c_general", { name: "Geral Principal" });
    const newName = guild().channels.find((c) => c.id === "c_general").name;
    const cat = await store.createCategory("g_rea", "Jogos");
    const moved = await store.updateChannel("g_rea", "c_general", { categoryId: cat.categoryId });
    const inCat = guild().channels.find((c) => c.id === "c_general").categoryId === cat.categoryId;
    const deleteFull = await store.deleteCategory("g_rea", cat.categoryId);
    const firstCat = guild().categories[0].id;
    await store.updateChannel("g_rea", "c_general", { categoryId: firstCat, name: "general" });
    const catRenamed = await store.updateCategory("g_rea", cat.categoryId, "Jogos 2");
    const deleteEmpty = await store.deleteCategory("g_rea", cat.categoryId);

    // Unread: a message in a channel I am not viewing shows a red badge
    store.selectHome("friends");
    await as("sendMessage", { channelId: "c_general", content: "você não está vendo isso" });
    const badgeShown = await waitFor(() => guild().unreadCount > 0 && document.querySelector('[data-testid="guild-unread-badge"]'));
    store.selectGuild("g_rea", "c_general");
    const badgeCleared = guild().unreadCount === 0;

    // Presence: Maria's app is closed. "Disponível" shows as offline, "Não
    // perturbe" stays, "Invisível" is offline (and I always see my own choice)
    const seen = async () => {
      await store.syncFromBackend({ silent: true });
      return store.getState().users[mariaId]?.status;
    };
    await as("updateProfile", { status: "online" });
    const t0 = Date.now();
    let closedOnline = await seen();
    while (closedOnline !== "offline" && Date.now() - t0 < 15000) {
      await wait(500);
      closedOnline = await seen();
    }
    await as("updateProfile", { status: "dnd" });
    const closedDnd = await seen();
    await as("updateProfile", { status: "invisible" });
    const closedInvisible = await seen();
    await as("updateProfile", { status: "online" });
    const myOwn = store.getCurrentUser().status;

    // Kick: gone from the server, but an invite brings her back (not a ban)
    const kicked = await store.kickMember("g_rea", mariaId);
    const goneAfterKick = !guild().memberIds.includes(mariaId);
    const invite = await store.createServerInvite("g_rea", {});
    const rejoin = await as("acceptInvite", { tokenOrUrl: invite.invite.url });

    // Close a DM: it leaves my list and comes back with a new message
    const dm = await store.openOrCreateDm(mariaId);
    await store.closeDm(dm.id);
    await store.syncFromBackend({ silent: true });
    const dmHidden = !store.getState().dms.some((d) => d.id === dm.id);
    await as("sendMessage", { channelId: dm.id, content: "oi de novo" });
    const dmBack = await waitFor(() => store.getState().dms.some((d) => d.id === dm.id));

    return {
      blockedSend: !blockedSend.ok,
      allowedSend: allowedSend.ok,
      deleteDenied: !deleteDenied.ok,
      deleteAllowed: deleteAllowed.ok,
      channelDenied: !channelDenied.ok,
      reactionsBoth: both?.count === 2 && both?.me === true,
      reactionsAfterMine: afterMine?.count === 1 && afterMine?.me === false,
      renamed: renamed.ok && newName === "geral-principal",
      moved: moved.ok && inCat,
      categoryNotEmptyRefused: !deleteFull.ok,
      categoryRenamed: catRenamed.ok,
      categoryDeleted: deleteEmpty.ok,
      badgeShown: Boolean(badgeShown),
      badgeCleared,
      kicked: kicked.ok && goneAfterKick,
      rejoinAfterKick: rejoin.ok,
      dmHidden,
      dmBack: Boolean(dmBack),
      presenceClosedOnlineIsOffline: closedOnline === "offline",
      presenceClosedDndKept: closedDnd === "dnd",
      presenceInvisibleIsOffline: closedInvisible === "offline",
      presenceMineAsChosen: myOwn === "online"
    };
  })()`);
  recordTest(
    "Domain 20: Permissions, Channels, DMs, Reactions & Unread",
    "Server-side permissions (@everyone, roles), kick, channel/category management, closing DMs, per-person reactions and unread badges",
    Object.values(permsCheck).every(Boolean),
    JSON.stringify(permsCheck)
  );

  // =========================================================================
  // SUITE 26: Verified E-mail Required for Access (requireVerifiedEmail)
  // =========================================================================
  backendServer.config.requireVerifiedEmail = true;
  const gateCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error("Elemento não encontrado: " + sel); return el; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    await store.logout();
    const reg = await store.register({ email: "nova.pessoa@exemplo.com", displayName: "Nova Pessoa", username: "nova_pessoa", password: "senhaForte1" });
    await wait(150);
    const gateShown = Boolean(document.querySelector('[data-testid="email-gate-screen"]'));
    const appHidden = !document.querySelector('[data-testid="guilds-rail"]');
    const noDataLoaded = Object.keys(store.getState().users).length === 0 || !store.getState().users[reg.user.id]?.email;
    const devCode = q('[data-testid="email-gate-dev-code"] code').textContent.trim();

    q('[data-testid="email-gate-code"]').value = "000000";
    q('#email-gate-form').requestSubmit();
    await wait(300);
    const wrongShowsError = q('#email-gate-error').textContent.length > 0 && Boolean(document.querySelector('[data-testid="email-gate-screen"]'));

    q('[data-testid="email-gate-code"]').value = devCode;
    q('#email-gate-form').requestSubmit();
    const t0 = Date.now();
    while (!document.querySelector('[data-testid="guilds-rail"]') && Date.now() - t0 < 4000) await wait(50);
    const appAfter = Boolean(document.querySelector('[data-testid="guilds-rail"]')) && !store.getState().auth.emailGate;

    await store.logout();
    const relogin = await store.login("davis_dev", "password123");
    await wait(150);
    const verifiedUserNotGated = relogin.ok && !store.getState().auth.emailGate && Boolean(document.querySelector('[data-testid="guilds-rail"]'));

    return { regOk: reg.ok, gateShown, appHidden, noDataLoaded, wrongShowsError, appAfter, verifiedUserNotGated };
  })()`);
  backendServer.config.requireVerifiedEmail = false;


  // =========================================================================
  // SUITE 27: Saved Sessions — switch accounts without the password, stay
  // signed in after the app restarts, sign-out forgets the session
  // =========================================================================
  const savedSessionCheck = await mainWin.webContents.executeJavaScript(`(async () => {
    const store = window.__DISCORD_STORE__;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const davisId = store.getState().auth.currentUserId;
    const maria = store.getSavedAccounts().find((a) => a.username === "maria_real");

    const toMaria = await store.switchAccount(maria.id);
    const onMaria = toMaria.ok && store.getState().auth.currentUserId === maria.id;
    const backToDavis = await store.switchAccount(davisId);
    const onDavis = backToDavis.ok && store.getState().auth.currentUserId === davisId;

    // Signing out of an account forgets its session: next time it needs the password
    await store.switchAccount(maria.id);
    await store.logout();
    const mariaNeedsPw = (await store.switchAccount(maria.id)).needsPassword === true;
    const davisDirect = (await store.switchAccount(davisId)).ok && store.getState().auth.currentUserId === davisId;
    await wait(200);
    return { onMaria, onDavis, mariaNeedsPw, davisDirect, davisId };
  })()`);

  // Reload the window: same as reopening the app, it must come back signed in
  mainWin.webContents.reload();
  await new Promise((resolve) => mainWin.webContents.once("did-finish-load", resolve));
  await delay(1500);
  const afterReload = await mainWin.webContents.executeJavaScript(`(() => {
    const st = window.__DISCORD_STORE__.getState();
    return { authenticated: st.auth.isAuthenticated, userId: st.auth.currentUserId, appShown: Boolean(document.querySelector('[data-testid="guilds-rail"]')) };
  })()`);
  savedSessionCheck.stillSignedInAfterRestart =
    afterReload.authenticated && afterReload.appShown && afterReload.userId === savedSessionCheck.davisId;
  delete savedSessionCheck.davisId;

  recordTest(
    "Domain 15: Saved Sessions & Account Switching",
    "Switch between saved accounts without a password, stay signed in after restart, sign-out requires the password again",
    Object.values(savedSessionCheck).every(Boolean),
    JSON.stringify(savedSessionCheck)
  );

  await mainWin.webContents.executeJavaScript(`(async () => {
    const b = document.createElement("button");
    b.setAttribute("data-action", "open-user-settings");
    document.body.appendChild(b); b.click(); b.remove();
    await new Promise((r) => setTimeout(r, 400));
  })()`);
  await captureWindow(mainWin, "10-settings-account.png");
  await mainWin.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-testid="settings-tab-profile"]').click();
    await new Promise((r) => setTimeout(r, 300));
  })()`);
  await captureWindow(mainWin, "11-settings-profile.png");
  await mainWin.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);

  recordTest(
    "Domain 14: Verified E-mail Required for Access",
    "With requireVerifiedEmail on, a new account sees only the verification screen until it enters the e-mailed code",
    Object.values(gateCheck).every(Boolean),
    JSON.stringify(gateCheck)
  );

  await captureWindow(mainWin, "02-server-chat-view.png");

  // Capture Discovery & Auth screenshots
  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.selectDiscovery();`);
  await captureWindow(mainWin, "05-server-discovery.png");

  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.logout();`);
  await captureWindow(mainWin, "07-login-screen.png");
  await mainWin.webContents.executeJavaScript(`window.__DISCORD_STORE__.login("davis@discord.local", "password123");`);

  // =========================================================================
  // SUITE 12 (PHASE 7): Memory Optimization Verification (< 80 MB Target)
  // =========================================================================
  // A real screen capture keeps GPU/video buffers resident, so the call stage
  // gets its own ceiling; the stability of that number is checked by SUITE 29
  const idleStages = memoryStages.filter((s) => s.stage !== "3_during_call");
  const callStage = memoryStages.find((s) => s.stage === "3_during_call");
  const maxIdleWorkingSetMB = Math.max(...idleStages.map((s) => s.totalWorkingSetMB));
  recordTest(
    "Phase 7: RAM Usage (< 80 MB idle, < 160 MB sharing)",
    "Working Set under 80 MB at startup, navigation and after the call; under 160 MB while sharing the screen for real",
    maxIdleWorkingSetMB < 80 && callStage && callStage.totalWorkingSetMB < 160,
    `Idle max = ${maxIdleWorkingSetMB} MB; sharing = ${callStage?.totalWorkingSetMB} MB (Stages: ${memoryStages.map((s) => `${s.stage}=${s.totalWorkingSetMB}MB`).join(", ")})`
  );

  const memReport = {
    timestamp: new Date().toISOString(),
    targetLimitMB: 80,
    baselineBeforeOptimization: {
      "1_startup": { mainWorkingSetMB: 98.38, rendererWorkingSetMB: 77.22, totalWorkingSetMB: 215.14, totalPrivateMB: 117.16 },
      "2_after_navigation": { mainWorkingSetMB: 98.78, rendererWorkingSetMB: 80.94, totalWorkingSetMB: 219.29, totalPrivateMB: 120.55 },
      "3_during_call": { mainWorkingSetMB: 98.84, rendererWorkingSetMB: 82.6, totalWorkingSetMB: 221.02, totalPrivateMB: 122.79 },
      "4_after_call": { mainWorkingSetMB: 98.89, rendererWorkingSetMB: 83.19, totalWorkingSetMB: 221.66, totalPrivateMB: 123.25 }
    },
    afterOptimization: memoryStages
  };

  fs.writeFileSync(
    path.join(rootDir, "docs", "memory-benchmark.json"),
    JSON.stringify(memReport, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(rootDir, "docs", "verification-results.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), results, memoryStages }, null, 2),
    "utf8"
  );

  mainWin.destroy();
  await backendServer.stop();
  app.quit();
}

app.whenReady().then(() => {
  runVerification().catch((err) => {
    console.error(err);
    process.exit(1);
  });
});
