// electron scripts/ns-bench.js <speech.wav> <background-voice.wav>: compares noise-suppression filters
// (see ns-bench.html) and prints the scores plus the CPU used by the renderer.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const [wav, babble] = process.argv.slice(2).filter((a) => !a.startsWith("-")).slice(-2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" } });
  win.webContents.on("console-message", (_e, level, msg) => level >= 2 && console.log("[page]", msg));
  await win.loadFile(path.join(__dirname, "ns-bench.html"));
  while ((await win.webContents.executeJavaScript("document.title")) !== "ready") await new Promise((r) => setTimeout(r, 200));
  const result = await win.webContents.executeJavaScript(`runBench(${JSON.stringify(pathToFileURL(path.resolve(wav)).href)}, ${JSON.stringify(pathToFileURL(path.resolve(babble)).href)})`);
  console.log(JSON.stringify(result, null, 1));
  app.exit(0);
});
