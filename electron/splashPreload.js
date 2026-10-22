"use strict";

const { ipcRenderer } = require("electron");

let currentState = { status: "checking-for-updates" };
let currentQuote = "";
let domReady = false;

function shouldShowProgress(state) {
  return (
    typeof state.progress === "number" &&
    (state.status === "downloading-updates" || state.status === "installing-updates")
  );
}

function getStatusText(state) {
  switch (state.status) {
    case "installing-updates":
      return `Installing update ${Number(state.current ?? 1)} of ${Number(state.total ?? 1)}\u2026`;
    case "downloading-updates":
      return `Downloading update ${Number(state.current ?? 1)} of ${Number(state.total ?? 1)}\u2026`;
    case "update-failure":
      return `Update failed \u2014 retrying in ${Number(state.seconds ?? 0)} sec\u2026`;
    case "launching":
      return "Starting\u2026";
    default:
      return "Checking for updates\u2026";
  }
}

function renderSplash(state) {
  const mount = document.getElementById("splash-mount");
  if (!mount) return;

  const existingStatus = mount.querySelector(".splash-status");
  if (existingStatus) {
    existingStatus.textContent = getStatusText(state);
    const quoteEl = mount.querySelector(".splash-quote");
    if (quoteEl && currentQuote) {
      quoteEl.textContent = currentQuote;
    }
    const splashText = existingStatus.closest(".splash-text");
    if (splashText) {
      const existingProgress = splashText.querySelector(".progress, .progress-placeholder");
      if (shouldShowProgress(state)) {
        const progress = document.createElement("div");
        progress.className = "progress";
        const bar = document.createElement("div");
        bar.className = "progress-bar";
        const complete = document.createElement("div");
        complete.className = "complete";
        complete.style.width = `${Number(state.progress)}%`;
        bar.appendChild(complete);
        progress.appendChild(bar);
        if (existingProgress) existingProgress.replaceWith(progress);
        else splashText.appendChild(progress);
      } else if (existingProgress && !existingProgress.classList.contains("progress-placeholder")) {
        const placeholder = document.createElement("div");
        placeholder.className = "progress-placeholder";
        placeholder.textContent = "\u00a0";
        existingProgress.replaceWith(placeholder);
      }
    }
    return;
  }

  const progressHtml = shouldShowProgress(state)
    ? `<div class="progress"><div class="progress-bar"><div class="complete" style="width: ${Number(state.progress)}%"></div></div></div>`
    : `<div class="progress-placeholder">&nbsp;</div>`;

  mount.innerHTML = `<div id="splash">
    <div class="splash-inner">
      <video autoplay width="200" height="200" loop muted id="splash-video">
        <source src="./videos/connecting.webm" type="video/webm" />
      </video>
      <div class="splash-text">
        <span class="splash-quote">${currentQuote}</span>
        <span class="splash-status">${getStatusText(state)}</span>
        ${progressHtml}
      </div>
    </div>
  </div>`;

  const video = document.getElementById("splash-video");
  if (video) {
    video.addEventListener("loadeddata", () => {
      video.classList.add("loaded");
    });
  }
}

ipcRenderer.on("DISCORD_SPLASH_UPDATE_STATE", (_, state) => {
  currentState = state;
  if (domReady) {
    renderSplash(state);
  }
});

ipcRenderer.on("DISCORD_SPLASH_SCREEN_QUOTE", (_, quote) => {
  currentQuote = quote || "";
  if (domReady) {
    renderSplash(currentState);
  }
});

window.addEventListener("DOMContentLoaded", () => {
  domReady = true;
  renderSplash(currentState);
  ipcRenderer.send("DISCORD_SPLASH_SCREEN_READY");
});
