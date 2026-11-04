// Grade de sinal: pontos azuis que acendem perto do cursor, mais duas linhas de
// varredura que descem devagar. Só decoração: 2D, ~1.000 pontos, pausa com a
// aba escondida e fica estática com "reduzir movimento".
(function () {
  var canvas = document.getElementById("bg");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var STEP = 36;
  var RADIUS = 220;
  var dpr = 1, w = 0, h = 0, cols = 0, rows = 0;
  var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
  var running = false, raf = 0, last = 0, sy = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / STEP) + 1;
    rows = Math.ceil(h / STEP) + 1;
    draw(0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    mouse.x += (mouse.tx - mouse.x) * 0.14;
    mouse.y += (mouse.ty - mouse.y) * 0.14;
    // The grid drifts a little with the scroll, like a surface under the page
    var offY = -((sy * 0.18) % STEP);
    for (var i = 0; i < cols; i++) {
      for (var j = -1; j < rows; j++) {
        var x = i * STEP + STEP / 2;
        var y = j * STEP + STEP / 2 + offY;
        var dx = x - mouse.x, dy = y - mouse.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var near = d < RADIUS ? 1 - d / RADIUS : 0;
        var a = 0.1 + near * near * 0.9;
        var r = 1 + near * 1.7;
        ctx.fillStyle = near > 0.02 ? "rgba(91,157,255," + a.toFixed(3) + ")" : "rgba(91,157,255,0.1)";
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }
    if (!reduced) {
      for (var k = 0; k < 2; k++) {
        var ly = ((t * 0.00004 + k * 0.5) % 1) * (h + 160) - 80;
        var g = ctx.createLinearGradient(0, ly - 60, 0, ly + 60);
        g.addColorStop(0, "rgba(47,107,255,0)");
        g.addColorStop(0.5, "rgba(47,107,255,0.07)");
        g.addColorStop(1, "rgba(47,107,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, ly - 60, w, 120);
      }
    }
  }

  function loop(t) {
    if (!running) return;
    // 40 fps is plenty for a backdrop
    if (t - last > 24) {
      last = t;
      draw(t);
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  window.addEventListener("resize", resize);
  window.addEventListener(
    "pointermove",
    function (e) {
      mouse.tx = e.clientX;
      mouse.ty = e.clientY;
      if (mouse.x < -9000) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
      }
    },
    { passive: true }
  );
  window.addEventListener(
    "scroll",
    function () {
      sy = window.scrollY || 0;
      if (reduced) draw(0);
    },
    { passive: true }
  );
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  resize();
  start();
})();
