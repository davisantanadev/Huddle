"use strict";

// E-mail verification codes through the "email-otp" Edge Function of the
// project's Supabase (source: supabase/functions/email-otp), which sends them
// with Brevo's free API.
//
// The function generates, e-mails and checks the code; this app never sees it.
// The app only needs the project URL and the *publishable* key, which is public
// by design and ships in app.config.json. The Brevo API key is a secret of the
// function and never leaves Supabase.
//
// When Supabase is not configured the caller falls back to a local code that
// is shown on screen (development mode).

const REQUEST_TIMEOUT_MS = 15000;
const FUNCTION_PATH = "/functions/v1/email-otp";

function isSupabaseConfigured(config) {
  return Boolean(config.supabase?.url && config.supabase?.publishableKey);
}

async function callEmailOtp(config, payload) {
  const { url, publishableKey } = config.supabase;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${FUNCTION_PATH}`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.name === "AbortError" ? "timeout" : e.message } };
  } finally {
    clearTimeout(timer);
  }
}

function describeError({ status, data }) {
  if (status === 0) return "Não foi possível conectar ao serviço de e-mail. Verifique sua internet.";
  // The function already answers with a message for the user
  if (data?.error) return data.error;
  return `Falha ao enviar o código por e-mail (${status}).`;
}

async function sendEmailCode(config, email) {
  const res = await callEmailOtp(config, { action: "send", email });
  if (res.ok) return { delivered: true };
  return { delivered: false, error: describeError(res) };
}

// { valid: true } when the function accepts the code for that address
async function verifyEmailCode(config, email, code) {
  const res = await callEmailOtp(config, { action: "verify", email, code });
  if (res.ok && res.data?.valid) return { valid: true };
  if (res.status === 0 || res.status >= 500) {
    return { valid: false, unavailable: true, error: describeError(res) };
  }
  // Expired / too many attempts / no pending code: surface the function's message
  if (res.data?.code && res.data.code !== "invalid_code") {
    return { valid: false, unavailable: true, error: describeError(res) };
  }
  return { valid: false };
}

module.exports = { isSupabaseConfigured, sendEmailCode, verifyEmailCode };
