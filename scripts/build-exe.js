"use strict";

const packager = require("@electron/packager");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { loadAppConfig } = require("../electron/appConfig");

async function build() {
  const rootDir = path.resolve(__dirname, "..");
  // BUILD_OUT_DIR builds somewhere else (e.g. while the app in dist/ is open)
  const outDir = process.env.BUILD_OUT_DIR ? path.resolve(process.env.BUILD_OUT_DIR) : path.join(rootDir, "dist");
  const iconPath = path.join(rootDir, "assets", "app.ico");

  console.log("[1/3] Packaging Electron application with @electron/packager...");
  const appName = loadAppConfig().appName;
  const appPaths = await packager({
    dir: rootDir,
    // The .exe and the Task Manager entry carry the app's name
    name: appName,
    executableName: appName,
    appCopyright: appName,
    win32metadata: {
      FileDescription: appName,
      ProductName: appName,
      CompanyName: appName,
      InternalName: appName,
      OriginalFilename: `${appName}.exe`
    },
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
      /^\/supabase($|\/)/,
      /^\/docs\/screenshots($|\/)/
    ]
  });

  const packagedDir = appPaths[0];
  const packagedExe = path.join(packagedDir, `${appName}.exe`);
  console.log("Packaged Electron binary at:", packagedExe);

  if (process.env.NO_SHORTCUT === "1") return;

  // Desktop shortcut (.lnk) to the packaged app, named after app.config.json →
  // appName. DESKTOP_DIR overrides the folder.
  const desktopDir = process.env.DESKTOP_DIR || path.join(os.homedir(), "Desktop");
  const shortcutPath = path.join(desktopDir, `${appName}.lnk`);
  console.log(`[2/3] Creating Desktop shortcut ${shortcutPath}...`);

  // Older builds compiled a launcher Discord.exe onto the Desktop instead;
  // remove it, but only if it really is that launcher (company "Discord Replica")
  const legacyLauncher = path.join(desktopDir, "Discord.exe");
  const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const powershell = (script) =>
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();

  if (fs.existsSync(legacyLauncher)) {
    const company = powershell(`(Get-Item -LiteralPath ${psQuote(legacyLauncher)}).VersionInfo.CompanyName`);
    if (company === "Discord Replica") {
      fs.unlinkSync(legacyLauncher);
      console.log("Removed the old Desktop launcher:", legacyLauncher);
    }
  }

  powershell(
    [
      "$shell = New-Object -ComObject WScript.Shell",
      `$lnk = $shell.CreateShortcut(${psQuote(shortcutPath)})`,
      `$lnk.TargetPath = ${psQuote(packagedExe)}`,
      `$lnk.WorkingDirectory = ${psQuote(packagedDir)}`,
      `$lnk.IconLocation = ${psQuote(packagedExe + ",0")}`,
      `$lnk.Description = ${psQuote(appName)}`,
      "$lnk.Save()"
    ].join("; ")
  );

  console.log("[3/3] Desktop shortcut created at:", shortcutPath);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
