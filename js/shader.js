// Dark Tech Minimalist Interactive WebGL Shader
// High performance, zero external dependencies, mouse magnetic distortion & reactive glow
(function() {
  var canvas = document.getElementById('shader-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    canvas.style.display = 'none';
    return;
  }

  // Check prefers-reduced-motion
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    canvas.style.display = 'none';
    return;
  }

  var vsSource = `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  var fsSource = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform float u_time;
    uniform float u_dark; // 1.0 = dark mode, 0.0 = light mode

    // 2D Simplex-like noise helper
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m;
      m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 st = gl_FragCoord.xy / u_resolution.xy;
      vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);
      vec2 mouse = (u_mouse - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

      // Distance from pixel to smoothed mouse
      float distToMouse = length(uv - mouse);
      
      // Magnetic interactive warp around the mouse
      float warpStrength = 0.035 / (distToMouse + 0.22);
      vec2 warpDir = normalize(uv - mouse + 0.0001);
      vec2 warpedUv = uv + warpDir * warpStrength * exp(-distToMouse * 2.8);

      // Slow ambient time drift
      float t = u_time * 0.12;

      // Dark Tech Grid Coordinates
      vec2 gridUv = warpedUv * 16.0;
      vec2 gridId = floor(gridUv);
      vec2 gridFract = fract(gridUv) - 0.5;

      // Hairline grid pattern
      float lineX = smoothstep(0.48, 0.50, abs(gridFract.x));
      float lineY = smoothstep(0.48, 0.50, abs(gridFract.y));
      float gridLines = max(lineX, lineY);

      // Subtle intersection dots
      float dotDist = length(gridFract);
      float dots = smoothstep(0.12, 0.03, dotDist);

      // Dynamic flow wave using simplex noise
      float noiseVal = snoise(warpedUv * 2.2 + vec2(t * 0.4, t * 0.25));
      float wave = sin(warpedUv.y * 8.0 + noiseVal * 2.5 + t * 2.0);

      // Mouse reactive energy aura
      float mouseGlow = exp(-distToMouse * 2.6);
      float mouseCore = exp(-distToMouse * 6.5);

      // Color Palette Definition
      // Dark mode: Deep obsidian ground (#05070c) with cyan/violet cybernetic telemetry and coral accent
      vec3 darkBase = vec3(0.02, 0.028, 0.045);
      vec3 darkGrid = vec3(0.06, 0.09, 0.15);
      vec3 cyanAccent = vec3(0.0, 0.85, 0.95);
      vec3 coralAccent = vec3(1.0, 0.38, 0.22);
      vec3 violetAmbient = vec3(0.38, 0.22, 0.85);

      // Light mode: Clean tech gray-white ground with subtle crisp grid and soft tint
      vec3 lightBase = vec3(0.95, 0.96, 0.98);
      vec3 lightGrid = vec3(0.82, 0.86, 0.92);

      vec3 col;
      if (u_dark > 0.5) {
        // Compose Dark Mode
        col = darkBase;
        // Subtle grid lines with distance fade
        col += darkGrid * gridLines * 0.45;
        // Intersection dots
        col += cyanAccent * dots * 0.25;
        // Flowing cyber wave
        col += violetAmbient * max(0.0, wave * 0.04) * (1.0 - distToMouse * 0.5);
        // Mouse glow aura (cyan to coral gradient)
        vec3 mouseColor = mix(cyanAccent, coralAccent, sin(u_time * 0.8) * 0.5 + 0.5);
        col += mouseColor * mouseGlow * 0.28;
        col += vec3(1.0, 0.9, 0.8) * mouseCore * 0.18;
      } else {
        // Compose Light Mode
        col = lightBase;
        col -= (1.0 - lightGrid) * gridLines * 0.35;
        col += cyanAccent * dots * 0.12;
        col += mix(cyanAccent, coralAccent, 0.3) * mouseGlow * 0.12;
      }

      // Smooth vignette towards the bottom and screen edges
      float vignette = smoothstep(1.3, 0.35, length(st - 0.5));
      float bottomFade = smoothstep(1.0, 0.35, st.y);
      col = mix(u_dark > 0.5 ? darkBase : lightBase, col, vignette * bottomFade);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Shader compile failed: ' + gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  var vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  var fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;

  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Program link error: ' + gl.getProgramInfoLog(program));
    return;
  }

  var posLoc = gl.getAttribLocation(program, 'position');
  var resLoc = gl.getUniformLocation(program, 'u_resolution');
  var mouseLoc = gl.getUniformLocation(program, 'u_mouse');
  var timeLoc = gl.getUniformLocation(program, 'u_time');
  var darkLoc = gl.getUniformLocation(program, 'u_dark');

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1
  ]), gl.STATIC_DRAW);

  // Mouse physics with inertia (lerp)
  var currentMouse = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
  var targetMouse = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
  var hasMoved = false;

  window.addEventListener('mousemove', function(e) {
    targetMouse.x = e.clientX;
    targetMouse.y = window.innerHeight - e.clientY;
    hasMoved = true;
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (e.touches.length > 0) {
      targetMouse.x = e.touches[0].clientX;
      targetMouse.y = window.innerHeight - e.touches[0].clientY;
      hasMoved = true;
    }
  }, { passive: true });

  // Handle Resize
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = 0, height = 0;

  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (width !== w || height !== h) {
      width = w;
      height = h;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // Animation Loop with Performance Throttling
  var startTime = performance.now();
  var animFrameId = null;
  var isVisible = true;

  // Pause when tab hidden
  document.addEventListener('visibilitychange', function() {
    isVisible = !document.hidden;
    if (isVisible && !animFrameId) {
      render();
    }
  });

  function render() {
    if (!isVisible) {
      animFrameId = null;
      return;
    }

    var now = performance.now();
    var time = (now - startTime) * 0.001;

    // Subtle automatic figure-8 idle animation if mouse hasn't moved
    if (!hasMoved) {
      targetMouse.x = (window.innerWidth * 0.5) + Math.cos(time * 0.8) * (window.innerWidth * 0.22);
      targetMouse.y = (window.innerHeight * 0.5) + Math.sin(time * 1.6) * (window.innerHeight * 0.15);
    }

    // Lerp mouse coordinates for fluid inertia
    currentMouse.x += (targetMouse.x - currentMouse.x) * 0.06;
    currentMouse.y += (targetMouse.y - currentMouse.y) * 0.06;

    // Check dark mode
    var isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.uniform2f(mouseLoc, currentMouse.x * dpr, currentMouse.y * dpr);
    gl.uniform1f(timeLoc, time);
    gl.uniform1f(darkLoc, isDark ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    animFrameId = requestAnimationFrame(render);
  }

  render();
})();
