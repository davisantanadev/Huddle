# Segurança do Huddle

Resumo do que protege o app, o servidor e o site, e do que ainda depende de você.
Atualizado na versão 1.2.15.

## Atualizações assinadas
- Cada versão publica `manifest.json` (versão, tamanho, SHA-256) e `manifest.sig`
  (ECDSA P-256). A chave privada fica só no seu PC (`docs/PUBLICAR.md`).
- O app (`electron/main.js` + `electron/updateSignature.js`), o instalador
  (`installer/Instalador.cs`) e o `scripts/install.ps1` recusam pacote sem
  assinatura válida, com tamanho ou hash diferente, ou com versão igual/mais antiga.
- O script que troca os arquivos confere o hash de novo logo antes de instalar.
- Limite honesto: quem baixa o **instalador** ou roda o comando do PowerShell pela
  primeira vez confia no que o servidor entrega naquele momento. Um certificado de
  assinatura de código do Windows (pago) fecharia esse ponto e o aviso do SmartScreen.

## App (Electron 45)
- Electron 45.2.2 (Chrome 156), versão com suporte.
- Páginas em sandbox, `contextIsolation`, sem `nodeIntegration`, sem `<webview>`,
  DevTools só fora do app instalado (`HUDDLE_DEVTOOLS=1` libera).
- CSP nas páginas: só scripts do próprio app (nada inline ou remoto);
  `wasm-unsafe-eval` só para o filtro de ruído.
- Todo canal IPC só responde às páginas do próprio app (`isTrustedIpcSender`).
- A página só altera 5 configurações, cada uma com tipo validado.
- Permissões (microfone, câmera, tela, notificações) só para as páginas do app;
  navegação para fora e janelas novas bloqueadas; links externos só `http(s)`.
- Links `eco://` só no formato `eco://convite/<código>`.
- Notificações do Windows com o nome e o ícone do Huddle (atalho com o ID do app e
  registro em `HKCU\Software\Classes\AppUserModelId`); versões de desenvolvimento e
  os testes não mostram notificações.
- Login salvo em `%APPDATA%\Eco\auth-store.json` em texto simples (decisão
  anterior: a criptografia do Windows corrompia o login quando o app era fechado à
  força). Proteja a conta do Windows.

## Servidor (backend)
- Senhas com scrypt e sal; contas novas e trocas de senha exigem 8+ caracteres
  com letras e números e recusam senhas comuns.
- Toda ação é feita como o dono da sessão; limite de login e de criação de contas;
  limite por pessoa em todas as ações (mensagens, uploads, servidores, convites).
- Pedidos maiores que 2 MB só para upload.
- Canal de eventos com bilhete de uso único (1 minuto) preso à sessão; o token
  de sessão não vai mais na URL (apps antigos ainda aceitos: `ALLOW_LEGACY_EVENT_TOKEN`).
- Anexos de conversa (`file_*`, `attachment_*`) só com link assinado que vence em
  24-48 h; avatares, banners e sons continuam públicos.
- Cabeçalhos `nosniff`, `no-referrer`, `DENY` em tudo; CSP sem scripts na página de convite.
- Testes: `npm run test:security` (24 verificações tentando burlar cada proteção).

## Máquina do servidor
`ops/endurecer-servidor.sh`: pacotes atualizados, fail2ban no SSH, root sem SSH,
rpcbind desligado, backup diário do banco (14 dias, só root lê), cabeçalhos extras
no Caddy. Já existiam: firewall que recusa tudo fora 22/80/443/voz, SSH só por
chave, app só em 127.0.0.1 atrás do Caddy com HTTPS e HSTS, coturn autenticado e
recusando redes internas.

`ops/apagar-conta-de-teste.sh`: remove a conta de teste criada por engano.

## Site (huddle-call.vercel.app)
`vercel.json` com CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`; scripts de CDN com SRI (integridade conferida).

## O que depende de você
1. Guardar uma cópia da chave privada de assinatura em lugar seguro e offline.
2. Trocar a senha do banco do Supabase que foi colada numa conversa.
3. GitHub: verificação em duas etapas, proteção do branch `main`, "secret
   scanning" e "push protection" nos dois repositórios.
4. Pôr uma senha (passphrase) na chave SSH do servidor (`~/.ssh/eco-server.key`).
5. Quando todos estiverem na 1.2.15+, ligar `ALLOW_LEGACY_EVENT_TOKEN=0` no servidor.
6. (Opcional) Certificado de assinatura de código do Windows.

## Limites que continuam
- Mensagens ficam no banco do servidor sem criptografia de ponta a ponta: quem
  administra o servidor consegue lê-las.
- A voz é P2P: quem está na call vê o IP de quem fala com ele.
- Dependências de build com alertas moderados do `npm audit` (minimatch, usado só
  ao empacotar; nada disso vai para o app).
