"use strict";

// Standalone Eco backend for hosting (no Electron): everyone's app connects to
// it through app.config.json → serverUrl.
//
//   node scripts/server.js
//
// Environment:
//   PORT (default 8787) / HOST (default 127.0.0.1, behind a reverse proxy)
//   ECO_DATA_DIR            database, uploads and app.config.local.json (default ./data)
//   APP_PUBLIC_URL          public https address (invite links and image URLs)
//   REQUIRE_VERIFIED_EMAIL  "1" to require a confirmed e-mail to use the app
//   TRUST_PROXY             "1" when behind Caddy/nginx (client IP from X-Forwarded-For)
// Secrets such as the Giphy key go in $ECO_DATA_DIR/app.config.local.json.

const path = require("path");

const dataDir = path.resolve(process.env.ECO_DATA_DIR || path.join(__dirname, "..", "data"));
process.env.ECO_DATA_DIR = dataDir; // lets appConfig find app.config.local.json there

const { DiscordBackendServer } = require("../electron/backendServer");
const { loadAppConfig } = require("../electron/appConfig");

async function main() {
  const config = loadAppConfig();
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "127.0.0.1";

  const server = new DiscordBackendServer({
    dataDir,
    config,
    seedDemoData: false,
    trustProxy: process.env.TRUST_PROXY === "1"
  });
  await server.startHttpServer(port, host);

  console.log(`[eco] listening on http://${host}:${port}`);
  console.log(`[eco] public url: ${config.publicUrl || "(not set)"}`);
  console.log(`[eco] data: ${dataDir}`);
  console.log(`[eco] e-mail codes: ${config.supabase.url ? "Supabase" : "development mode (shown on screen)"}`);
  console.log(`[eco] verified e-mail required: ${config.requireVerifiedEmail ? "yes" : "no"}`);

  const shutdown = () => {
    console.log("[eco] shutting down");
    try {
      server.close();
    } catch (_) {}
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[eco] failed to start:", err);
  process.exit(1);
});
