// Creates a new release signing key (ECDSA P-256) and puts its public half in
// the app, the installer and install.ps1. Use it only when the private key is
// lost (see docs/PUBLICAR.md): app versions that only know the old key will not
// accept updates signed with the new one, so people reinstall once from the site.
//
//   npm run new-signing-key
//
// The private key goes to ~/.huddle-signing/release-key.pem (or HUDDLE_SIGNING_KEY)
// and is never overwritten. Make an offline copy of it.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const keyPath = process.env.HUDDLE_SIGNING_KEY || path.join(os.homedir(), ".huddle-signing", "release-key.pem");
if (fs.existsSync(keyPath)) {
  console.error(`Já existe uma chave em ${keyPath}. Nada foi alterado.`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).trim();
const jwk = publicKey.export({ format: "jwk" });
const b64 = (s) => Buffer.from(s, "base64url").toString("base64");
const x = b64(jwk.x);
const y = b64(jwk.y);

fs.mkdirSync(path.dirname(keyPath), { recursive: true });
fs.writeFileSync(keyPath, privatePem, { mode: 0o600 });

function edit(rel, change) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, "utf8");
  const next = change(raw);
  if (next === raw) throw new Error(`Não encontrei onde trocar a chave em ${rel}`);
  fs.writeFileSync(file, next);
}

// App: the new key is added in front (the old one stays listed, harmless)
edit("electron/updateSignature.js", (s) => s.replace("const PUBLIC_KEYS = [\n", `const PUBLIC_KEYS = [\n  \`${publicPem}\`,\n`).replace("const PUBLIC_KEYS = [\r\n", `const PUBLIC_KEYS = [\r\n  \`${publicPem.replace(/\n/g, "\r\n")}\`,\r\n`));
// Installer and install.ps1 check one key: replaced
edit("installer/Instalador.cs", (s) =>
  s.replace(/SigningKeyX = "[^"]+"/, `SigningKeyX = "${x}"`).replace(/SigningKeyY = "[^"]+"/, `SigningKeyY = "${y}"`)
);
edit("scripts/install.ps1", (s) =>
  s.replace(/\$point\.X = \[Convert\]::FromBase64String\("[^"]+"\)/, `$point.X = [Convert]::FromBase64String("${x}")`)
    .replace(/\$point\.Y = \[Convert\]::FromBase64String\("[^"]+"\)/, `$point.Y = [Convert]::FromBase64String("${y}")`)
);

console.log(`Chave privada salva em: ${keyPath}`);
console.log("Chave pública colocada em electron/updateSignature.js, installer/Instalador.cs e scripts/install.ps1.");
console.log("Faça uma cópia da chave privada num lugar seguro e offline (pen drive, gerenciador de senhas).");
