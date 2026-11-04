"use strict";

// @electron/packager 20 is an ES module; Node loads it with require()
const { packager } = require("@electron/packager");
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

  // "Invadominio zak' zak.exe" (the old name) opens Huddle.exe: versions up to
  // 1.2.10 restart the app by that name after updating, and old pins use it
  const csc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  execFileSync(csc, [
    "/nologo",
    "/optimize+",
    "/target:winexe",
    `/win32icon:${iconPath}`,
    "/r:System.Core.dll",
    `/out:${path.join(packagedDir, "Invadominio zak' zak.exe")}`,
    path.join(rootDir, "installer", "LegacyLauncher.cs")
  ]);

  // The small native helpers (PC sound for screen shares, memory trimming) go
  // in already compiled: compiling them on the user's PC made antivirus
  // programs block the app (and its screen share). They carry proper file
  // details so they are not anonymous executables.
  const helpersDir = path.join(packagedDir, "helpers");
  fs.mkdirSync(helpersDir, { recursive: true });
  const version = require(path.join(rootDir, "package.json")).version;
  const helpers = [
    { name: "SystemAudio", source: path.join(rootDir, "electron", "systemaudio", "SystemAudio.cs"), title: `${appName} - som do PC na transmissão` },
    { name: "MemTrim", source: path.join(rootDir, "electron", "memtrim", "MemTrim.cs"), title: `${appName} - liberação de memória` }
  ];
  for (const helper of helpers) {
    const infoPath = path.join(os.tmpdir(), `huddle-${helper.name}-info.cs`);
    const csString = (s) => JSON.stringify(String(s));
    fs.writeFileSync(
      infoPath,
      [
        "using System.Reflection;",
        `[assembly: AssemblyTitle(${csString(helper.title)})]`,
        `[assembly: AssemblyDescription(${csString(helper.title)})]`,
        `[assembly: AssemblyCompany(${csString(appName)})]`,
        `[assembly: AssemblyProduct(${csString(appName)})]`,
        `[assembly: AssemblyCopyright(${csString(appName)})]`,
        `[assembly: AssemblyVersion(${csString(version + ".0")})]`,
        `[assembly: AssemblyFileVersion(${csString(version + ".0")})]`
      ].join("\r\n")
    );
    execFileSync(csc, [
      "/nologo",
      "/optimize+",
      "/target:exe",
      `/win32icon:${iconPath}`,
      `/out:${path.join(helpersDir, `${helper.name}.exe`)}`,
      helper.source,
      infoPath
    ]);
    fs.unlinkSync(infoPath);
  }
  console.log("Compiled helpers into:", helpersDir);

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
