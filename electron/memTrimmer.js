"use strict";

// Returns unused memory pages of the app's processes to Windows, which is what
// lowers the "Memory" column of Task Manager. Pages still in use come straight
// back (soft faults from RAM, not disk).
//
// Uses electron/memtrim/MemTrim.cs. The installed app ships it already compiled
// (helpers\ next to the .exe, built by scripts/build-exe.js): compiling an .exe
// on the user's PC and running it is exactly what antivirus programs block, and
// with it they also blocked the screen share. Only a development checkout
// compiles it on first use (or falls back to PowerShell).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { app } = require("electron");

const SOURCE_PATH = path.join(__dirname, "memtrim", "MemTrim.cs");
const SHIPPED_PATH = path.join(path.dirname(process.execPath), "helpers", "MemTrim.exe");
const CSC_CANDIDATES = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
];

let helperPath = null; // ready-to-run helper, once compiled
let compiling = null;

// The packaged app keeps electron/ inside resources; the source is read from there
function readSource() {
  try {
    return fs.readFileSync(SOURCE_PATH, "utf8");
  } catch (_) {
    return null;
  }
}

// Compiles the helper into dataDir (once per source version). Resolves to its path or null.
function prepareHelper(dataDir) {
  if (process.platform !== "win32") return Promise.resolve(null);
  if (helperPath) return Promise.resolve(helperPath);
  if (compiling) return compiling;
  if (app.isPackaged && fs.existsSync(SHIPPED_PATH)) {
    // Copies compiled here by older versions (what antivirus programs flagged)
    try {
      for (const f of fs.readdirSync(dataDir)) {
        if (/^eco-memtrim(-[0-9a-f]+)?\.(exe|cs)$/.test(f)) fs.unlinkSync(path.join(dataDir, f));
      }
    } catch (_) {}
    helperPath = SHIPPED_PATH;
    return Promise.resolve(helperPath);
  }
  compiling = new Promise((resolve) => {
    const source = readSource();
    const csc = CSC_CANDIDATES.find((p) => fs.existsSync(p));
    if (!source || !csc) return resolve(null);
    const version = crypto.createHash("sha256").update(source).digest("hex").slice(0, 10);
    const target = path.join(dataDir, `eco-memtrim-${version}.exe`);
    if (fs.existsSync(target)) {
      helperPath = target;
      return resolve(target);
    }
    const tmpSource = path.join(dataDir, "eco-memtrim.cs");
    try {
      fs.writeFileSync(tmpSource, source, "utf8");
    } catch (_) {
      return resolve(null);
    }
    execFile(csc, ["/nologo", "/optimize+", "/target:exe", `/out:${target}`, tmpSource], { windowsHide: true, timeout: 30000 }, (err) => {
      try {
        fs.unlinkSync(tmpSource);
      } catch (_) {}
      if (err || !fs.existsSync(target)) return resolve(null);
      // Older helper versions are no longer needed
      try {
        for (const f of fs.readdirSync(dataDir)) {
          if (/^eco-memtrim-[0-9a-f]+\.exe$/.test(f) && path.join(dataDir, f) !== target) fs.unlinkSync(path.join(dataDir, f));
        }
      } catch (_) {}
      helperPath = target;
      resolve(target);
    });
  });
  return compiling;
}

function trimWithPowerShell(pids) {
  const script = `
Add-Type -Namespace Win32 -Name Mem -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);'
foreach ($id in @(${pids.join(",")})) {
  try {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.Handle) { [void][Win32.Mem]::EmptyWorkingSet($p.Handle) }
  } catch {}
}
`;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 3000, windowsHide: true }, () => {});
}

// { light: true } only uses the compiled helper: callers in a call or screen
// share never pay PowerShell's CPU spike, which made audio stutter
function trimProcesses(pids, { light = false } = {}) {
  if (process.platform !== "win32" || !pids.length) return false;
  if (helperPath) {
    execFile(helperPath, pids.map(String), { timeout: 3000, windowsHide: true }, () => {});
    return true;
  }
  // The installed app never runs PowerShell's Add-Type (it compiles code too)
  if (light || app.isPackaged) return false;
  trimWithPowerShell(pids);
  return true;
}

// Hard working-set ceiling per process ({ pid, mb }[]); see MemTrim.cs. One
// short helper run per change, nothing keeps running afterwards.
function capProcesses(entries) {
  if (process.platform !== "win32" || !helperPath || !entries.length) return false;
  const byCap = new Map();
  for (const { pid, mb } of entries) byCap.set(mb, [...(byCap.get(mb) || []), String(pid)]);
  const args = [];
  for (const [mb, pids] of byCap) args.push("--cap", String(mb), ...pids);
  execFile(helperPath, args, { timeout: 3000, windowsHide: true }, () => {});
  return true;
}

function isLightTrimAvailable() {
  return Boolean(helperPath);
}

module.exports = { prepareHelper, trimProcesses, capProcesses, isLightTrimAvailable };
