"use strict";

// Detects which catalogued games are running by listing process names with
// tasklist every SCAN_INTERVAL_MS. Each scan reports every running game
// ("started", doubling as a heartbeat) and games that disappeared ("stopped").

const { execFile } = require("child_process");
const { findGameByExe } = require("./gameCatalog");

const SCAN_INTERVAL_MS = 30 * 1000;

function listProcessNames() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      const names = new Set();
      for (const line of String(stdout).split(/\r?\n/)) {
        const match = line.match(/^"([^"]+)"/);
        if (match) names.add(match[1]);
      }
      resolve(names);
    });
  });
}

function startGameDetector(onActivity) {
  if (process.platform !== "win32") return () => {};
  let running = new Map(); // gameId -> game
  let stopped = false;

  async function scan() {
    const names = await listProcessNames();
    if (stopped || !names) return;
    const now = new Map();
    for (const exe of names) {
      const game = findGameByExe(exe);
      if (game) now.set(game.id, game);
    }
    for (const [id, game] of now) onActivity({ gameId: id, name: game.name, state: "started" });
    for (const [id, game] of running) {
      if (!now.has(id)) onActivity({ gameId: id, name: game.name, state: "stopped" });
    }
    running = now;
  }

  const timer = setInterval(scan, SCAN_INTERVAL_MS);
  timer.unref();
  setTimeout(scan, 5000).unref();

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const [id, game] of running) onActivity({ gameId: id, name: game.name, state: "stopped" });
    running.clear();
  };
}

module.exports = { startGameDetector };
