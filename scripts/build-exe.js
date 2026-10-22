"use strict";

const packager = require("@electron/packager");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

async function build() {
  const rootDir = path.resolve(__dirname, "..");
  const outDir = path.join(rootDir, "dist");
  const iconPath = path.join(rootDir, "assets", "app.ico");

  console.log("[1/3] Packaging Electron application with @electron/packager...");
  const appPaths = await packager({
    dir: rootDir,
    name: "Discord",
    platform: "win32",
    arch: "x64",
    out: outDir,
    overwrite: true,
    asar: false,
    icon: iconPath,
    ignore: [
      // Secrets stay out of the executable (the app reads them from %APPDATA%\Eco)
      /^\/app\.config\.local\.json$/,
      /^\/\.env/,
      /^\/\.git($|\/)/,
      /^\/dist($|\/)/,
      /^\/docs\/screenshots($|\/)/
    ]
  });

  const packagedDir = appPaths[0];
  const packagedExe = path.join(packagedDir, "Discord.exe");
  console.log("Packaged Electron binary at:", packagedExe);

  // Launcher goes on the current user's Desktop (DESKTOP_DIR overrides it)
  const desktopDir = process.env.DESKTOP_DIR || path.join(os.homedir(), "Desktop");
  const desktopExe = path.join(desktopDir, "Discord.exe");
  console.log(`[2/3] Compiling standalone Desktop launcher ${desktopExe}...`);
  const csSourcePath = path.join(outDir, "DiscordLauncher.cs");
  const escapedTargetExe = packagedExe.replace(/\\/g, "\\\\");
  const escapedWorkDir = packagedDir.replace(/\\/g, "\\\\");

  const csCode = `
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("Discord")]
[assembly: AssemblyDescription("Discord Desktop Client (REA Reconstructed v1.0.9262)")]
[assembly: AssemblyCompany("Discord Replica")]
[assembly: AssemblyProduct("Discord")]
[assembly: AssemblyVersion("1.0.9262.0")]
[assembly: AssemblyFileVersion("1.0.9262.0")]

namespace DiscordLauncher {
  class Program {
    [STAThread]
    static int Main(string[] args) {
      string targetExe = "${escapedTargetExe}";
      string workDir = "${escapedWorkDir}";
      if (!File.Exists(targetExe)) {
        return 1;
      }
      ProcessStartInfo psi = new ProcessStartInfo();
      psi.FileName = targetExe;
      psi.WorkingDirectory = workDir;
      if (args != null && args.Length > 0) {
        psi.Arguments = string.Join(" ", args);
      }
      psi.UseShellExecute = false;
      Process.Start(psi);
      return 0;
    }
  }
}
`;

  fs.writeFileSync(csSourcePath, csCode, "utf8");

  const cscCandidates = [
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
  ];
  const cscPath = cscCandidates.find((p) => fs.existsSync(p));
  if (!cscPath) {
    throw new Error("Could not find csc.exe to compile Desktop stub launcher.");
  }

  execFileSync(cscPath, [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    `/out:${desktopExe}`,
    `/win32icon:${iconPath}`,
    "/optimize+",
    csSourcePath
  ], { stdio: "inherit" });

  console.log("[3/3] Verified standalone executable created at:", desktopExe);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
