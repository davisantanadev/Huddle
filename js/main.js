(function() {
  // ==========================================================================
  // TRANSLATIONS DICTIONARY (PT / EN)
  // ==========================================================================
  var i18n = {
    pt: {
      docTitle: "Huddle: Chat, voz e tela para Windows",
      docDesc: "App de chat, voz limpa e compartilhamento de tela para Windows feito para jogar com os amigos, sem anúncios nem servidores de terceiros.",
      navFeatures: "Recursos",
      navInstall: "Como instalar",
      navPowerShell: "PowerShell",
      navDownload: "Baixar .exe",
      heroStatus: "Léo está falando na sala de jogo",
      heroH1: "Voz limpa, chat e gameplay sem lag.",
      heroLead: "Conecte-se com seus amigos em chamadas de alto desempenho, compartilhe sua tela com som e converse sem anúncios nem servidores lentos.",
      heroBtn: "Baixar para Windows",
      heroMeta: "<strong>Windows 10 e 11 (64 bits)</strong> · Instalador leve (~120 MB)",
      featuresH2: "Feito sob medida para jogar e conversar",
      featuresDesc: "Canais de texto rápidos, voz cristalina e transmissão fluida no servidor da sua comunidade.",
      f1Title: "Voz limpa e sem eco",
      f1Tag: "Áudio",
      f1Desc: "Supressão de ruído nativa, controle de volume individual para cada amigo na call e atalho de uma tecla para mutar na hora.",
      f2Title: "Telas simultâneas com som",
      f2Tag: "Transmissão",
      f2Desc: "Várias pessoas podem transmitir suas partidas ao mesmo tempo com áudio do jogo, sem retorno de eco no microfone.",
      f3Title: "Chat completo dentro da chamada",
      f3Tag: "Mensagens",
      f3Desc: "Respostas, reações com emojis, edição, menções com @ e reprodução de áudio e vídeo diretamente na conversa.",
      f4Title: "Perfis e identidade própria",
      f4Tag: "Personalização",
      f4Desc: "Avatares e banners em GIF liberados, cargos com cores personalizadas no servidor e indicador de quem está online.",
      f5Title: "Atualização automática e segura",
      f5Tag: "Praticidade",
      f5Desc: "O aplicativo avisa quando há novidades e atualiza com um único clique, preservando todas as suas contas e preferências.",
      demoTitle: "Controles rápidos da chamada",
      demoMute: "Mudo: <span class=\"key-cap\">F8</span>",
      installH2: "Instalação simples no seu Windows",
      installDesc: "Três passos rápidos para entrar na sala. Sem configurações complicadas nem permissões desnecessárias.",
      step1Title: "1. Baixe o arquivo",
      step1Desc: "Clique em <strong>Baixar para Windows</strong> para receber o <strong>Instalar-Huddle.exe</strong> oficial.",
      step2Title: "2. Escolha a pasta",
      step2Desc: "Abra o instalador, escolha onde salvar pelo botão <strong>Procurar...</strong> (ou mantenha a pasta sugerida) e marque seus atalhos.",
      step3Title: "3. Clique em Instalar",
      step3Desc: "O instalador baixa o app, valida os arquivos com segurança e abre o Huddle pronto para o login.",
      smartH3: "Se aparecer \"O Windows protegeu o computador\"",
      smartP1: "Esse aviso do Windows SmartScreen é normal em versões novas de programas independentes que ainda não compraram certificados corporativos pagos da Microsoft. O arquivo é 100% seguro.",
      smartP2: "Para continuar: clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>.",
      opt1Summary: "Já tem o Huddle instalado no computador?",
      opt1P1: "Basta abrir o instalador e clicar em <strong>Atualizar</strong>: ele reconhece a pasta anterior e atualiza apenas os arquivos necessários, mantendo todas as suas conversas e credenciais intactas.",
      opt1P2: "Para desinstalar no futuro: acesse <strong>Configurações &gt; Aplicativos &gt; Aplicativos instalados &gt; Huddle</strong>.",
      opt2Summary: "Prefere instalar direto pelo PowerShell?",
      opt2P: "Copie e cole o comando abaixo no terminal do PowerShell:",
      copyBtn: "Copiar",
      copiedBtn: "Copiado!",
      ctaH2: "Pronto para jogar e conversar?",
      ctaP: "Baixe o Huddle para Windows e conecte-se agora mesmo.",
      ctaBtn: "Baixar para Windows",
      footerBrand: "Huddle · Chat, voz e tela para Windows",
      footerSys: "Compatível com Windows 10 e 11 (64 bits)"
    },
    en: {
      docTitle: "Huddle: Chat, voice and screen share for Windows",
      docDesc: "High-performance chat, voice, and screen sharing app for Windows to game with friends, with zero ads or third-party servers.",
      navFeatures: "Features",
      navInstall: "How to install",
      navPowerShell: "PowerShell",
      navDownload: "Download .exe",
      heroStatus: "Léo is speaking in voice channel",
      heroH1: "Crystal-clear voice, chat & screenshare.",
      heroLead: "Connect with friends in high-performance calls, stream your gameplay with audio, and chat with zero ads or laggy third-party servers.",
      heroBtn: "Download for Windows",
      heroMeta: "<strong>Windows 10 and 11 (64-bit)</strong> · Lightweight installer (~120 MB)",
      featuresH2: "Built for gaming and talking with friends",
      featuresDesc: "Fast text channels, crisp voice, and smooth game streaming hosted on your own community server.",
      f1Title: "Crystal-clear voice, no echo",
      f1Tag: "Audio",
      f1Desc: "Native noise suppression, individual volume control for every person in the call, and a single-key mute shortcut.",
      f2Title: "Multi-screen streaming with sound",
      f2Tag: "Streaming",
      f2Desc: "Multiple friends can stream their gameplay simultaneously with in-game audio, with zero microphone loopback.",
      f3Title: "Rich chat inside voice calls",
      f3Tag: "Messaging",
      f3Desc: "Replies, emoji reactions, message editing, @mentions, and inline video and audio playback directly in chat.",
      f4Title: "Custom profiles & community",
      f4Tag: "Customization",
      f4Desc: "Animated GIF avatars and banners, custom server role colors, and real-time online status indicators.",
      f5Title: "Automatic & seamless updates",
      f5Tag: "Simplicity",
      f5Desc: "The app notifies you when new releases arrive and updates with a single click, keeping all your accounts safe.",
      demoTitle: "Quick voice controls",
      demoMute: "Mute: <span class=\"key-cap\">F8</span>",
      installH2: "Simple installation on Windows",
      installDesc: "Three quick steps to join your friends. No complex configurations or bloatware.",
      step1Title: "1. Download the file",
      step1Desc: "Click <strong>Download for Windows</strong> to get the official <strong>Instalar-Huddle.exe</strong>.",
      step2Title: "2. Choose destination",
      step2Desc: "Open the installer, select where to install via <strong>Browse...</strong> (or keep default) and check shortcuts.",
      step3Title: "3. Click Install",
      step3Desc: "The installer fetches the app, verifies files safely, and launches Huddle ready to sign in.",
      smartH3: "If Windows prompts \"Windows protected your PC\"",
      smartP1: "This Windows SmartScreen message is common for new independent software without expensive Microsoft enterprise certificates. The file is 100% safe.",
      smartP2: "To proceed: click <strong>More info</strong> and then <strong>Run anyway</strong>.",
      opt1Summary: "Already have Huddle installed?",
      opt1P1: "Simply launch the installer and click <strong>Update</strong>: it detects the existing folder and updates only modified files, preserving all settings.",
      opt1P2: "To uninstall later: open <strong>Settings &gt; Apps &gt; Installed apps &gt; Huddle</strong>.",
      opt2Summary: "Prefer installing via PowerShell?",
      opt2P: "Copy and run the command below in your PowerShell terminal:",
      copyBtn: "Copy",
      copiedBtn: "Copied!",
      ctaH2: "Ready to talk and game?",
      ctaP: "Download Huddle for Windows and join the voice channel today.",
      ctaBtn: "Download for Windows",
      footerBrand: "Huddle · Chat, voice & screen sharing for Windows",
      footerSys: "Compatible with Windows 10 and 11 (64-bit)"
    }
  };

  // State
  var currentLang = localStorage.getItem("huddle_lang") || (navigator.language && navigator.language.startsWith("en") ? "en" : "pt");
  var savedTheme = localStorage.getItem("huddle_theme");
  var currentTheme = savedTheme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

  // Apply Theme
  function applyTheme(theme, animate) {
    if (animate) {
      document.documentElement.classList.add("theme-transition");
      setTimeout(function() {
        document.documentElement.classList.remove("theme-transition");
      }, 400);
    }
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("huddle_theme", theme);
    var toggleBtn = document.getElementById("theme-toggle");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-label", theme === "dark" ? "Mudar para modo claro" : "Switch to dark mode");
    }
  }

  // Apply Language
  function applyLang(lang) {
    currentLang = lang;
    localStorage.setItem("huddle_lang", lang);
    document.documentElement.lang = lang === "en" ? "en" : "pt-BR";

    var dict = i18n[lang] || i18n.pt;
    document.title = dict.docTitle;
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", dict.docDesc);

    // Update all elements with data-i18n
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute("data-i18n");
      if (dict[key]) {
        els[i].innerHTML = dict[key];
      }
    }

    // Update Lang Buttons
    var ptBtn = document.getElementById("lang-pt");
    var enBtn = document.getElementById("lang-en");
    if (ptBtn && enBtn) {
      if (lang === "pt") {
        ptBtn.classList.add("active");
        ptBtn.setAttribute("aria-pressed", "true");
        enBtn.classList.remove("active");
        enBtn.setAttribute("aria-pressed", "false");
      } else {
        enBtn.classList.add("active");
        enBtn.setAttribute("aria-pressed", "true");
        ptBtn.classList.remove("active");
        ptBtn.setAttribute("aria-pressed", "false");
      }
    }
  }

  // ==========================================================================
  // GSAP & SCROLLTRIGGER ORCHESTRATION
  // ==========================================================================
  function initScrollAnimations() {
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
      return;
    }

    var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    gsap.registerPlugin(ScrollTrigger);

    // 1. Hero 3D Parallax Tilt on Scroll
    var heroScreen = document.querySelector(".hero-screen-card");
    if (heroScreen) {
      gsap.to(heroScreen, {
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: 1.2
        },
        rotateX: 10,
        scale: 0.95,
        y: 40,
        ease: "none"
      });

      // Interactive Gyro Tilt on Mouse Move over Hero Screen
      var wrapper = document.querySelector(".app-screen-wrapper");
      if (wrapper) {
        wrapper.addEventListener("mousemove", function(e) {
          var rect = wrapper.getBoundingClientRect();
          var x = (e.clientX - rect.left) / rect.width - 0.5;
          var y = (e.clientY - rect.top) / rect.height - 0.5;
          gsap.to(heroScreen, {
            rotateY: x * 8,
            rotateX: -y * 8,
            duration: 0.3,
            ease: "power1.out"
          });
        });
        wrapper.addEventListener("mouseleave", function() {
          gsap.to(heroScreen, {
            rotateY: 0,
            rotateX: 0,
            duration: 0.6,
            ease: "power2.out"
          });
        });
      }
    }

    // 2. Section Headers Reveal
    var headers = document.querySelectorAll(".gsap-trigger-header");
    headers.forEach(function(header) {
      gsap.from(header, {
        scrollTrigger: {
          trigger: header,
          start: "top 85%",
          toggleActions: "play none none none"
        },
        y: 20,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out"
      });
    });

    // 3. Feature Cards Batch Entrance
    ScrollTrigger.batch(".gsap-feature-card", {
      start: "top 85%",
      onEnter: function(batch) {
        gsap.from(batch, {
          y: 24,
          opacity: 0,
          stagger: 0.1,
          duration: 0.55,
          ease: "power2.out"
        });
      },
      once: true
    });

    // 4. Interactive Side Card Entrance
    var interactiveSide = document.querySelector(".gsap-interactive-card");
    if (interactiveSide) {
      gsap.from(interactiveSide, {
        scrollTrigger: {
          trigger: interactiveSide,
          start: "top 85%",
          toggleActions: "play none none none"
        },
        x: 28,
        opacity: 0,
        duration: 0.65,
        ease: "power2.out"
      });
    }

    // 5. Installation Step Cards Batch Entrance
    ScrollTrigger.batch(".gsap-step-card", {
      start: "top 85%",
      onEnter: function(batch) {
        gsap.from(batch, {
          y: 24,
          opacity: 0,
          stagger: 0.1,
          duration: 0.55,
          ease: "power2.out"
        });
      },
      once: true
    });

    // 6. Installer Box & Side Cards
    var installBox = document.querySelector(".gsap-install-box");
    if (installBox) {
      gsap.from(installBox, {
        scrollTrigger: {
          trigger: installBox,
          start: "top 85%",
          toggleActions: "play none none none"
        },
        x: -24,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out"
      });
    }

    var smartscreen = document.querySelector(".gsap-smartscreen");
    if (smartscreen) {
      gsap.from(smartscreen, {
        scrollTrigger: {
          trigger: smartscreen,
          start: "top 85%",
          toggleActions: "play none none none"
        },
        x: 24,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out"
      });
    }

    // 7. Final CTA Scale & Pulse
    var finalCta = document.querySelector(".gsap-final-cta");
    if (finalCta) {
      gsap.from(finalCta, {
        scrollTrigger: {
          trigger: finalCta,
          start: "top 88%",
          toggleActions: "play none none none"
        },
        scale: 0.96,
        opacity: 0,
        duration: 0.7,
        ease: "power2.out"
      });
    }
  }

  // ==========================================================================
  // INTERACTIVE VOLUME SLIDER DEMO
  // ==========================================================================
  function initLiveVolumeDemo() {
    var volRows = document.querySelectorAll(".live-demo-vol-row");
    volRows.forEach(function(row) {
      var barWrap = row.querySelector(".vol-slider-wrap");
      var bar = row.querySelector(".vol-bar");
      var fill = row.querySelector(".vol-fill");
      var valText = row.querySelector(".vol-val");
      if (!bar || !fill || !valText) return;

      function updateVol(clientX) {
        var rect = bar.getBoundingClientRect();
        var pct = Math.max(0, Math.min(100, Math.round(((clientX - rect.left) / rect.width) * 100)));
        fill.style.width = pct + "%";
        valText.textContent = pct + "%";
        if (barWrap) barWrap.setAttribute("aria-label", "Volume: " + pct + "%");
      }

      var isDragging = false;
      bar.style.cursor = "pointer";
      bar.addEventListener("mousedown", function(e) {
        isDragging = true;
        updateVol(e.clientX);
      });
      window.addEventListener("mousemove", function(e) {
        if (isDragging) updateVol(e.clientX);
      });
      window.addEventListener("mouseup", function() {
        isDragging = false;
      });

      // Touch support
      bar.addEventListener("touchstart", function(e) {
        if (e.touches.length > 0) updateVol(e.touches[0].clientX);
      }, { passive: true });
      bar.addEventListener("touchmove", function(e) {
        if (e.touches.length > 0) updateVol(e.touches[0].clientX);
      }, { passive: true });
    });
  }

  // ==========================================================================
  // COPY POWERSHELL COMMAND
  // ==========================================================================
  function initCopyButton() {
    var copyBtn = document.getElementById("copy-btn");
    var copyLabel = document.getElementById("copy-label");
    var psCmd = document.getElementById("ps-cmd");

    if (copyBtn && copyLabel && psCmd) {
      copyBtn.addEventListener("click", function() {
        var text = psCmd.textContent || psCmd.innerText;
        navigator.clipboard.writeText(text).then(function() {
          var dict = i18n[currentLang] || i18n.pt;
          copyLabel.textContent = dict.copiedBtn || "Copiado!";
          copyBtn.classList.add("copied");

          setTimeout(function() {
            copyLabel.textContent = dict.copyBtn || "Copiar";
            copyBtn.classList.remove("copied");
          }, 2000);
        }).catch(function() {
          var range = document.createRange();
          range.selectNode(psCmd);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
      });
    }
  }

  // ==========================================================================
  // BOOTSTRAP
  // ==========================================================================
  document.addEventListener("DOMContentLoaded", function() {
    // 1. Initial State
    applyTheme(currentTheme, false);
    applyLang(currentLang);

    // 2. Language Switcher Click Handlers
    var ptBtn = document.getElementById("lang-pt");
    var enBtn = document.getElementById("lang-en");
    if (ptBtn) {
      ptBtn.addEventListener("click", function() {
        applyLang("pt");
      });
    }
    if (enBtn) {
      enBtn.addEventListener("click", function() {
        applyLang("en");
      });
    }

    // 3. Theme Toggle Click Handler
    var themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", function() {
        var current = document.documentElement.getAttribute("data-theme") || "dark";
        var next = current === "dark" ? "light" : "dark";
        applyTheme(next, true);
      });
    }

    // 4. Interactive Components
    initLiveVolumeDemo();
    initCopyButton();

    // 5. ScrollTrigger & GSAP
    initScrollAnimations();
  });
})();
