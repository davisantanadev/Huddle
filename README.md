# Huddle: site de download

Página estática (HTML, CSS e JS puros, sem build) que apresenta o app Huddle e
baixa o instalador. Publica como está na Vercel.

- `index.html`: o conteúdo (português; o inglês fica em `js/main.js`)
- `css/style.css`: azul e preto, grade de sinal, molduras com cantos de HUD
- `js/bg.js`: o fundo (pontos que acendem perto do cursor)
- `js/main.js`: idiomas PT/EN, mixer de volume, comando do PowerShell e as cenas
  de scroll (GSAP + ScrollTrigger + Lenis, carregados por CDN)
- `img/`: capturas reais do app

O botão baixa https://129-159-51-96.sslip.io/download/Instalar-Huddle.exe e a
versão mostrada vem de https://129-159-51-96.sslip.io/download/version.json,
os dois no servidor do app, então a página não precisa mudar a cada versão nova.

Com "reduzir movimento" ligado (ou sem JavaScript) a página não usa rolagem
suave nem a cena fixa: tudo aparece empilhado e legível.
