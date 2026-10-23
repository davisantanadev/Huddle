# Eco — cliente de chat e voz (Discord REA)

Aplicativo desktop de chat, voz e compartilhamento de tela inspirado no Discord, feito em **Electron** com backend próprio em **SQLite**. Projeto pessoal, sem vínculo com a Discord Inc.

![Configurações de perfil](docs/screenshots/11-settings-profile.png)

## Funcionalidades

- Servidores com canais de texto e voz, cargos com hierarquia, convites com link próprio, nome, ícone e banner editáveis
- Mensagens diretas, pedidos de amizade por `@username`, chamadas de voz na DM (toca, atende, recusa)
- Compartilhamento de tela, indicador de quem está falando, escolha de microfone e fone
- Sons de entrar, sair, chamando e notificação
- Perfil com foto e banner (inclusive GIF), editor de enquadramento e biblioteca de GIFs (Giphy)
- Conta com verificação de e-mail por código (Supabase + Brevo, grátis), troca de senha e sessões seguras
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

## 4. Configuração

O app funciona sem nenhuma chave extra. A verificação de e-mail já vem ligada a um projeto Supabase (ver 4.2); a biblioteca de GIFs precisa de uma chave grátis do Giphy.

### 4.1. Chave do Giphy (arquivo local)

Chaves secretas ficam num arquivo `app.config.local.json` que **nunca** vai para o GitHub nem para dentro do `.exe`. O app procura esse arquivo em dois lugares:

| Onde | Quando usar |
| --- | --- |
| `%APPDATA%\Eco\app.config.local.json` | App instalado (`.exe`) — e também funciona com `npm start` |
| `app.config.local.json` na pasta do projeto | Desenvolvimento (`npm start` / `npm test`) |

```powershell
Copy-Item app.config.local.example.json "$env:APPDATA\Eco\app.config.local.json"
notepad "$env:APPDATA\Eco\app.config.local.json"
```

```json
{ "giphyApiKey": "SUA_CHAVE_DO_GIPHY" }
```

Chave grátis em [developers.giphy.com](https://developers.giphy.com/) → *Create an App* → *API*. Sem ela, a biblioteca mostra GIFs gerados localmente.

### 4.2. Verificação de e-mail (Supabase + Brevo, grátis)

O código de 6 dígitos é gerado, enviado e conferido pela função **`email-otp`** do Supabase (`supabase/functions/email-otp`), que envia pelo **Brevo** (300 e-mails/dia grátis). O app só chama a função; o código fica guardado no Supabase como hash (tabela `email_otps`, migração em `supabase/migrations`).

No `app.config.json` ficam apenas a URL do projeto e a **chave publicável** (`sb_publishable_...`) — pública por natureza, então o app já sai configurado para todo mundo. A chave do Brevo fica só nos segredos da função.

```json
"supabase": {
  "url": "https://SEU-PROJETO.supabase.co",
  "publishableKey": "sb_publishable_..."
}
```

Sem `supabase` configurado, o app entra em *modo desenvolvimento*: o código aparece na própria tela.

#### Passo 1 — Conta no Brevo

1. Crie uma conta grátis em [brevo.com](https://www.brevo.com/) e complete o perfil.
2. Em **Senders, Domains & Dedicated IPs → Senders → Add a sender**, cadastre o remetente (ex.: nome `Eco`, seu e-mail) e confirme pelo link que o Brevo envia.
3. Em **SMTP & API → API Keys → Generate a new API key**, crie uma chave (começa com `xkeysib-`) e copie.

#### Passo 2 — Segredos da função no Supabase

Em *Supabase → Edge Functions → Secrets* (ou *Project Settings → Edge Functions*), adicione:

| Nome | Valor |
| --- | --- |
| `BREVO_API_KEY` | a chave `xkeysib-...` |
| `BREVO_SENDER_EMAIL` | o e-mail confirmado como remetente no Brevo |
| `BREVO_SENDER_NAME` | `Eco` (opcional) |

Pronto: em *Configurações → Minha Conta → Verificar*, o código chega por e-mail. Limites da função: 1 código por minuto e 5 por hora para cada e-mail, até 250 por dia no total.

#### Publicar a função num projeto novo

Com a [Supabase CLI](https://supabase.com/docs/guides/cli):

```powershell
supabase link --project-ref SEU-PROJETO
supabase db push
supabase functions deploy email-otp --no-verify-jwt
```

Para exigir e-mail verificado para usar o app, ponha `"requireVerifiedEmail": true` no `app.config.json`.

### 4.3. Configurações gerais — `app.config.json`

| Campo | O que faz |
| --- | --- |
| `appName` | Nome mostrado nos convites e e-mails |
| `publicUrl` | Endereço público (ex.: `https://eco.seudominio.com`). Vazio = `http://127.0.0.1:<porta>`, que só funciona neste PC |
| `invitePath` | Caminho dos links de convite (padrão `/convite`) |
| `requireVerifiedEmail` | `true` = só entra no app quem confirmou o e-mail |
| `supabase.url` / `supabase.publishableKey` | Projeto Supabase cuja função `email-otp` envia os códigos |

## 5. Gerar o executável (.exe)

```powershell
npm run build:exe
```

Isso cria:

- `dist\Discord-win32-x64\Discord.exe` — o app completo empacotado
- Um atalho na sua **Área de Trabalho** com o nome do `appName` do `app.config.json` (padrão `Eco`) que abre o app acima (use `$env:DESKTOP_DIR="C:\outra\pasta"` para mudar o local)

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
  accountDelivery.js   Códigos de verificação por e-mail (função email-otp do Supabase)
  gifLibrary.js        Busca de GIFs no Giphy
src/
  index.html, app.js   Interface
  state/store.js       Estado do app e chamadas ao backend
  services/            Áudio, dispositivos, compartilhamento de tela
  styles/              Temas e estilos
assets/                Ícone, sons, fontes e tela de carregamento
scripts/               Build do .exe e testes automatizados
supabase/              Função email-otp e migração do banco (Supabase)
docs/                  Relatório técnico e capturas de tela
```

## 9. Problemas comuns

| Sintoma | Solução |
| --- | --- |
| `EBUSY: resource busy or locked` no build | Feche o app (inclusive pelo ícone na bandeja) e rode de novo |
| GIFs não carregam do Giphy | Confira a `giphyApiKey` no `app.config.local.json` |
| Link de convite não abre em outro PC | Defina `publicUrl` com o endereço onde o app está hospedado |
| Não recebo o código por e-mail | Confira a pasta de spam e os segredos `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` da função (4.2) |
| "O envio de e-mail ainda não foi configurado no servidor" | Faltam os segredos da função `email-otp` no Supabase (4.2, passo 2) |
| Esqueci a senha da conta inicial | Feche o app e apague `%APPDATA%\Eco` para recriar a conta padrão (apaga todos os dados) |
