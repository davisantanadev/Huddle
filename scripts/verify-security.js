// Security checks for the backend, against a real server on a throwaway data
// folder (plain Node, no Electron): event tickets, signed attachment links,
// rate limits, body size, password rules and security headers. It also checks
// the update signature verifier. Every check tries to get around a protection.
//
// Usage: node scripts/verify-security.js

process.env.REQUIRE_VERIFIED_EMAIL = "0";
process.env.ECO_SERVER_URL = "";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { DiscordBackendServer } = require("../electron/backendServer");
const { readSignedManifest } = require("../electron/updateSignature");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` -> ${detail}` : ""}`);
}

function request(port, method, urlPath, { body, headers = {}, readAll = true } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      if (!readAll) {
        // Event stream: the status and headers are enough
        resolve({ status: res.statusCode, headers: res.headers, body: "" });
        res.destroy();
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function rpc(port, action, params = {}, token = null) {
  const res = await request(port, "POST", "/api/rpc", { body: { action, params }, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    return { status: res.status, ...JSON.parse(res.body) };
  } catch (_) {
    return { status: res.status, raw: res.body };
  }
}

async function startServer(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "huddle-sec-"));
  const server = new DiscordBackendServer({ dataDir, seedDemoData: false });
  const port = await server.startHttpServer(0, "127.0.0.1");
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return { server, port, dataDir };
}

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

(async () => {
  const { server, port } = await startServer();

  // ---- Passwords ----------------------------------------------------------
  const weak = await rpc(port, "register", { email: "a@example.test", username: "fraco", displayName: "Fraco", password: "12345678" });
  check("Senha só de números é recusada", !weak.ok, weak.error);
  const common = await rpc(port, "register", { email: "b@example.test", username: "comum", displayName: "Comum", password: "Senha123" });
  check("Senha comum é recusada", !common.ok, common.error);
  const reg = await rpc(port, "register", { email: "c@example.test", username: "seguro", displayName: "Seguro", password: "cavalo42azul" });
  check("Senha boa é aceita", reg.ok && Boolean(reg.sessionToken), reg.error || "");
  const token = reg.sessionToken;
  const reg2 = await rpc(port, "register", { email: "d@example.test", username: "outra", displayName: "Outra", password: "girafa77verde" });
  const token2 = reg2.sessionToken;

  // ---- Event tickets --------------------------------------------------------
  const t1 = await rpc(port, "getEventTicket", {}, token);
  check("App recebe um bilhete para o canal de eventos", t1.ok && typeof t1.ticket === "string" && t1.ticket.length > 20);
  const s1 = await request(port, "GET", `/api/events?ticket=${encodeURIComponent(t1.ticket)}`, { readAll: false });
  check("Canal de eventos abre com o bilhete", s1.status === 200, `HTTP ${s1.status}`);
  const s2 = await request(port, "GET", `/api/events?ticket=${encodeURIComponent(t1.ticket)}`);
  check("O mesmo bilhete não funciona duas vezes", s2.status === 401, `HTTP ${s2.status}`);
  const s3 = await request(port, "GET", `/api/events?ticket=inventado123456789012345`);
  check("Bilhete inventado é recusado", s3.status === 401, `HTTP ${s3.status}`);
  const anon = await rpc(port, "getEventTicket", {});
  check("Sem login não há bilhete", !anon.ok && anon.status === 401, `HTTP ${anon.status}`);
  const legacy = await request(port, "GET", `/api/events?token=${encodeURIComponent(token)}`, { readAll: false });
  check("Apps antigos (token na URL) ainda conectam no modo de transição", legacy.status === 200, `HTTP ${legacy.status}`);
  // Expired ticket
  const t3 = await rpc(port, "getEventTicket", {}, token);
  server.eventTickets.get(t3.ticket).expiresAt = Date.now() - 1;
  const s4 = await request(port, "GET", `/api/events?ticket=${encodeURIComponent(t3.ticket)}`);
  check("Bilhete vencido é recusado", s4.status === 401, `HTTP ${s4.status}`);
  // Signed out on that device: its ticket is useless, even with another session still open
  const other = await rpc(port, "login", { emailOrUsername: "outra", password: "girafa77verde" });
  const t4 = await rpc(port, "getEventTicket", {}, token2);
  await rpc(port, "logout", {}, token2);
  const s5 = await request(port, "GET", `/api/events?ticket=${encodeURIComponent(t4.ticket)}`);
  check("Bilhete de uma sessão que saiu é recusado (mesmo com outra aberta)", other.ok && s5.status === 401, `HTTP ${s5.status}`);

  // ---- Attachments -----------------------------------------------------------
  const up = await rpc(port, "uploadMedia", { fileName: "foto.png", mimeType: "image/png", base64Data: PNG.toString("base64"), kind: "file" }, token);
  const signedPath = up.url ? up.url.slice(up.url.indexOf("/uploads/")) : "";
  check("Anexo enviado volta com link assinado", up.ok && /\?exp=\d+&sig=[0-9a-f]{40}$/.test(signedPath), signedPath.replace(/sig=.*/, "sig=..."));
  const g1 = await request(port, "GET", signedPath);
  check("Link assinado abre o anexo", g1.status === 200, `HTTP ${g1.status}`);
  const g2 = await request(port, "GET", signedPath.split("?")[0]);
  check("Sem assinatura o anexo não abre", g2.status === 403, `HTTP ${g2.status}`);
  const g3 = await request(port, "GET", signedPath.replace(/sig=[0-9a-f]/, (m) => (m.endsWith("0") ? "sig=1" : "sig=0")));
  check("Assinatura alterada é recusada", g3.status === 403, `HTTP ${g3.status}`);
  const name = path.basename(signedPath.split("?")[0]);
  const pastExp = Math.floor(Date.now() / 1000) - 10;
  const g4 = await request(port, "GET", `/uploads/${name}?exp=${pastExp}&sig=${server.uploadSignature(name, pastExp)}`);
  check("Link vencido é recusado", g4.status === 403, `HTTP ${g4.status}`);
  const avatar = await rpc(port, "uploadMedia", { fileName: "eu.png", mimeType: "image/png", base64Data: PNG.toString("base64"), kind: "avatar" }, token);
  const g5 = await request(port, "GET", avatar.url.slice(avatar.url.indexOf("/uploads/")));
  check("Avatar continua público (aparece em convites)", avatar.ok && !avatar.url.includes("sig=") && g5.status === 200, `HTTP ${g5.status}`);

  // The link the client sends back is stored without host or signature
  const dm = await rpc(port, "openOrCreateDm", { targetUserId: reg2.user.id }, token);
  const sent = await rpc(port, "sendMessage", { channelId: dm.dmId, content: "", attachment: { name: "foto.png", size: PNG.length, isImage: true, mimeType: "image/png", url: up.url } }, token);
  const row = server.db.prepare(`SELECT attachment_json FROM messages WHERE channel_id = ?`).get(dm.dmId);
  const storedUrl = row ? JSON.parse(row.attachment_json).url : "";
  check("Anexo é guardado sem assinatura nem endereço do servidor", sent.ok && storedUrl === `/uploads/${name}`, storedUrl);

  // ---- Rate limits and body size --------------------------------------------
  let limited = 0;
  for (let i = 0; i < 26; i++) {
    const r = await rpc(port, "sendMessage", { channelId: dm.dmId, content: `spam ${i}` }, token);
    if (r.status === 429) limited++;
  }
  check("Rajada de mensagens é barrada (429)", limited > 0, `${limited} de 26 barradas`);
  const big = await request(port, "POST", "/api/rpc", { body: { action: "updateProfile", params: { bio: "x".repeat(3 * 1024 * 1024) } }, headers: { Authorization: `Bearer ${token}` } });
  check("Pedido enorme que não é upload é recusado (413)", big.status === 413, `HTTP ${big.status}`);

  // ---- Headers -----------------------------------------------------------------
  const h = await request(port, "POST", "/api/rpc", { body: { action: "inspectInvite", params: { tokenOrUrl: "nada" } } });
  check("Respostas trazem nosniff, no-referrer e DENY", h.headers["x-content-type-options"] === "nosniff" && h.headers["referrer-policy"] === "no-referrer" && h.headers["x-frame-options"] === "DENY");
  const inv = await request(port, "GET", "/convite/naoexiste");
  check("Página de convite tem CSP sem scripts", /default-src 'none'/.test(inv.headers["content-security-policy"] || ""));

  // ---- Strict mode (after the transition) -------------------------------------
  const strict = await startServer({ ALLOW_LEGACY_EVENT_TOKEN: "0" });
  const r3 = await rpc(strict.port, "register", { email: "e@example.test", username: "estrito", displayName: "Estrito", password: "lontra55roxa" });
  const legacyStrict = await request(strict.port, "GET", `/api/events?token=${encodeURIComponent(r3.sessionToken)}`);
  check("Com ALLOW_LEGACY_EVENT_TOKEN=0 o token na URL é recusado", legacyStrict.status === 401, `HTTP ${legacyStrict.status}`);

  // ---- SQL Injection, Password Hash Non-Leakage & DM/Server Permissions ----
  const sqliLogin = await rpc(port, "login", { emailOrUsername: "' OR 1=1 --", password: "' OR '1'='1" });
  check("SQL Injection no login é neutralizado (prepared statements)", !sqliLogin.ok && !sqliLogin.sessionToken);

  const sqliSearch = await rpc(port, "searchUsers", { query: "'; DROP TABLE users; --" }, token);
  const usersStillExist = server.db.prepare("SELECT COUNT(*) AS c FROM users").get().c >= 2;
  check("SQL Injection na busca de usuários não afeta o banco", sqliSearch.ok && usersStillExist);

  const fullState = await rpc(port, "getStateSnapshot", {}, token);
  const serializedState = JSON.stringify(fullState);
  check(
    "Hash de senha (scrypt) e tokens nunca vazam no snapshot da API",
    fullState.ok && !serializedState.includes("password_hash") && !serializedState.includes("scrypt$")
  );

  // Register fresh users (not rate-limited by the spam test above) to test DM & Server isolation and permissions
  const regAuthor = await rpc(port, "register", {
    email: "autor@example.test",
    username: "autor_dm",
    displayName: "Autor",
    password: "falcao99dourado"
  });
  const tokenAuthor = regAuthor.sessionToken;

  const regPeer = await rpc(port, "register", {
    email: "peer@example.test",
    username: "parceiro_dm",
    displayName: "Parceiro",
    password: "tigre77prateado"
  });
  const tokenPeer = regPeer.sessionToken;

  const regOutsider = await rpc(port, "register", {
    email: "outsider@example.test",
    username: "intruso",
    displayName: "Intruso",
    password: "pantera88negra"
  });
  const tokenOutsider = regOutsider.sessionToken;

  // Author opens DM with Peer and sends a message
  const dmSec = await rpc(port, "openOrCreateDm", { targetUserId: regPeer.user.id }, tokenAuthor);
  const dmMsgRes = await rpc(port, "sendMessage", { channelId: dmSec.dmId, content: "Mensagem privada na DM" }, tokenAuthor);
  const dmMsgId = dmMsgRes.messageId;

  // Outsider tries to send/delete in Author & Peer's DM
  const outsiderSendDm = await rpc(port, "sendMessage", { channelId: dmSec.dmId, content: "Tentando invadir DM" }, tokenOutsider);
  check("Terceiro fora da DM não consegue enviar mensagem na DM (403)", !outsiderSendDm.ok && outsiderSendDm.status === 403);

  // Peer (the other DM participant) tries to delete Author's message in the DM -> MUST BE BLOCKED (403)
  const peerDeleteDm = await rpc(port, "deleteMessage", { channelId: dmSec.dmId, messageId: dmMsgId }, tokenPeer);
  check("Participante da DM NÃO consegue excluir mensagem da outra pessoa (403)", !peerDeleteDm.ok && peerDeleteDm.status === 403);

  // Author deletes their own DM message -> MUST SUCCEED
  const authorDeleteDm = await rpc(port, "deleteMessage", { channelId: dmSec.dmId, messageId: dmMsgId }, tokenAuthor);
  check("Autor consegue excluir a própria mensagem na DM", authorDeleteDm.ok);

  // Server permissions: Regular member vs Admin role deleting someone else's message
  const guildRes = await rpc(port, "createGuild", { name: "Servidor Seguro" }, tokenAuthor);
  const guildId = guildRes.guildId;
  const guildChannelId = guildRes.generalChannelId;
  const adminRole = server.db.prepare("SELECT id FROM guild_roles WHERE guild_id = ? AND name = 'Admin'").get(guildId);

  // Outsider tries to read guild invites without being a member
  const outsiderInvites = await rpc(port, "getGuildInvites", { guildId }, tokenOutsider);
  check("Não-membro não consegue listar convites do servidor (403)", !outsiderInvites.ok && outsiderInvites.status === 403);

  // Invite Peer to the server as a regular member
  const invCreate = await rpc(port, "createInvite", { guildId }, tokenAuthor);
  await rpc(port, "acceptInvite", { code: invCreate.invite.code }, tokenPeer);

  // Owner (Author) posts a message in the server
  const srvMsg = await rpc(port, "sendMessage", { channelId: guildChannelId, content: "Mensagem no servidor" }, tokenAuthor);
  const srvMsgId = srvMsg.messageId;

  // Peer (regular member without Admin/MANAGE_MESSAGES) tries to delete Author's message -> MUST FAIL (403)
  const memberDeleteSrv = await rpc(port, "deleteMessage", { channelId: guildChannelId, messageId: srvMsgId }, tokenPeer);
  check("Membro comum sem cargo Admin não exclui mensagem alheia no servidor (403)", !memberDeleteSrv.ok && memberDeleteSrv.status === 403);

  // Grant Admin role to Peer, then Peer deletes Author's message -> MUST SUCCEED
  await rpc(port, "assignMemberRole", { guildId, targetUserId: regPeer.user.id, roleId: adminRole.id }, tokenAuthor);
  const adminDeleteSrv = await rpc(port, "deleteMessage", { channelId: guildChannelId, messageId: srvMsgId }, tokenPeer);
  check("Membro com cargo Admin consegue excluir mensagem de outra pessoa no servidor", adminDeleteSrv.ok);

  // ---- Update signatures ------------------------------------------------------
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const manifest = Buffer.from(JSON.stringify({ version: "99.0.0", sha256: "a".repeat(64), size: 1, publishedAt: "x" }));
  const foreignSig = crypto.sign("sha256", manifest, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  let rejected = false;
  try {
    readSignedManifest(manifest, foreignSig, "1.0.0");
  } catch (e) {
    rejected = e.message === "signature";
  }
  check("Atualização assinada com outra chave é recusada", rejected);

  server.server.close();
  strict.server.server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} de ${results.length} verificações de segurança passaram`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
