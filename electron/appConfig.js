"use strict";

// Deployment configuration shared by the backend.
// Values come from app.config.json at the project root; environment variables
// override them so secrets never need to live in the repository:
//   APP_PUBLIC_URL        public base URL once the app is hosted (e.g. https://eco.seudominio.com)
//   REQUIRE_VERIFIED_EMAIL "1" to block login until the e-mail is confirmed
//   RESEND_API_KEY        enables real e-mail delivery through Resend
//   MAIL_FROM             sender address, e.g. "Eco <no-reply@seudominio.com>"
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM   enables real SMS delivery
//   GIPHY_API_KEY         enables the GIF library (otherwise it falls back to offline GIFs)
// Secrets go in app.config.local.json, which is never committed nor packaged
// into the .exe. It is read from (later wins):
//   1. the project root            (development: npm start / npm test)
//   2. the app's data folder        (%APPDATA%\Eco — set by main.js via ECO_DATA_DIR)
// so an installed app finds its keys outside the executable.

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(__dirname, "..", "app.config.json");
const LOCAL_CONFIG_NAME = "app.config.local.json";
const LOCAL_CONFIG_PATH = path.resolve(__dirname, "..", LOCAL_CONFIG_NAME);

function localConfigPaths() {
  const paths = [LOCAL_CONFIG_PATH];
  if (process.env.ECO_DATA_DIR) paths.push(path.join(process.env.ECO_DATA_DIR, LOCAL_CONFIG_NAME));
  return paths;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return {};
  }
}

function loadAppConfig() {
  const shared = readJson(CONFIG_PATH);
  const local = {};
  for (const p of localConfigPaths()) {
    const data = readJson(p);
    Object.assign(local, data, {
      email: { ...local.email, ...data.email },
      sms: { ...local.sms, ...data.sms }
    });
  }
  const file = {
    ...shared,
    ...local,
    email: { ...shared.email, ...local.email },
    sms: { ...shared.sms, ...local.sms }
  };

  const env = process.env;
  const publicUrl = String(env.APP_PUBLIC_URL || file.publicUrl || "").trim().replace(/\/+$/, "");
  const invitePath = "/" + String(file.invitePath || "/convite").replace(/^\/+|\/+$/g, "");

  return {
    appName: file.appName || "Eco",
    publicUrl,
    invitePath,
    giphyApiKey: env.GIPHY_API_KEY || file.giphyApiKey || "",
    requireVerifiedEmail: env.REQUIRE_VERIFIED_EMAIL ? env.REQUIRE_VERIFIED_EMAIL === "1" : Boolean(file.requireVerifiedEmail),
    email: {
      provider: file.email?.provider || "resend",
      from: env.MAIL_FROM || file.email?.from || "",
      resendApiKey: env.RESEND_API_KEY || file.email?.resendApiKey || ""
    },
    sms: {
      provider: file.sms?.provider || "twilio",
      from: env.TWILIO_FROM || file.sms?.from || "",
      twilioAccountSid: env.TWILIO_ACCOUNT_SID || file.sms?.twilioAccountSid || "",
      twilioAuthToken: env.TWILIO_AUTH_TOKEN || file.sms?.twilioAuthToken || ""
    }
  };
}

module.exports = { loadAppConfig, localConfigPaths, CONFIG_PATH, LOCAL_CONFIG_PATH };
