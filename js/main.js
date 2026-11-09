(function () {
  "use strict";

  var DOWNLOAD_BASE = "https://129-159-51-96.sslip.io/download";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  var state = { lang: "pt", version: "" };

  // ==========================================================================
  // Idiomas: o português está no HTML (guardado na 1ª leitura); o inglês, aqui
  // ==========================================================================
  var EN = {
    docTitle: "Huddle: Chat, voice and screen share for Windows",
    docDesc: "Chat, clean voice and screen sharing for Windows, made for playing with friends. No ads and no third-party servers.",
    navFeatures: "Features", navMixer: "Volume", navInstall: "How to install", navPowerShell: "PowerShell", navDownload: "Download .exe",
    hudLive: "Live call",
    heroH1a: "Clean voice, chat and", heroH1b: "lag-free gameplay.",
    heroLead: "Crisp voice calls, screen sharing with sound and full chat. One app for your group, with no ads and no third-party servers.",
    heroBtn: "Download for Windows", heroSee: "See features",
    heroMeta: "<strong>Windows 10 and 11 (64-bit)</strong> · ~120 MB installer",
    tagRoom: "game room", tagCall: "4 in call", tagChat: "call chat",
    tkGames: "6,000+ GAMES", tkAds: "NO ADS", tkUpd: "1-CLICK UPDATES",
    tourH2: "Everything a call needs, in one app",
    s1Title: "Clean voice and live screen",
    s1Desc: "Smart noise filter on your mic and on what you hear, per-person volume and one key to mute. Several screens at once, with game sound and no echo, at the resolution you pick.",
    s2Title: "Full chat inside the call",
    s2Desc: "Replies, reactions, editing, @mentions, polls and files. Audio and video play right in the conversation, and the call chat sits beside the room.",
    s3Title: "See what the crew is playing",
    s3Desc: "More than 6,000 games recognized, with cover art, play time and activity on the profile. GIF avatars and banners, and colored roles on the server.",
    s4Title: "Call straight from the conversation",
    s4Desc: "Direct-message calls with a lo-fi tune while it rings, a panel you can collapse or resize, and a join button for whoever arrives late.",
    mixH2: "Every voice at its own volume",
    mixDesc: "Try the controls: in the app every person in the call has their own volume, and one key mutes your mic instantly, even with the game in front.",
    mixKey: "Mute", mixHead: "call controls",
    exH2: "And the rest that makes a difference",
    e1Tag: "updates", e1Title: "Updates in one click", e1Desc: "The app tells you when a new version is out and updates itself, without touching your accounts and settings. If something goes wrong while opening, it recovers on its own.",
    e2Tag: "servers", e2Title: "Public servers", e2Desc: "Browse and join open servers, or make yours public whenever you want, right in its settings.",
    e3Tag: "shortcuts", e3Title: "Right-click everything", e3Desc: "Pin, mute, ignore and invite on any conversation, person or server, instantly.",
    e4Tag: "alerts", e4Title: "Notifications in your control", e4Desc: "All messages, only @mentions or nothing, per server, with timed mute and the app's name on the alert.",
    e5Tag: "moderation", e5Title: "Roles and permissions", e5Desc: "Colors, per-role permissions, a member list split by role and voice moderation: mute, move and disconnect whoever disrupts the call.",
    e6Tag: "light", e6Title: "Light and ad-free", e6Desc: "Uses little memory day to day, with no ads and no third-party server on your conversations.",
    instH2: "Simple install on your Windows",
    instDesc: "Three steps to join the room. No complicated setup and no permission you don't need to give.",
    st1Title: "Download the file", st1Desc: "Click <strong>Download for Windows</strong> to get the official <strong>Instalar-Huddle.exe</strong>.",
    st2Title: "Pick the folder", st2Desc: "Open the installer, choose where to save with <strong>Procurar...</strong> (or keep the suggested folder) and tick your shortcuts.",
    st3Title: "Click Install", st3Desc: "The installer downloads the app, checks the files and opens Huddle ready to sign in.",
    smH3: "Seeing \"Windows protected your PC\"?",
    smP1: "This SmartScreen message is normal for new independent programs that don't have Microsoft's paid certificate yet. The file is safe.",
    smP2: "To continue: click <strong>More info</strong> and then <strong>Run anyway</strong>.",
    o1Sum: "Already have Huddle installed?",
    o1P1: "Open the installer and click <strong>Atualizar</strong>: it finds the previous folder and swaps only the files it needs, keeping your conversations and accounts.",
    o1P2: "To uninstall: <strong>Settings &gt; Apps &gt; Installed apps &gt; Huddle</strong>.",
    o2Sum: "Prefer installing with PowerShell?",
    o2P: "Copy and paste this command into PowerShell:",
    copyBtn: "Copy", copiedBtn: "Copied!",
    ctaH2: "Ready to play and talk?", ctaP: "Download Huddle for Windows and call the crew right now.", ctaBtn: "Download for Windows",
    footBrand: "Huddle · Chat, voice and screen for Windows", footPrivacy: "Privacy", footTerms: "Terms of Use", footBy: "made by", footByLabel: "GitHub of davisantanadev", footSys: "Windows 10 and 11 (64-bit)",
    altCall: "A Huddle call: four people in the game room, with the call chat open beside it",
    altCall2: "Voice room with four people and the call chat open",
    altChat: "Text channel with message history, reactions and the member list",
    altAct: "Profile showing the current activity and recent games, each with its cover art",
    altDm: "A call in a direct conversation, with the person being called highlighted",
    altInst: "The Huddle installer window with the install folder and the shortcut options"
  };
  var PT = {};

  function capturePt() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      if (!(k in PT)) PT[k] = el.innerHTML.trim();
    });
    document.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-alt");
      if (!(k in PT)) PT[k] = el.getAttribute("alt") || "";
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-aria");
      if (!(k in PT)) PT[k] = el.getAttribute("aria-label") || "";
    });
    PT.docTitle = document.title;
    var meta = document.querySelector('meta[name="description"]');
    PT.docDesc = meta ? meta.getAttribute("content") : "";
    PT.copiedBtn = "Copiado!";
  }

  function decorate() {
    var dict = state.lang === "en" ? EN : PT;
    var hud = document.getElementById("hud-version");
    if (hud) hud.textContent = dict.hudLive + (state.version ? " · v" + state.version : "");
    var foot = document.getElementById("foot-ver");
    if (foot) foot.textContent = dict.footSys + (state.version ? " · v" + state.version : "");
  }

  function applyLang(lang) {
    state.lang = lang;
    try { localStorage.setItem("huddle_lang", lang); } catch (e) {}
    var dict = lang === "en" ? EN : PT;
    root.lang = lang === "en" ? "en" : "pt-BR";
    document.title = dict.docTitle;
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", dict.docDesc);
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      if (dict[k] != null) el.innerHTML = dict[k];
    });
    document.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-alt");
      if (dict[k] != null) el.setAttribute("alt", dict[k]);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-aria");
      if (dict[k] != null) el.setAttribute("aria-label", dict[k]);
    });
    [["lang-pt", "pt"], ["lang-en", "en"]].forEach(function (p) {
      var b = document.getElementById(p[0]);
      if (!b) return;
      b.classList.toggle("active", lang === p[1]);
      b.setAttribute("aria-pressed", lang === p[1] ? "true" : "false");
    });
    decorate();
    if (hasGsap && window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  // ==========================================================================
  // Versão publicada (vem do servidor do app: a página não muda a cada versão)
  // ==========================================================================
  function loadVersion() {
    if (!window.fetch) return;
    fetch(DOWNLOAD_BASE + "/version.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && /^[0-9.]+$/.test(String(j.version || ""))) {
          state.version = j.version;
          decorate();
        }
      })
      .catch(function () {});
  }

  // ==========================================================================
  // Cabeçalho, barra de progresso
  // ==========================================================================
  function initChrome() {
    var header = document.getElementById("site-header");
    var bar = document.getElementById("scroll-bar");
    var ticking = false;
    function update() {
      ticking = false;
      var y = window.scrollY || 0;
      if (header) header.classList.toggle("is-solid", y > 12);
      if (bar) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, y / max) : 0) + ")";
      }
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ==========================================================================
  // Mixer (a parte "ao vivo" da página): barras de voz + volume de cada pessoa
  // ==========================================================================
  function initMixer() {
    var rows = Array.prototype.slice.call(document.querySelectorAll(".mix-row"));
    if (!rows.length) return;
    var BARS = 28;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    var items = rows.map(function (row, i) {
      var canvas = row.querySelector(".mix-wave");
      var range = row.querySelector(".mix-range");
      var out = row.querySelector(".mix-val");
      var item = { row: row, canvas: canvas, ctx: canvas.getContext("2d"), range: range, out: out, seed: i * 17.3, w: 0, h: 0 };
      function setVol() {
        var v = Number(range.value);
        item.vol = v;
        out.textContent = v + "%";
        range.style.setProperty("--p", v + "%");
      }
      range.addEventListener("input", function () { setVol(); if (reduced) paint(performance.now()); });
      setVol();
      return item;
    });

    function size() {
      items.forEach(function (it) {
        var r = it.canvas.getBoundingClientRect();
        it.w = Math.max(60, Math.round(r.width));
        it.h = Math.max(24, Math.round(r.height));
        it.canvas.width = it.w * dpr;
        it.canvas.height = it.h * dpr;
        it.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      });
    }

    function paint(t) {
      items.forEach(function (it) {
        var c = it.ctx;
        c.clearRect(0, 0, it.w, it.h);
        var speaking = it.row.getAttribute("data-speaking") === "1";
        var gain = it.vol / 100;
        var gap = 3;
        var bw = (it.w - gap * (BARS - 1)) / BARS;
        for (var b = 0; b < BARS; b++) {
          var phase = t * 0.004 + b * 0.55 + it.seed;
          var wave = (Math.sin(phase) + Math.sin(phase * 1.9 + 1.3) * 0.6 + 1.6) / 3.2;
          var level = speaking ? 0.18 + wave * 0.82 : 0.08 + wave * 0.1;
          var hgt = Math.max(2, level * gain * it.h);
          var x = b * (bw + gap);
          c.fillStyle = speaking ? "rgba(91,157,255," + (0.45 + wave * 0.55).toFixed(2) + ")" : "rgba(143,163,204,0.35)";
          c.fillRect(x, (it.h - hgt) / 2, bw, hgt);
        }
      });
    }

    var running = false, raf = 0;
    function loop(t) {
      if (!running) return;
      paint(t);
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!running && !reduced) { running = true; raf = requestAnimationFrame(loop); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    size();
    paint(0);
    window.addEventListener("resize", function () { size(); paint(performance.now()); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? start() : stop();
      }, { threshold: 0.05 }).observe(document.querySelector(".mixer"));
    } else {
      start();
    }
  }

  // ==========================================================================
  // PowerShell: comando digitado + copiar
  // ==========================================================================
  function initTerminal() {
    var code = document.getElementById("ps-cmd");
    var det = document.getElementById("powershell");
    var copyBtn = document.getElementById("copy-btn");
    var copyLabel = document.getElementById("copy-label");
    if (!code) return;
    var full = code.getAttribute("data-full") || code.textContent;
    var typed = false;

    function type() {
      if (typed || reduced) return;
      typed = true;
      var i = 0;
      code.textContent = "";
      code.classList.add("typing");
      (function step() {
        i += 2;
        code.textContent = full.slice(0, i);
        if (i < full.length) setTimeout(step, 22);
        else { code.textContent = full; code.classList.remove("typing"); }
      })();
    }
    if (det) det.addEventListener("toggle", function () { if (det.open) type(); });

    if (copyBtn && copyLabel) {
      copyBtn.addEventListener("click", function () {
        function done() {
          var dict = state.lang === "en" ? EN : PT;
          copyLabel.textContent = dict.copiedBtn;
          copyBtn.classList.add("copied");
          setTimeout(function () {
            copyLabel.textContent = (state.lang === "en" ? EN : PT).copyBtn;
            copyBtn.classList.remove("copied");
          }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(full).then(done).catch(function () {
            var r = document.createRange(); r.selectNode(code);
            var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          });
        } else {
          var r = document.createRange(); r.selectNode(code);
          var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        }
      });
    }
  }

  // ==========================================================================
  // Movimento: Lenis + GSAP/ScrollTrigger
  // ==========================================================================
  var lenis = null;

  function scrollToEl(el, offset) {
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: offset || -70, duration: 1.2 });
    else el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  function initAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (!id || id.length < 2) return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        if (target.tagName === "DETAILS") target.open = true;
        scrollToEl(target, target.tagName === "DETAILS" ? -140 : -68);
        if (history.replaceState) history.replaceState(null, "", id);
      });
    });
  }

  function initMotion() {
    if (!hasGsap || reduced) return;
    var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    // Rolagem suave ligada ao relógio do GSAP
    if (typeof window.Lenis === "function") {
      lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
      window.__lenis = lenis; // handy for checking scenes from the console
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    }

    // 1. Entrada do herói: linhas do título sobem, o resto vem atrás
    var intro = gsap.timeline({ defaults: { ease: "power4.out" } });
    intro
      .from(".ln-in", { yPercent: 108, duration: 1.1, stagger: 0.14 }, 0.05)
      .from("[data-hero-in]", { y: 22, opacity: 0, duration: 0.8, stagger: 0.1 }, 0.35)
      .from(".hero-stage", { y: 70, opacity: 0, duration: 1.2 }, 0.5)
      .from(".site-header", { y: -30, opacity: 0, duration: 0.7 }, 0.1);

    // 2. A tela do herói começa inclinada e se endireita no scroll
    gsap.fromTo("#hero-shot", { rotateX: 16, scale: 0.9, transformOrigin: "50% 0%" }, {
      rotateX: 0, scale: 1, ease: "none",
      scrollTrigger: { trigger: ".hero-stage", start: "top 92%", end: "top 28%", scrub: 0.6 }
    });
    gsap.to(".tag-a", { y: -26, ease: "none", scrollTrigger: { trigger: ".hero-stage", start: "top bottom", end: "bottom top", scrub: true } });
    gsap.to(".tag-b", { y: -52, ease: "none", scrollTrigger: { trigger: ".hero-stage", start: "top bottom", end: "bottom top", scrub: true } });
    gsap.to(".tag-c", { y: -36, ease: "none", scrollTrigger: { trigger: ".hero-stage", start: "top bottom", end: "bottom top", scrub: true } });

    // Ordem importa: o gatilho que FIXA a cena (tour) é criado antes de tudo que
    // vem depois dele na página, senão os outros ignoram a altura extra do pin.
    var mm = gsap.matchMedia();

    // 4. Tour de recursos: no desktop a cena fica fixa e o scroll troca o passo
    mm.add("(min-width: 1001px)", function () {
      root.classList.add("tour-pinned");
      var steps = Array.prototype.slice.call(document.querySelectorAll(".tour-step"));
      var shots = Array.prototype.slice.call(document.querySelectorAll(".tour-shots img"));
      var fill = document.getElementById("tour-fill");
      var current = -1;

      function setActive(i) {
        if (i === current) return;
        current = i;
        steps.forEach(function (s, n) { s.classList.toggle("is-active", n === i); });
        shots.forEach(function (s, n) { s.classList.toggle("is-active", n === i); });
      }
      setActive(0);

      var st = ScrollTrigger.create({
        trigger: ".tour",
        start: "top top",
        end: "+=" + steps.length * 85 + "%",
        pin: true,
        anticipatePin: 1,
        onUpdate: function (self) {
          var p = self.progress;
          setActive(Math.min(steps.length - 1, Math.floor(p * steps.length * 0.9999)));
          if (fill) fill.style.transform = "scaleY(" + p.toFixed(3) + ")";
        }
      });

      // Clicar num passo leva a cena até ele
      var handlers = steps.map(function (s, n) {
        var h = function () {
          var y = st.start + ((n + 0.5) / steps.length) * (st.end - st.start);
          if (lenis) lenis.scrollTo(y, { duration: 1.1 });
          else window.scrollTo({ top: y, behavior: "smooth" });
        };
        s.addEventListener("click", h);
        return h;
      });

      ScrollTrigger.refresh();
      return function () {
        root.classList.remove("tour-pinned");
        steps.forEach(function (s, n) { s.removeEventListener("click", handlers[n]); s.classList.add("is-active"); });
        shots.forEach(function (s) { s.classList.remove("is-active"); });
        if (fill) fill.style.transform = "";
      };
    });

    // 3. Revelações: título, texto e figura de cada seção, em sequência
    gsap.set("[data-reveal]", { opacity: 0, y: 34 });
    // (sem `once`: numa rolagem que pula a seção inteira o gatilho era apagado
    // sem revelar nada; onLeave garante que o que ficou para trás aparece)
    function reveal(batch) {
      gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, stagger: 0.09, ease: "power3.out", overwrite: true });
    }
    ScrollTrigger.batch("[data-reveal]", { start: "top 90%", onEnter: reveal, onLeave: reveal });
    // Rede de segurança: nada visível na tela fica escondido
    ScrollTrigger.addEventListener("scrollEnd", function () {
      var vh = window.innerHeight;
      var late = Array.prototype.filter.call(document.querySelectorAll("[data-reveal]"), function (el) {
        return window.gsap.getProperty(el, "opacity") < 0.05 && el.getBoundingClientRect().top < vh * 0.92;
      });
      if (late.length) reveal(late);
    });

    // 5. Linha de progresso dos passos da instalação
    mm.add("(min-width: 701px)", function () {
      gsap.fromTo("#steps-fill", { scaleX: 0 }, {
        scaleX: 1, ease: "none",
        scrollTrigger: { trigger: "#steps", start: "top 72%", end: "bottom 60%", scrub: 0.5 }
      });
    });
    mm.add("(max-width: 700px)", function () {
      gsap.fromTo("#steps-fill", { scaleY: 0 }, {
        scaleY: 1, ease: "none",
        scrollTrigger: { trigger: "#steps", start: "top 70%", end: "bottom 60%", scrub: 0.5 }
      });
    });

    // 6. Chamada final e rodapé
    gsap.fromTo(".final-glow", { scale: 0.55, opacity: 0.4 }, {
      scale: 1.1, opacity: 1, ease: "none",
      scrollTrigger: { trigger: ".final", start: "top bottom", end: "center center", scrub: true }
    });
    gsap.fromTo(".foot-mark", { yPercent: 28 }, {
      yPercent: 0, ease: "none",
      scrollTrigger: { trigger: ".site-footer", start: "top bottom", end: "bottom bottom", scrub: true }
    });

    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
  }

  // ==========================================================================
  // Início
  // ==========================================================================
  function boot() {
    capturePt();
    var saved = null;
    try { saved = localStorage.getItem("huddle_lang"); } catch (e) {}
    var initial = saved || (navigator.language && navigator.language.indexOf("en") === 0 ? "en" : "pt");
    document.getElementById("lang-pt").addEventListener("click", function () { applyLang("pt"); });
    document.getElementById("lang-en").addEventListener("click", function () { applyLang("en"); });
    if (initial === "en") applyLang("en"); else decorate();

    initChrome();
    initMixer();
    initTerminal();
    initAnchors();
    loadVersion();
    try { initMotion(); } catch (err) { if (window.console) console.error(err); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
