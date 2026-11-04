// Packs and signs a release from the built app (dist/Huddle-win32-x64):
//
//   dist/release/Eco.zip          the app
//   dist/release/Eco.zip.sha256   for app versions before signed updates
//   dist/release/version.json     {"version","notes"}: the update banner and the website
//   dist/release/manifest.json    {"version","sha256","size","publishedAt"}
//   dist/release/manifest.sig     signature of manifest.json (electron/updateSignature.js)
//
// The private key is read from HUDDLE_SIGNING_KEY or ~/.huddle-signing/release-key.pem
// and never leaves this PC. See docs/PUBLICAR.md for the whole procedure.
//
// Usage: node scripts/make-release.js --notes "O que mudou nesta versão"

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { readSignedManifest } = require("../electron/updateSignature");

const root = path.resolve(__dirname, "..");
const version = require(path.join(root, "package.json")).version;
const appDir = path.join(root, "dist", "Huddle-win32-x64");
const out = path.join(root, "dist", "release");
const notesIdx = process.argv.indexOf("--notes");
const notes = notesIdx > -1 ? String(process.argv[notesIdx + 1] || "") : "";
const keyPath = process.env.HUDDLE_SIGNING_KEY || path.join(os.homedir(), ".huddle-signing", "release-key.pem");

function fail(msg) {
  console.error(`\n[release] ${msg}\n`);
  process.exit(1);
}

if (!notes.trim()) fail('Escreva as novidades: --notes "..."');
if (!fs.existsSync(appDir)) fail("Gere o app antes: NO_SHORTCUT=1 npm run build:exe");
const builtVersion = JSON.parse(fs.readFileSync(path.join(appDir, "resources", "app", "package.json"), "utf8")).version;
if (builtVersion !== version) fail(`O app gerado é ${builtVersion}, mas o package.json diz ${version}. Gere de novo.`);
if (!fs.existsSync(keyPath)) fail(`Chave de assinatura não encontrada em ${keyPath}`);

fs.mkdirSync(out, { recursive: true });
const zip = path.join(out, "Eco.zip");
fs.rmSync(zip, { force: true });
console.log("[release] compactando...");
execFileSync("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${appDir.replace(/'/g, "''")}', '${zip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`
]);

const data = fs.readFileSync(zip);
const sha256 = crypto.createHash("sha256").update(data).digest("hex");
const manifestBytes = Buffer.from(JSON.stringify({ version, sha256, size: data.length, publishedAt: new Date().toISOString() }), "utf8");
const signature = crypto.sign("sha256", manifestBytes, { key: fs.readFileSync(keyPath), dsaEncoding: "ieee-p1363" });

fs.writeFileSync(path.join(out, "Eco.zip.sha256"), `${sha256}  Eco.zip\n`);
fs.writeFileSync(path.join(out, "version.json"), JSON.stringify({ version, notes }));
fs.writeFileSync(path.join(out, "manifest.json"), manifestBytes);
fs.writeFileSync(path.join(out, "manifest.sig"), signature.toString("base64"));

// The app's own check, against a version just below this one
readSignedManifest(manifestBytes, signature.toString("base64"), "0.0.0");
console.log(`[release] ${version} pronta e assinada em ${out}`);
console.log(`[release] Eco.zip ${(data.length / 1048576).toFixed(1)} MB, sha256 ${sha256}`);
