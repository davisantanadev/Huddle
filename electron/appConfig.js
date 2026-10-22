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
// app.config.local.json (git-ignored) is merged over app.config.json, so keys can
// live there instead of in environment variables.

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(__dirname, "..", "app.config.json");
const LOCAL_CONFIG_PATH = path.resolve(__dirname, "..", "app.config.local.json");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return {};
  }
}

function loadAppConfig() {
  const shared = readJson(CONFIG_PATH);
  const local = readJson(LOCAL_CONFIG_PATH);
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

module.exports = { loadAppConfig, CONFIG_PATH, LOCAL_CONFIG_PATH };
