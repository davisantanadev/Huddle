# Eco — cliente de chat e voz (Discord REA)

Aplicativo desktop de chat, voz e compartilhamento de tela inspirado no Discord, feito em **Electron** com backend próprio em **SQLite**. Projeto pessoal, sem vínculo com a Discord Inc.

![Configurações de perfil](docs/screenshots/11-settings-profile.png)

## Funcionalidades

- Servidores com canais de texto e voz, cargos com hierarquia, convites com link próprio, nome, ícone e banner editáveis
- Mensagens diretas, pedidos de amizade por `@username`, chamadas de voz na DM (toca, atende, recusa)
- Compartilhamento de tela, indicador de quem está falando, escolha de microfone e fone
- Sons de entrar, sair, chamando e notificação
- Perfil com foto e banner (inclusive GIF), editor de enquadramento e biblioteca de GIFs (Giphy)
- Conta com verificação de e-mail e telefone por código, troca de senha e sessões seguras
- Confirmação antes de qualquer exclusão e 10 temas visuais

---

## 1. Requisitos

| Item | Versão |
| --- | --- |
| Windows | 10 ou 11 (x64) |
| [Node.js](https://nodejs.org/) | 18 ou mais recente (inclui o `npm`) |
| [Git](https://git-scm.com/) | qualquer versão recente |

> O Electron é baixado automaticamente pelo `npm install`; não é preciso instalá-lo à parte.

## 2. Instalação

Abra o **PowerShell** (ou o Terminal) e rode:

```powershell
git clone https://github.com/davisantanadev/discord-rea.git
cd discord-rea
npm install
```

O `npm install` baixa cerca de 300 MB (Electron incluso) e pode levar alguns minutos.

## 3. Abrir o app

```powershell
npm start
```

A tela de carregamento aparece e em seguida a janela principal. Para pular a tela de carregamento:

```powershell
npx electron . --skip-splash
```

### Primeiro acesso

Na primeira execução o app cria uma conta de administrador e um servidor de exemplo:

| E-mail | Senha |
| --- | --- |
| `davis@discord.local` | `password123` |

Entre com ela **e troque a senha** em *Configurações → Minha Conta → Senha*. Você também pode criar novas contas pela opção **Cadastrar** na tela de login.

## 4. Configuração (opcional)

O app funciona sem nenhuma chave. As integrações abaixo ficam desligadas até serem configuradas.

### 4.1. Arquivo de chaves local

Copie o modelo e preencha só o que for usar:

```powershell
Copy-Item app.config.local.example.json app.config.local.json
```

```json
{
  "giphyApiKey": "SUA_CHAVE_DO_GIPHY",
  "email": { "resendApiKey": "re_...", "from": "Eco <no-reply@seudominio.com>" },
  "sms": { "twilioAccountSid": "AC...", "twilioAuthToken": "...", "from": "+15550000000" }
}
```

O `app.config.local.json` está no `.gitignore`: **suas chaves nunca vão para o GitHub**. Todas também podem ser passadas por variáveis de ambiente, que têm prioridade:

| Recurso | Variáveis de ambiente | Onde conseguir |
| --- | --- | --- |
| Biblioteca de GIFs | `GIPHY_API_KEY` | [developers.giphy.com](https://developers.giphy.com/) → *Create an App* → *API* (grátis) |
| Envio de e-mail | `RESEND_API_KEY`, `MAIL_FROM` | [resend.com](https://resend.com/) (plano grátis) |
| Envio de SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | [twilio.com](https://www.twilio.com/) |
| Endereço público | `APP_PUBLIC_URL` | o domínio onde o app estiver hospedado |
| Exigir e-mail verificado | `REQUIRE_VERIFIED_EMAIL=1` | — |

**Sem chave do Giphy**, a biblioteca de GIFs mostra GIFs gerados localmente.
**Sem provedor de e-mail ou SMS**, o app entra em *modo desenvolvimento*: o código de verificação aparece na própria tela, com um aviso, em vez de ser enviado.

### 4.2. Configurações gerais — `app.config.json`

| Campo | O que faz |
| --- | --- |
| `appName` | Nome mostrado nos convites e e-mails |
| `publicUrl` | Endereço público (ex.: `https://eco.seudominio.com`). Vazio = `http://127.0.0.1:<porta>`, que só funciona neste PC |
| `invitePath` | Caminho dos links de convite (padrão `/convite`) |
| `requireVerifiedEmail` | `true` = só entra no app quem confirmou o e-mail |

## 5. Gerar o executável (.exe)

```powershell
npm run build:exe
```

Isso cria:

- `dist\Discord-win32-x64\Discord.exe` — o app completo empacotado
- `Discord.exe` na sua **Área de Trabalho** — atalho que abre o app acima (use `$env:DESKTOP_DIR="C:\outra\pasta"` para mudar o local)

> Feche o app antes de rodar o build, senão a pasta `dist` fica travada (erro `EBUSY`).

## 6. Testes automatizados

```powershell
npm test
```

Roda 25 suítes de ponta a ponta dentro do Electron (login, servidores, chamadas, sons, convites, conta etc.) usando um banco temporário — seus dados não são tocados. O resultado fica em `docs/verification-results.json`.

## 7. Onde ficam os dados

Banco de dados, uploads e configurações locais ficam em:

```
%APPDATA%\Eco
```

Para começar do zero, feche o app e apague essa pasta.

## 8. Estrutura do projeto

```text
electron/
  main.js              Processo principal (janelas, bandeja, IPC)
  backendServer.js     Backend HTTP + SQLite + eventos em tempo real
  appConfig.js         Leitura do app.config.json / app.config.local.json / variáveis
  accountDelivery.js   Envio de códigos por e-mail (Resend) e SMS (Twilio)
  gifLibrary.js        Busca de GIFs no Giphy
src/
  index.html, app.js   Interface
  state/store.js       Estado do app e chamadas ao backend
  services/            Áudio, dispositivos, compartilhamento de tela
  styles/              Temas e estilos
assets/                Ícone, sons, fontes e tela de carregamento
scripts/               Build do .exe e testes automatizados
docs/                  Relatório técnico e capturas de tela
```

## 9. Problemas comuns

| Sintoma | Solução |
| --- | --- |
| `EBUSY: resource busy or locked` no build | Feche o app (inclusive pelo ícone na bandeja) e rode de novo |
| GIFs não carregam do Giphy | Confira a `giphyApiKey` no `app.config.local.json` |
| Link de convite não abre em outro PC | Defina `publicUrl` com o endereço onde o app está hospedado |
| Não recebo o código por e-mail/SMS | Sem provedor configurado o código aparece na tela (modo desenvolvimento) |
| Esqueci a senha da conta inicial | Feche o app e apague `%APPDATA%\Eco` para recriar a conta padrão (apaga todos os dados) |
