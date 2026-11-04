// 1. Dynamic version check from server with offline fallback
fetch("https://129-159-51-96.sslip.io/download/version.json", { cache: "no-store" })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(v) {
    if (!v || !v.version) return;
    var cleanVer = v.version.replace(/[^0-9.]/g, "");
    var metaEl = document.getElementById("version-line");
    if (metaEl) {
      metaEl.innerHTML = "<strong>Versão " + cleanVer + " para Windows 10 e 11, 64 bits</strong> · Instalador baixa cerca de 120 MB";
    }
    var footEl = document.getElementById("version-footer");
    if (footEl) {
      footEl.textContent = "Versão " + cleanVer + " oficial · Windows 10 e 11 (64 bits)";
    }
  })
  .catch(function() {
    // Fallback default message is already in HTML markup
  });

// 2. PowerShell copy button with instant visual feedback
var copyBtn = document.getElementById("copy-btn");
var copyLabel = document.getElementById("copy-label");
var psCmd = document.getElementById("ps-cmd");

if (copyBtn && copyLabel && psCmd) {
  copyBtn.addEventListener("click", function() {
    var text = psCmd.textContent.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, fallbackCopy);
    } else {
      fallbackCopy();
    }

    function showCopied() {
      copyLabel.textContent = "Copiado!";
      copyBtn.style.background = "var(--voice-green)";
      copyBtn.style.color = "#ffffff";
      setTimeout(function() {
        copyLabel.textContent = "Copiar";
        copyBtn.style.background = "";
        copyBtn.style.color = "";
      }, 2200);
    }

    function fallbackCopy() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showCopied();
      } catch(e) {}
      document.body.removeChild(ta);
    }
  });
}
