# Publicar uma versão do Huddle

Desde a 1.2.15 toda versão é **assinada**. O app, o instalador (`Instalar-Huddle.exe`)
e o comando do PowerShell só instalam um pacote cuja assinatura bate com a chave
pública embutida neles (`electron/updateSignature.js`). Quem invadir o servidor
não consegue mandar uma "atualização" falsa para ninguém.

## A chave de assinatura

- Privada: `C:\Users\davis\.huddle-signing\release-key.pem` (só o seu usuário do
  Windows lê). **Faça uma cópia num lugar seguro e offline** (pen drive guardado,
  gerenciador de senhas). Ela nunca vai para o servidor nem para o GitHub.
- Pública: dentro do app (`electron/updateSignature.js`), do instalador
  (`installer/Instalador.cs`) e do `scripts/install.ps1`.
- Se perder a privada, as versões instaladas não aceitam mais atualizações
  automáticas: seria preciso gerar outra chave e cada pessoa reinstalar uma vez.
- Para trocar de chave sem esse problema: acrescente a nova pública na lista
  `PUBLIC_KEYS` numa versão (assinada ainda com a antiga) e passe a assinar com a
  nova a partir da seguinte.

## Passo a passo

1. Suba a versão em `package.json` (e no `package-lock.json`).
2. Gere o app: `NO_SHORTCUT=1 npm run build:exe`
3. Rode os testes: `npm test` e `npm run test:security`
4. Monte e assine: `npm run release -- --notes "O que mudou"`
   (cria em `dist/release`: `Eco.zip`, `Eco.zip.sha256`, `version.json`,
   `manifest.json` e `manifest.sig`)
5. Se o instalador mudou: `npm run build:installer` (gera `dist/Instalar-Huddle.exe`)
6. Envie para o servidor, com o `version.json` por último (assim ninguém vê a
   versão nova antes do pacote estar lá):

```bash
cd dist/release
ssh -i ~/.ssh/eco-server.key ubuntu@129.159.51.96 'mkdir -p /tmp/rel'
scp -i ~/.ssh/eco-server.key Eco.zip Eco.zip.sha256 manifest.json manifest.sig version.json ubuntu@129.159.51.96:/tmp/rel/
ssh -i ~/.ssh/eco-server.key ubuntu@129.159.51.96 'set -e; D=/var/www/eco-download; S=/tmp/rel
  cd $S && sha256sum -c Eco.zip.sha256
  sudo cp -p $D/Eco.zip $D/Eco-anterior.zip
  sudo install -m 644 $S/Eco.zip $D/Eco.zip.new && sudo mv -f $D/Eco.zip.new $D/Eco.zip
  for f in Eco.zip.sha256 manifest.json manifest.sig version.json; do sudo install -m 644 $S/$f $D/$f; done
  rm -rf $S'
```

7. Confira: `curl -s https://129-159-51-96.sslip.io/download/version.json` e
   `curl -s https://129-159-51-96.sslip.io/download/manifest.json`.

## Backend (servidor)

Arquivos em `/opt/eco` (dono root), dados em `/var/lib/eco` (usuário `eco`),
serviço `eco`. Para atualizar: backup do banco com o serviço parado, trocar os
arquivos de `electron/` que mudaram, `sudo systemctl restart eco`, conferir
`journalctl -u eco`.

Interruptores (variáveis de ambiente no `eco.service`):

- `ALLOW_LEGACY_EVENT_TOKEN=0`: recusa o token de sessão na URL de eventos
  (apps 1.2.14 ou anteriores deixam de receber eventos ao vivo). Ligue quando
  todo mundo estiver na 1.2.15 ou mais nova.
- `ALLOW_UNSIGNED_UPLOADS=1`: volta a servir anexos sem link assinado (só para
  emergência).
