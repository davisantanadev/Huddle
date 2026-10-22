"use strict";

// Delivery of verification codes by e-mail (Resend) and SMS (Twilio).
// When a provider is not configured the code is not sent anywhere: the caller
// gets { delivered: false, devMode: true } and may surface the code locally so
// the flow can be exercised during development.

async function sendEmail(config, { to, subject, text, html }) {
  const { resendApiKey, from } = config.email;
  if (!resendApiKey || !from) {
    return { delivered: false, devMode: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: [to], subject, text, html })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { delivered: false, devMode: false, error: `Falha no envio de e-mail (${res.status}). ${body.slice(0, 160)}` };
    }
    return { delivered: true, devMode: false };
  } catch (e) {
    return { delivered: false, devMode: false, error: `Falha no envio de e-mail: ${e.message}` };
  }
}

async function sendSms(config, { to, body }) {
  const { twilioAccountSid, twilioAuthToken, from } = config.sms;
  if (!twilioAccountSid || !twilioAuthToken || !from) {
    return { delivered: false, devMode: true };
  }
  try {
    const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { delivered: false, devMode: false, error: `Falha no envio de SMS (${res.status}). ${text.slice(0, 160)}` };
    }
    return { delivered: true, devMode: false };
  } catch (e) {
    return { delivered: false, devMode: false, error: `Falha no envio de SMS: ${e.message}` };
  }
}

function verificationEmail(appName, code, purposeLabel) {
  const subject = `${appName}: seu código de verificação é ${code}`;
  const text = `${purposeLabel}\n\nSeu código: ${code}\n\nEle expira em 10 minutos. Se você não solicitou, ignore este e-mail.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;">
    <h2 style="margin:0 0 8px 0;">${appName}</h2>
    <p style="color:#444;">${purposeLabel}</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px;background:#f2f3f5;border-radius:8px;text-align:center;">${code}</div>
    <p style="color:#777;font-size:12px;">O código expira em 10 minutos. Se você não solicitou, ignore este e-mail.</p>
  </div>`;
  return { subject, text, html };
}

module.exports = { sendEmail, sendSms, verificationEmail };
