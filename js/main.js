(function() {
  // Translations Dictionary
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
      step1Title: "Baixe o arquivo",
      step1Desc: "Clique em <strong>Baixar para Windows</strong> para receber o <strong>Instalar-Huddle.exe</strong> oficial.",
      step2Title: "Escolha a pasta",
      step2Desc: "Abra o instalador, escolha onde salvar pelo botão <strong>Procurar...</strong> (ou mantenha a pasta sugerida) e marque seus atalhos.",
      step3Title: "Clique em Instalar",
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
      step1Title: "Download the file",
      step1Desc: "Click <strong>Download for Windows</strong> to get the official <strong>Instalar-Huddle.exe</strong>.",
      step2Title: "Choose destination",
      step2Desc: "Open the installer, select where to install via <strong>Browse...</strong> (or keep default) and check shortcuts.",
      step3Title: "Click Install",
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

    // Update copy button label if not in copied state
    var copyLabel = document.getElementById("copy-label");
    if (copyLabel && copyLabel.textContent !== dict.copiedBtn) {
      copyLabel.textContent = dict.copyBtn;
    }
  }

  // Initialize
  applyTheme(currentTheme, false);
  document.addEventListener("DOMContentLoaded", function() {
    applyLang(currentLang);

    // Theme toggle click
    var themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", function() {
        var nextTheme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        applyTheme(nextTheme, true);
      });
    }

    // Language buttons click
    var ptBtn = document.getElementById("lang-pt");
    var enBtn = document.getElementById("lang-en");
    if (ptBtn) {
      ptBtn.addEventListener("click", function() { applyLang("pt"); });
    }
    if (enBtn) {
      enBtn.addEventListener("click", function() { applyLang("en"); });
    }

    // PowerShell copy button
    var copyBtn = document.getElementById("copy-btn");
    var copyLabel = document.getElementById("copy-label");
    var psCmd = document.getElementById("ps-cmd");

    if (copyBtn && copyLabel && psCmd) {
      copyBtn.addEventListener("click", function() {
        var text = psCmd.textContent.trim();
        var dict = i18n[currentLang] || i18n.pt;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(showCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }

        function showCopied() {
          copyLabel.textContent = dict.copiedBtn;
          copyBtn.style.background = "var(--voice-green)";
          copyBtn.style.color = "#ffffff";
          setTimeout(function() {
            copyLabel.textContent = dict.copyBtn;
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
  });
})();
