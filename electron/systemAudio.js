"use strict";

// The PC's sound for a screen share, without the app's own audio: Chromium's
// loopback also records the call being played here, so everyone would hear their
// own voice back. electron/systemaudio/SystemAudio.cs captures everything except
// this process tree. The installed app ships it already compiled (helpers\ next
// to the .exe, see scripts/build-exe.js): antivirus programs block an app that
// compiles and runs a new .exe, and that blocked screen sharing for some people.
// Only a development checkout compiles it on first use.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");
const { app } = require("electron");

const SOURCE_PATH = path.join(__dirname, "systemaudio", "SystemAudio.cs");
const SHIPPED_PATH = path.join(path.dirname(process.execPath), "helpers", "SystemAudio.exe");
const CSC_CANDIDATES = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
];
// Windows needs a moment to apply the exclusion: measured, the first second can
// still contain the app's audio, so it is thrown away (48 kHz * 2 ch * 2 bytes)
const SKIP_BYTES = 192000;
const START_TIMEOUT_MS = 2500;

let compiling = null;
let current = null;

function prepareSystemAudio(dataDir) {
  if (process.platform !== "win32") return Promise.resolve(null);
  if (compiling) return compiling;
  if (app.isPackaged) {
    // Copies compiled here by older versions are what antivirus programs
    // flagged: gone, the shipped one is used instead
    try {
      for (const f of fs.readdirSync(dataDir)) {
        if (/^eco-systemaudio(-[0-9a-f]+)?\.(exe|cs)$/.test(f)) fs.unlinkSync(path.join(dataDir, f));
      }
    } catch (_) {}
    // Missing (removed by an antivirus, say): the share still works, with
    // Chromium's own loopback for the sound
    compiling = Promise.resolve(fs.existsSync(SHIPPED_PATH) ? SHIPPED_PATH : null);
    return compiling;
  }
  compiling = new Promise((resolve) => {
    let source;
    try {
      source = fs.readFileSync(SOURCE_PATH, "utf8");
    } catch (_) {
      return resolve(null);
    }
    const csc = CSC_CANDIDATES.find((p) => fs.existsSync(p));
    if (!csc) return resolve(null);
    const version = crypto.createHash("sha256").update(source).digest("hex").slice(0, 10);
    const target = path.join(dataDir, `eco-systemaudio-${version}.exe`);
    if (fs.existsSync(target)) return resolve(target);
    const tmpSource = path.join(dataDir, "eco-systemaudio.cs");
    try {
      fs.writeFileSync(tmpSource, source, "utf8");
    } catch (_) {
      return resolve(null);
    }
    execFile(csc, ["/nologo", "/optimize+", "/target:exe", `/out:${target}`, tmpSource], { windowsHide: true, timeout: 30000 }, (err) => {
      try {
        fs.unlinkSync(tmpSource);
      } catch (_) {}
      resolve(!err && fs.existsSync(target) ? target : null);
    });
  });
  return compiling;
}

function stopSystemAudio() {
  const child = current;
  current = null;
  if (!child) return;
  try {
    child.stdin.end();
  } catch (_) {}
  // Normally ends on its own when stdin closes
  setTimeout(() => {
    try {
      child.kill();
    } catch (_) {}
  }, 1000);
}

// Resolves { ok: true } once audio is flowing to `sender`, { ok: false } if this
// PC cannot do it (older Windows); the caller then uses Chromium's loopback.
async function startSystemAudio(sender, dataDir) {
  stopSystemAudio();
  const exe = await prepareSystemAudio(dataDir);
  if (!exe) return { ok: false };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, [String(process.pid)], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    } catch (_) {
      return resolve({ ok: false });
    }
    current = child;
    let settled = false;
    let skipped = 0;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) stopSystemAudio();
      resolve({ ok });
    };
    const timer = setTimeout(() => settle(false), START_TIMEOUT_MS);
    child.on("error", () => settle(false));
    child.on("exit", () => {
      if (current === child) current = null;
      settle(false);
    });
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      settle(true);
      if (current !== child || sender.isDestroyed()) return stopSystemAudio();
      if (skipped < SKIP_BYTES) {
        const drop = Math.min(SKIP_BYTES - skipped, chunk.length);
        skipped += drop;
        chunk = chunk.subarray(drop);
        if (!chunk.length) return;
      }
      sender.send("ECO_SYSTEM_AUDIO_PCM", new Uint8Array(chunk));
    });
  });
}

module.exports = { prepareSystemAudio, startSystemAudio, stopSystemAudio };
