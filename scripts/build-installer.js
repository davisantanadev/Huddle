// Builds dist/Instalar-Huddle.exe from installer/Instalador.cs with the C#
// compiler that ships with Windows. The exe is published next to Eco.zip on the
// server (/download/Instalar-Huddle.exe) and linked from the website.
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const csc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const outDir = process.env.BUILD_OUT_DIR || path.join(root, "dist");
const out = path.join(outDir, "Instalar-Huddle.exe");
fs.mkdirSync(outDir, { recursive: true });

execFileSync(
  csc,
  [
    "/nologo",
    "/optimize+",
    "/target:winexe",
    `/win32icon:${path.join(root, "assets", "app.ico")}`,
    `/win32manifest:${path.join(root, "installer", "app.manifest")}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    "/r:System.IO.Compression.dll",
    "/r:System.IO.Compression.FileSystem.dll",
    `/out:${out}`,
    path.join(root, "installer", "Instalador.cs")
  ],
  { stdio: "inherit" }
);
console.log(`Instalador: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
