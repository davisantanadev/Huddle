// E-mail verification codes for the Eco app, sent through Brevo's API.
//
//   POST { action: "send",   email }        -> e-mails a 6-digit code
//   POST { action: "verify", email, code }  -> { valid: true } when it matches
//
// The Brevo key lives only in this function's secrets (BREVO_API_KEY), never
// in the app. Codes are stored hashed in public.email_otps (RLS on, no
// policies: only this function, with the service role, can read them).
// verify_jwt is off because the app calls it with the publishable key, which is
// not a JWT; abuse is limited by the per-address and daily caps below.
//
// Secrets: BREVO_API_KEY, BREVO_SENDER_EMAIL (a sender verified in Brevo),
// optional BREVO_SENDER_NAME and APP_NAME (default "Eco").
// Deploy: supabase functions deploy email-otp --no-verify-jwt
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_PER_DAY = 250; // Brevo free plan allows 300/day
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false }
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Uniform 6-digit code (rejection sampling avoids modulo bias)
function randomCode() {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  let n: number;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

function emailHtml(appName: string, code: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:auto;padding:28px;color:#1f2328">
  <h2 style="margin:0 0 6px 0">${appName}</h2>
  <p style="margin:0 0 18px 0;color:#57606a">Use o código abaixo para confirmar seu e-mail.</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f2f3f5;border-radius:10px">${code}</div>
  <p style="margin:18px 0 0 0;font-size:12px;color:#8c959f">O código expira em 10 minutos. Se você não pediu, ignore este e-mail.</p>
</div>`;
}

async function countSince(email: string | null, sinceMs: number) {
  let q = db.from("email_otps").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  if (email) q = q.eq("email", email);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function sendCode(email: string) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
  const appName = Deno.env.get("APP_NAME") || "Eco";
  if (!apiKey || !senderEmail) {
    return json(503, { ok: false, code: "not_configured", error: "O envio de e-mail ainda não foi configurado no servidor." });
  }

  const { data: last } = await db
    .from("email_otps")
    .select("created_at")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return json(429, { ok: false, code: "rate_limited", error: "Aguarde um minuto para pedir outro código." });
  }
  if ((await countSince(email, 60 * 60 * 1000)) >= MAX_PER_EMAIL_PER_HOUR) {
    return json(429, { ok: false, code: "rate_limited", error: "Muitos códigos pedidos para este e-mail. Tente de novo mais tarde." });
  }
  if ((await countSince(null, 24 * 60 * 60 * 1000)) >= MAX_PER_DAY) {
    return json(429, { ok: false, code: "daily_limit", error: "O limite diário de e-mails foi atingido. Tente de novo amanhã." });
  }

  const id = crypto.randomUUID();
  const code = randomCode();
  // Only the newest code for an address stays valid
  await db.from("email_otps").update({ consumed: true }).eq("email", email).eq("consumed", false);
  const { error: insertError } = await db.from("email_otps").insert({
    id,
    email,
    code_hash: await sha256(`${id}:${code}`),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString()
  });
  if (insertError) return json(500, { ok: false, code: "storage_error", error: "Não foi possível gerar o código." });

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: Deno.env.get("BREVO_SENDER_NAME") || appName, email: senderEmail },
      to: [{ email }],
      subject: `${appName}: seu código é ${code}`,
      htmlContent: emailHtml(appName, code),
      textContent: `Seu código de verificação do ${appName}: ${code}\n\nEle expira em 10 minutos. Se você não pediu, ignore este e-mail.`
    })
  });
  if (!res.ok) {
    await db.from("email_otps").delete().eq("id", id);
    const detail = await res.text().catch(() => "");
    console.error("Brevo error", res.status, detail.slice(0, 300));
    return json(502, { ok: false, code: "delivery_failed", error: `O serviço de e-mail recusou o envio (${res.status}).`, detail: detail.slice(0, 300) });
  }
  return json(200, { ok: true, expiresAt: Date.now() + CODE_TTL_MS });
}

async function verifyCode(email: string, rawCode: string) {
  const { data: row } = await db
    .from("email_otps")
    .select("*")
    .eq("email", email)
    .eq("consumed", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return json(400, { ok: false, valid: false, code: "no_pending", error: "Nenhum código pendente. Peça um novo." });
  if (Date.now() > new Date(row.expires_at).getTime()) {
    await db.from("email_otps").update({ consumed: true }).eq("id", row.id);
    return json(400, { ok: false, valid: false, code: "expired", error: "O código expirou. Peça um novo." });
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.from("email_otps").update({ consumed: true }).eq("id", row.id);
    return json(429, { ok: false, valid: false, code: "too_many_attempts", error: "Muitas tentativas. Peça um novo código." });
  }
  const code = String(rawCode || "").replace(/\D/g, "");
  if (code.length === 6 && (await sha256(`${row.id}:${code}`)) === row.code_hash) {
    await db.from("email_otps").update({ consumed: true }).eq("id", row.id);
    return json(200, { ok: true, valid: true });
  }
  await db.from("email_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
  return json(400, { ok: false, valid: false, code: "invalid_code", attemptsLeft: MAX_ATTEMPTS - row.attempts - 1 });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  let body: { action?: string; email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "JSON inválido." });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(400, { ok: false, code: "invalid_email", error: "Endereço de e-mail inválido." });
  }
  try {
    if (body.action === "send") return await sendCode(email);
    if (body.action === "verify") return await verifyCode(email, String(body.code || ""));
    return json(400, { ok: false, error: "Ação desconhecida." });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, code: "server_error", error: "Erro interno ao processar o código." });
  }
});
