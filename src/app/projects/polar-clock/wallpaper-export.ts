// Polar Clock Wallpaper Export
// Generates standalone HTML wallpapers for Wallpaper Engine and Lively Wallpaper

export interface WallpaperSettings {
  palette: string;
  background: string;
  bgOpacity: number;
  smooth: boolean;
  alignment: string;
  rings: {
    seconds: boolean;
    minutes: boolean;
    hours: boolean;
    days: boolean;
    months: boolean;
    dayOfYear: boolean;
    weekOfYear: boolean;
  };
  showCity: boolean;
  showDate: boolean;
  timezone: string;
  cityLabel: string;
}

export function generateWallpaperHTML(settings: WallpaperSettings): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Polar Clock</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; background: #05070e; color: #e9eefc; font-family: system-ui, -apple-system, sans-serif; }
  #bg-layer { position: absolute; inset: 0; z-index: 0; }
  #bg-layer canvas { position: absolute; inset: 0; }
  #clock-layer { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; }
  #clock-layer.align-left { justify-content: flex-start; padding-left: 3vw; }
  #clock-layer.align-center { justify-content: center; }
  #clock-layer.align-right { justify-content: flex-end; padding-right: 3vw; }
</style>
</head>
<body>
<div id="bg-layer"></div>
<div id="clock-layer" class="align-${settings.alignment}">
  <svg id="clock-svg"></svg>
</div>

<script>
// ── Settings ──
var S = {
  palette: ${JSON.stringify(settings.palette)},
  background: ${JSON.stringify(settings.background)},
  bgOpacity: ${settings.bgOpacity},
  smooth: ${settings.smooth},
  alignment: ${JSON.stringify(settings.alignment)},
  ringSeconds: ${settings.rings.seconds},
  ringMinutes: ${settings.rings.minutes},
  ringHours: ${settings.rings.hours},
  ringDays: ${settings.rings.days},
  ringMonths: ${settings.rings.months},
  ringDayOfYear: ${settings.rings.dayOfYear},
  ringWeekOfYear: ${settings.rings.weekOfYear},
  showCity: ${settings.showCity},
  showDate: ${settings.showDate},
  timezone: ${JSON.stringify(settings.timezone)},
  cityLabel: ${JSON.stringify(settings.cityLabel)}
};

// ── Palettes ──
var PALETTES = {
  default: ['hsl(225,70%,60%)', 'hsl(172,66%,45%)', 'hsl(350,80%,62%)', 'hsl(45,93%,55%)', 'hsl(280,65%,62%)', 'hsl(160,60%,45%)', 'hsl(30,80%,55%)'],
  sunset: ['hsl(350,85%,60%)', 'hsl(25,90%,55%)', 'hsl(45,95%,55%)', 'hsl(15,80%,50%)', 'hsl(330,70%,55%)', 'hsl(0,75%,60%)', 'hsl(40,85%,50%)'],
  ocean: ['hsl(200,80%,50%)', 'hsl(180,70%,45%)', 'hsl(220,75%,55%)', 'hsl(190,65%,50%)', 'hsl(240,60%,60%)', 'hsl(170,60%,45%)', 'hsl(210,70%,50%)'],
  neon: ['hsl(280,100%,65%)', 'hsl(160,100%,50%)', 'hsl(320,100%,60%)', 'hsl(190,100%,50%)', 'hsl(60,100%,55%)', 'hsl(130,100%,50%)', 'hsl(300,100%,60%)'],
  mono: ['hsl(220,15%,55%)', 'hsl(220,15%,45%)', 'hsl(220,15%,65%)', 'hsl(220,15%,40%)', 'hsl(220,15%,60%)', 'hsl(220,15%,50%)', 'hsl(220,15%,70%)'],
  aurora: ['hsl(150,70%,45%)', 'hsl(170,60%,50%)', 'hsl(130,65%,40%)', 'hsl(270,50%,55%)', 'hsl(190,55%,45%)', 'hsl(290,45%,50%)', 'hsl(160,60%,48%)'],
  cyberpunk: ['hsl(325,100%,55%)', 'hsl(195,100%,50%)', 'hsl(55,100%,50%)', 'hsl(280,100%,60%)', 'hsl(170,100%,45%)', 'hsl(340,95%,50%)', 'hsl(210,100%,55%)'],
  earth: ['hsl(15,60%,45%)', 'hsl(140,35%,35%)', 'hsl(35,50%,40%)', 'hsl(25,70%,50%)', 'hsl(160,30%,40%)', 'hsl(45,55%,45%)', 'hsl(10,45%,38%)']
};

// ── SVG helpers ──
var svgNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  var el = document.createElementNS(svgNS, tag);
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// ── Clock renderer ──
function renderClock() {
  var svg = document.getElementById('clock-svg');
  var size = Math.min(window.innerWidth - 40, window.innerHeight - 40);
  size = Math.max(200, size);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
  svg.innerHTML = '';

  var colors = PALETTES[S.palette] || PALETTES.default;
  var now = new Date();

  // Time calc
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: S.timezone, hour: 'numeric', minute: 'numeric', second: 'numeric',
    day: 'numeric', month: 'numeric', year: 'numeric', hour12: false
  });
  var parts = fmt.formatToParts(now);
  function get(type) {
    var p = parts.find(function(x) { return x.type === type; });
    return p ? parseInt(p.value) : 0;
  }

  var ms = now.getMilliseconds();
  var seconds = get('second') + (S.smooth ? ms / 1000 : 0);
  var minutes = get('minute') + (S.smooth ? seconds / 60 : 0);
  var hours = get('hour') + (S.smooth ? minutes / 60 : 0);
  var day = get('day');
  var month = get('month');
  var year = get('year');
  var daysInMonth = new Date(year, month, 0).getDate();

  var tzDate = new Date(now.toLocaleString('en-US', { timeZone: S.timezone }));
  var jan1 = new Date(tzDate.getFullYear(), 0, 1);
  var dayOfYear = Math.floor((tzDate.getTime() - jan1.getTime()) / 86400000) + 1;
  var isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  var daysInYear = isLeap ? 366 : 365;
  var weekOfYear = Math.ceil(((tzDate.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);

  // Build active rings
  var activeRings = [];
  var ci = 0;
  if (S.ringWeekOfYear) activeRings.push({ label: 'Week', value: 'W' + weekOfYear, pct: (weekOfYear / 52) * 100, color: colors[ci++ % colors.length] });
  if (S.ringDayOfYear) activeRings.push({ label: 'Year Day', value: dayOfYear + '/' + daysInYear, pct: (dayOfYear / daysInYear) * 100, color: colors[ci++ % colors.length] });
  if (S.ringMonths) activeRings.push({ label: 'Month', value: month + '/12', pct: (month / 12) * 100, color: colors[ci++ % colors.length] });
  if (S.ringDays) activeRings.push({ label: 'Day', value: day + '/' + daysInMonth, pct: (day / daysInMonth) * 100, color: colors[ci++ % colors.length] });
  if (S.ringHours) activeRings.push({ label: 'Hour', value: '' + Math.floor(hours), pct: (hours / 24) * 100, color: colors[ci++ % colors.length] });
  if (S.ringMinutes) activeRings.push({ label: 'Min', value: '' + Math.floor(minutes), pct: (minutes / 60) * 100, color: colors[ci++ % colors.length] });
  if (S.ringSeconds) activeRings.push({ label: 'Sec', value: '' + Math.floor(seconds), pct: (seconds / 60) * 100, color: colors[ci++ % colors.length] });

  // Geometry and palette kept in step with _components/PolarClockSVG.tsx so
  // an exported wallpaper is the same instrument you were just looking at.
  var cx = size / 2, cy = size / 2;
  var ringCount = activeRings.length || 1;
  var ringThickness = Math.min((size / 2 - 30) / (ringCount + 1.5), size / 17);
  var maxR = size / 2 - ringThickness / 2 - 14;
  var ringGap = Math.max(2, size / 120);
  var bezelR = maxR + ringThickness / 2 + 8;
  var bgRingColor = 'rgba(120,150,210,0.13)';
  var textColor = '#e9eefc';
  var mutedColor = '#8e9cbd';
  var voidColor = '#05070e';
  var bezelColor = 'rgba(85,97,138,0.55)';

  // Graduated bezel
  svg.appendChild(svgEl('circle', {
    cx: cx, cy: cy, r: bezelR, fill: 'none', stroke: bezelColor,
    'stroke-width': 1, opacity: '0.5'
  }));
  for (var g = 0; g < 60; g++) {
    var major = g % 5 === 0;
    var ga = (g / 60) * Math.PI * 2 - Math.PI / 2;
    var glen = major ? 7 : 3.5;
    svg.appendChild(svgEl('line', {
      x1: cx + Math.cos(ga) * bezelR, y1: cy + Math.sin(ga) * bezelR,
      x2: cx + Math.cos(ga) * (bezelR + glen), y2: cy + Math.sin(ga) * (bezelR + glen),
      stroke: major ? 'rgba(207,224,255,0.42)' : bezelColor,
      'stroke-width': major ? 1.4 : 0.8
    }));
  }

  // Draw rings
  for (var i = 0; i < activeRings.length; i++) {
    var ring = activeRings[i];
    var r = maxR - i * (ringThickness + ringGap);
    var circ = 2 * Math.PI * r;
    var dashLen = circ * (ring.pct / 100);

    // Recessed track
    svg.appendChild(svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: 'none', stroke: bgRingColor,
      'stroke-width': ringThickness
    }));
    svg.appendChild(svgEl('circle', {
      cx: cx, cy: cy, r: r + ringThickness / 2, fill: 'none',
      stroke: 'rgba(140,170,230,0.10)', 'stroke-width': 0.75
    }));

    // Progress arc
    var arc = svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: 'none', stroke: ring.color,
      'stroke-width': ringThickness, 'stroke-linecap': 'round',
      'stroke-dasharray': dashLen + ' ' + (circ - dashLen),
      transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
      opacity: '0.88'
    });
    if (S.smooth) arc.style.transition = 'opacity 0.15s';
    else arc.style.transition = 'stroke-dasharray 0.3s ease, opacity 0.15s';
    svg.appendChild(arc);

    // Leading pip
    var pa = (ring.pct / 100) * Math.PI * 2 - Math.PI / 2;
    svg.appendChild(svgEl('circle', {
      cx: cx + Math.cos(pa) * r, cy: cy + Math.sin(pa) * r,
      r: Math.max(1.6, ringThickness * 0.13), fill: '#ffffff', opacity: '0.7'
    }));
  }

  // Center text
  var cityFontSize = Math.max(11, size / 26);
  var timeFontSize = Math.max(20, size / 12);
  var dateFontSize = Math.max(10, size / 30);

  var digitalTime = now.toLocaleTimeString('en-US', { timeZone: S.timezone, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var digitalDate = now.toLocaleDateString('en-US', { timeZone: S.timezone, weekday: 'long', month: 'long', day: 'numeric' });

  if (S.showCity) {
    var cityText = svgEl('text', {
      x: cx, y: cy - timeFontSize * 0.9,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': cityFontSize, fill: mutedColor,
      'font-family': "system-ui, -apple-system, sans-serif",
      'letter-spacing': '0.28em', 'font-weight': '600',
      stroke: voidColor, 'stroke-width': cityFontSize * 0.22,
      'stroke-opacity': '0.6', 'paint-order': 'stroke'
    });
    cityText.textContent = S.cityLabel.toUpperCase();
    svg.appendChild(cityText);
  }

  var timeText = svgEl('text', {
    x: cx, y: cy + (S.showCity ? 2 : -timeFontSize * 0.2),
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': timeFontSize, 'font-weight': '600', fill: textColor,
    'font-family': "'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace",
    stroke: voidColor, 'stroke-width': timeFontSize * 0.13,
    'stroke-opacity': '0.6', 'paint-order': 'stroke'
  });
  timeText.textContent = digitalTime;
  svg.appendChild(timeText);

  if (S.showDate) {
    var dateText = svgEl('text', {
      x: cx, y: cy + timeFontSize * 0.92 - (S.showCity ? 0 : timeFontSize * 0.2),
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': dateFontSize, fill: mutedColor, 'letter-spacing': '0.06em',
      stroke: voidColor, 'stroke-width': dateFontSize * 0.24,
      'stroke-opacity': '0.6', 'paint-order': 'stroke'
    });
    dateText.textContent = digitalDate;
    svg.appendChild(dateText);
  }
}

// ── Background renderers ──
var bgCanvas, bgCtx, bgGL, bgRAF;

function stopBackground() {
  if (bgRAF) cancelAnimationFrame(bgRAF);
  var layer = document.getElementById('bg-layer');
  layer.innerHTML = '';
  layer.style.opacity = S.bgOpacity;
  bgCanvas = null; bgCtx = null; bgGL = null;
}

function createCanvas() {
  var c = document.createElement('canvas');
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  c.style.width = '100%';
  c.style.height = '100%';
  document.getElementById('bg-layer').appendChild(c);
  bgCanvas = c;
  return c;
}

function startBackground() {
  stopBackground();
  var bg = S.background;
  if (bg === 'none') return;

  var w = window.innerWidth, h = window.innerHeight;

  if (bg === 'gol') startGOL(w, h);
  else if (bg === 'julia') startJulia(w, h);
  else if (bg === 'mandelbrot') startMandelbrot(w, h);
  else if (bg === 'burningship') startBurningShip(w, h);
  else if (bg === 'newton') startNewton(w, h);
  else if (bg === 'attractor') startAttractor(w, h);
  else if (bg === 'koch') startKoch(w, h);
  else if (bg === 'starfield') startStarfield(w, h);
  else if (bg === 'particles') startParticles(w, h);
  else if (bg === 'matrix') startMatrix(w, h);
  else if (bg === 'voronoi') startVoronoi(w, h);
  else if (bg === 'ripples') startRipples(w, h);
  else if (bg === 'lissajous') startLissajous(w, h);
  else if (bg === 'sinewaves') startSineWaves(w, h);
  else if (bg === 'apollonian') startApollonian(w, h);
}

// ── Game of Life ──
function startGOL(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var cs = 8, cols = Math.ceil(w / cs), rows = Math.ceil(h / cs);
  var cur = new Uint8Array(rows * cols), nxt = new Uint8Array(rows * cols);
  for (var i = 0; i < cur.length; i++) cur[i] = Math.random() > 0.7 ? 1 : 0;
  var lastStep = 0;
  function draw(t) {
    if (t - lastStep > 150) {
      lastStep = t;
      for (var r = 0; r < rows; r++) for (var cc = 0; cc < cols; cc++) {
        var n = 0;
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          var nr = r + dr, nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) n += cur[nr * cols + nc];
        }
        var idx = r * cols + cc;
        nxt[idx] = cur[idx] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
      var tmp = cur; cur = nxt; nxt = tmp;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(100,140,200,0.12)';
      for (var r = 0; r < rows; r++) for (var cc = 0; cc < cols; cc++) {
        if (cur[r * cols + cc]) ctx.fillRect(cc * cs, r * cs, cs - 1, cs - 1);
      }
    }
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── WebGL Fractal shared ──
// Kept in step with _components/Fractal.tsx: same smooth-iteration shading,
// same cosine palettes, same premultiplied blend — so an exported wallpaper
// looks like the page it was exported from.
var VERT_SRC = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';
var FRAC_COMMON = 'precision highp float; uniform vec2 u_resolution; uniform float u_time;' +
  'const float TAU = 6.28318530718;' +
  'vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(TAU * (c * t + d)); }' +
  'vec2 plane(vec2 ctr, float span) { float s = span / min(u_resolution.x, u_resolution.y); vec2 p = (gl_FragCoord.xy - u_resolution * 0.5) * s; return vec2(ctr.x + p.x, ctr.y - p.y); }';

var FRAC_SHADE = 'vec4 shade(float sn, float maxI, vec3 a, vec3 b, vec3 c, vec3 d, float gain) {' +
  'if (sn < 0.0) return vec4(0.0); float v = pow(clamp(sn / maxI, 0.0, 1.0), 0.55);' +
  'vec3 col = pal(v, a, b, c, d); float al = clamp((0.18 + 0.72 * v) * gain, 0.0, 1.0); return vec4(col * al, al); }';

var JULIA_FRAG = FRAC_COMMON + FRAC_SHADE +
  'void main() { vec2 z = plane(vec2(0.0), 3.0);' +
  'vec2 c = vec2(-0.7 + 0.15 * cos(u_time), 0.27015 + 0.1 * sin(u_time * 0.7)); float sn = -1.0;' +
  'for (int i = 0; i < 96; i++) { z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);' +
  'if (dot(z,z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z))/log(2.0)); break; } }' +
  'gl_FragColor = shade(sn, 96.0, vec3(0.34,0.38,0.50), vec3(0.38,0.36,0.44), vec3(1.0,1.0,1.0), vec3(0.06,0.32,0.58), 1.0); }';

var MANDEL_FRAG = FRAC_COMMON + FRAC_SHADE +
  'void main() { float cycle = mod(u_time * 1.85, 60.0); float zoom = 1.0 + cycle * cycle * 0.2;' +
  'float fade = smoothstep(0.0, 4.0, cycle) * smoothstep(0.0, 4.0, 60.0 - cycle);' +
  'vec2 c = plane(vec2(-0.7436, 0.1318), 3.0 / zoom); vec2 z = vec2(0.0); float sn = -1.0;' +
  'for (int i = 0; i < 140; i++) { z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);' +
  'if (dot(z,z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z))/log(2.0)); break; } }' +
  'gl_FragColor = shade(sn, 140.0, vec3(0.30,0.34,0.44), vec3(0.44,0.40,0.32), vec3(1.0,0.94,0.72), vec3(0.0,0.18,0.48), fade); }';

var BURNSHIP_FRAG = FRAC_COMMON + FRAC_SHADE +
  'void main() { float cycle = mod(u_time * 1.85, 60.0); float zoom = 1.0 + cycle * cycle * 0.004;' +
  'float fade = smoothstep(0.0, 4.0, cycle) * smoothstep(0.0, 4.0, 60.0 - cycle);' +
  'vec2 c = plane(mix(vec2(-0.5, -0.5), vec2(-1.755, -0.035), smoothstep(0.0, 45.0, cycle)), 3.4 / zoom);' +
  'vec2 z = vec2(0.0); float sn = -1.0;' +
  'for (int i = 0; i < 150; i++) { vec2 a = abs(z); z = vec2(a.x*a.x - a.y*a.y + c.x, 2.0*a.x*a.y + c.y);' +
  'if (dot(z,z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z))/log(2.0)); break; } }' +
  'if (sn < 0.0) { gl_FragColor = vec4(0.0); } else {' +
  'float v = clamp(log(1.0 + sn) / log(49.0), 0.0, 1.0);' +
  'vec3 col = pal(v, vec3(0.36,0.16,0.08), vec3(0.52,0.36,0.20), vec3(1.0,0.92,0.72), vec3(0.02,0.13,0.26));' +
  'float al = clamp(0.20 + 0.78 * v, 0.0, 1.0) * fade; gl_FragColor = vec4(col * al, al); } }';

var NEWTON_FRAG = FRAC_COMMON +
  'vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }' +
  'vec2 cdiv(vec2 a, vec2 b) { float d = max(dot(b,b), 1e-9); return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y) / d; }' +
  'void main() { float th = u_time * 0.28; float breathe = 2.6 + 0.55 * sin(u_time * 0.19);' +
  'vec2 p = plane(vec2(0.0), breathe); vec2 z = vec2(p.x*cos(th) - p.y*sin(th), p.x*sin(th) + p.y*cos(th));' +
  'float steps = 0.0; for (int i = 0; i < 44; i++) { vec2 z2 = cmul(z,z); vec2 z3 = cmul(z2,z);' +
  'vec2 dz = cdiv(z3 - vec2(1.0,0.0), 3.0 * z2); z -= dz; steps += 1.0; if (dot(dz,dz) < 1e-7) break; }' +
  'float d0 = distance(z, vec2(1.0,0.0)); float d1 = distance(z, vec2(-0.5,0.86602540)); float d2 = distance(z, vec2(-0.5,-0.86602540));' +
  'float root = d0 < d1 ? (d0 < d2 ? 0.0 : 2.0) : (d1 < d2 ? 1.0 : 2.0);' +
  'float speed = 1.0 - clamp(steps / 26.0, 0.0, 1.0);' +
  'vec3 col = pal(root / 3.0 + 0.02 * steps, vec3(0.48,0.46,0.52), vec3(0.42,0.40,0.44), vec3(1.0,1.0,1.0), vec3(0.0,0.33,0.67));' +
  'float al = 0.16 + 0.62 * pow(speed, 1.4); gl_FragColor = vec4(col * al, al); }';

function initWebGLFractal(fragSrc) {
  var c = createCanvas();
  var gl = c.getContext('webgl');
  if (!gl) return;
  bgGL = gl;
  function compile(src, type) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, compile(VERT_SRC, gl.VERTEX_SHADER));
  gl.attachShader(prog, compile(fragSrc, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog); gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, c.width, c.height);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  var uRes = gl.getUniformLocation(prog, 'u_resolution');
  var uTime = gl.getUniformLocation(prog, 'u_time');
  var t = 0;
  function render() {
    t += 0.003;
    gl.uniform2f(uRes, c.width, c.height);
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    bgRAF = requestAnimationFrame(render);
  }
  bgRAF = requestAnimationFrame(render);
}
function startJulia(w, h) { initWebGLFractal(JULIA_FRAG); }
function startMandelbrot(w, h) { initWebGLFractal(MANDEL_FRAG); }
function startBurningShip(w, h) { initWebGLFractal(BURNSHIP_FRAG); }
function startNewton(w, h) { initWebGLFractal(NEWTON_FRAG); }

// ── Clifford Attractor ──
// Long-exposure density field: the orbit is one continuous trajectory and
// each frame decays what came before, so the picture re-develops as the
// four parameters drift.
function startAttractor(w, h) {
  var c = createCanvas();
  var q = w * h > 1400000 ? 3 : 2;
  var rw = Math.max(2, Math.ceil(w / q)), rh = Math.max(2, Math.ceil(h / q));
  c.width = rw; c.height = rh;
  var ctx = c.getContext('2d');
  var img = ctx.createImageData(rw, rh);
  var px = img.data;
  var dens = new Float32Array(rw * rh);
  var stops = [[0,26,30,72],[0.32,40,110,150],[0.62,87,207,182],[0.85,214,226,190],[1,255,244,224]];
  var ramp = new Uint8Array(1024);
  for (var i = 0; i < 256; i++) {
    var tt = i / 255, s = 0;
    while (s < stops.length - 2 && tt > stops[s + 1][0]) s++;
    var a = stops[s], b = stops[s + 1];
    var f = Math.min(1, Math.max(0, (tt - a[0]) / (b[0] - a[0])));
    ramp[i * 4] = a[1] + (b[1] - a[1]) * f;
    ramp[i * 4 + 1] = a[2] + (b[2] - a[2]) * f;
    ramp[i * 4 + 2] = a[3] + (b[3] - a[3]) * f;
    ramp[i * 4 + 3] = Math.min(255, Math.round(Math.pow(tt, 0.7) * 235));
  }
  var scale = Math.min(rw / 6.0, rh / 5.0), cx = rw / 2, cy = rh / 2;
  var x = 0.1, y = 0.1, t = 0;
  function draw() {
    t += 0.0016;
    var pa = 1.7 + 0.55 * Math.sin(t * 0.73), pb = -1.8 + 0.5 * Math.cos(t * 0.51);
    var pc = 1.4 + 0.5 * Math.sin(t * 0.31 + 1.7), pd = 1.5 + 0.45 * Math.cos(t * 0.41 + 0.6);
    for (var i = 0; i < dens.length; i++) dens[i] *= 0.955;
    for (var n = 0; n < 16000; n++) {
      var nx = Math.sin(pa * y) + pc * Math.cos(pa * x);
      y = Math.sin(pb * x) + pd * Math.cos(pb * y);
      x = nx;
      var ix = (cx + x * scale) | 0, iy = (cy + y * scale) | 0;
      if (ix >= 0 && ix < rw && iy >= 0 && iy < rh) dens[iy * rw + ix] += 1;
    }
    for (var i2 = 0, p = 0; i2 < dens.length; i2++, p += 4) {
      var v = dens[i2];
      var o = (v <= 0 ? 0 : Math.min(255, (Math.log(1 + v * 2.2) * 74) | 0)) * 4;
      px[p] = ramp[o]; px[p + 1] = ramp[o + 1]; px[p + 2] = ramp[o + 2]; px[p + 3] = ramp[o + 3];
    }
    ctx.putImageData(img, 0, 0);
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Koch Snowflake ──
function startKoch(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var depth = 0, growing = true, lastTick = 0;
  function kochPts(p1, p2, d) {
    if (d === 0) return [p1, p2];
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    var a = [p1[0] + dx / 3, p1[1] + dy / 3];
    var b = [p1[0] + 2 * dx / 3, p1[1] + 2 * dy / 3];
    var pk = [(p1[0] + p2[0]) / 2 - dy * Math.sqrt(3) / 6, (p1[1] + p2[1]) / 2 + dx * Math.sqrt(3) / 6];
    return kochPts(p1, a, d - 1).concat(kochPts(a, pk, d - 1), kochPts(pk, b, d - 1), kochPts(b, p2, d - 1));
  }
  function draw(t) {
    if (t - lastTick > 2000) {
      lastTick = t;
      if (growing) { depth++; if (depth >= 6) growing = false; }
      else { depth--; if (depth <= 0) growing = true; }
    }
    ctx.clearRect(0, 0, w, h);
    var r = Math.min(w, h) * 0.45, cx = w / 2, cy = h / 2;
    var verts = [];
    for (var i = 0; i < 3; i++) { var a = i * 2 * Math.PI / 3 - Math.PI / 2; verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    var pts = [];
    for (var i = 0; i < 3; i++) pts = pts.concat(kochPts(verts[i], verts[(i + 1) % 3], depth));
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(100,140,200,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,220,0.15)'; ctx.lineWidth = 1; ctx.stroke();
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Starfield ──
function startStarfield(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var cx = w / 2, cy = h / 2, NUM = 400;
  var stars = [];
  for (var i = 0; i < NUM; i++) stars.push({ angle: Math.random() * Math.PI * 2, dist: Math.random() * 0.01 + 0.001, speed: Math.random() * 0.3 + 0.1, size: Math.random() * 1.5 + 0.5, brightness: Math.random() * 0.5 + 0.3 });
  function draw() {
    ctx.clearRect(0, 0, w, h);
    var maxDim = Math.max(w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.dist += s.speed * 0.002; s.angle += 0.001;
      if (s.dist > 1.5) { s.dist = Math.random() * 0.01 + 0.001; s.angle = Math.random() * Math.PI * 2; }
      var x = cx + Math.cos(s.angle) * s.dist * maxDim;
      var y = cy + Math.sin(s.angle) * s.dist * maxDim;
      var alpha = Math.min(s.dist * 2, 1) * s.brightness * 0.7;
      var sz = s.size * (0.5 + s.dist * 2);
      ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(180,200,240,' + alpha + ')'; ctx.fill();
      if (s.dist > 0.3) {
        var sl = s.speed * s.dist * 15;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(s.angle) * sl, y - Math.sin(s.angle) * sl); ctx.lineTo(x, y);
        ctx.strokeStyle = 'rgba(180,200,240,' + (alpha * 0.4) + ')'; ctx.lineWidth = sz * 0.5; ctx.stroke();
      }
    }
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Particle Flow ──
function startParticles(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var perm = new Uint8Array(512);
  for (var i = 0; i < 256; i++) perm[i] = i;
  for (var i = 255; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
  for (var i = 0; i < 256; i++) perm[256 + i] = perm[i];
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad(hash, x, y) { var h = hash & 3; return ((h & 1) ? -(h < 2 ? x : y) : (h < 2 ? x : y)) + ((h & 2) ? -(h < 2 ? y : x) : (h < 2 ? y : x)); }
  function noise(x, y) {
    var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    var xf = x - Math.floor(x), yf = y - Math.floor(y);
    var u = fade(xf), v = fade(yf);
    return lerp(lerp(grad(perm[perm[xi] + yi], xf, yf), grad(perm[perm[xi + 1] + yi], xf - 1, yf), u),
                lerp(grad(perm[perm[xi] + yi + 1], xf, yf - 1), grad(perm[perm[xi + 1] + yi + 1], xf - 1, yf - 1), u), v);
  }
  var NUM = 600, particles = [];
  for (var i = 0; i < NUM; i++) particles.push({ x: Math.random() * w, y: Math.random() * h, life: Math.random() * 200 + 100, age: 0 });
  var t = 0;
  ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fillRect(0, 0, w, h);
  function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.04)'; ctx.fillRect(0, 0, w, h);
    t += 0.002;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var angle = noise(p.x * 0.003, p.y * 0.003 + t) * Math.PI * 4;
      p.x += Math.cos(angle) * 1.2; p.y += Math.sin(angle) * 1.2; p.age++;
      if (p.age > p.life || p.x < 0 || p.x > w || p.y < 0 || p.y > h) { p.x = Math.random() * w; p.y = Math.random() * h; p.age = 0; p.life = Math.random() * 200 + 100; }
      var alpha = Math.min(p.age / 20, 1, (p.life - p.age) / 20) * 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(140,180,240,' + alpha + ')'; ctx.fill();
    }
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Matrix Rain ──
function startMatrix(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var fs = 14, cols = Math.ceil(w / fs);
  var drops = new Float32Array(cols);
  for (var i = 0; i < cols; i++) drops[i] = Math.random() * -100;
  var chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
  ctx.fillStyle = 'black'; ctx.fillRect(0, 0, w, h);
  var lastTick = 0;
  function draw(t) {
    if (t - lastTick > 50) {
      lastTick = t;
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, w, h);
      ctx.font = fs + 'px monospace'; ctx.fillStyle = 'rgba(80,200,120,0.25)';
      for (var i = 0; i < cols; i++) {
        var ch = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(ch, i * fs, drops[i] * fs);
        if (drops[i] * fs > h && Math.random() > 0.98) drops[i] = 0;
        drops[i] += 0.5 + Math.random() * 0.5;
      }
    }
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Voronoi ──
function startVoronoi(w, h) {
  var c = createCanvas();
  var scale = 3, sw = Math.ceil(w / scale), sh = Math.ceil(h / scale);
  c.width = sw; c.height = sh; c.style.imageRendering = 'auto';
  var ctx = c.getContext('2d');
  var NUM = 20, seeds = [];
  for (var i = 0; i < NUM; i++) seeds.push({ x: Math.random() * sw, y: Math.random() * sh, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, hue: Math.random() * 360 });
  var lastTick = 0;
  function draw(t) {
    if (t - lastTick < 80) { bgRAF = requestAnimationFrame(draw); return; }
    lastTick = t;
    for (var i = 0; i < seeds.length; i++) {
      var s = seeds[i]; s.x += s.vx; s.y += s.vy;
      if (s.x < 0 || s.x > sw) s.vx *= -1; if (s.y < 0 || s.y > sh) s.vy *= -1; s.hue += 0.1;
    }
    var imgData = ctx.createImageData(sw, sh), data = imgData.data;
    for (var py = 0; py < sh; py++) for (var px = 0; px < sw; px++) {
      var minD = 1e9, minD2 = 1e9, closest = 0;
      for (var i = 0; i < NUM; i++) { var dx = px - seeds[i].x, dy = py - seeds[i].y, d = dx * dx + dy * dy; if (d < minD) { minD2 = minD; minD = d; closest = i; } else if (d < minD2) minD2 = d; }
      var edge = Math.sqrt(minD2) - Math.sqrt(minD), idx = (py * sw + px) * 4;
      if (edge < 2) { data[idx] = 150; data[idx + 1] = 170; data[idx + 2] = 200; data[idx + 3] = 40; }
      else {
        var hue = seeds[closest].hue % 360, h60 = hue / 60, x = 1 - Math.abs(h60 % 2 - 1);
        var r = 0, g = 0, b = 0;
        if (h60 < 1) { r = 1; g = x; } else if (h60 < 2) { r = x; g = 1; } else if (h60 < 3) { g = 1; b = x; } else if (h60 < 4) { g = x; b = 1; } else if (h60 < 5) { r = x; b = 1; } else { r = 1; b = x; }
        data[idx] = r * 200; data[idx + 1] = g * 200; data[idx + 2] = b * 200; data[idx + 3] = 12;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Ripples ──
function startRipples(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var cx = w / 2, cy = h / 2, ripples = [], lastSpawn = 0;
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    if (t - lastSpawn > 1800 + Math.random() * 1200) {
      lastSpawn = t;
      ripples.push({ x: cx + (Math.random() - 0.5) * w * 0.6, y: cy + (Math.random() - 0.5) * h * 0.6, birth: t, speed: 0.08 + Math.random() * 0.04 });
    }
    for (var i = ripples.length - 1; i >= 0; i--) {
      var rip = ripples[i], age = (t - rip.birth) * rip.speed, maxAge = Math.max(w, h) * 0.8;
      if (age > maxAge) { ripples.splice(i, 1); continue; }
      for (var r = 0; r < 4; r++) {
        var radius = age - r * 25; if (radius < 0) continue;
        var fadeIn = Math.min(radius / 30, 1), fadeOut = Math.max(0, 1 - age / maxAge);
        var alpha = fadeIn * fadeOut * (1 - r * 0.2) * 0.2;
        ctx.beginPath(); ctx.arc(rip.x, rip.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(120,170,230,' + alpha + ')'; ctx.lineWidth = 1.5 - r * 0.3; ctx.stroke();
      }
    }
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Lissajous ──
function startLissajous(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var cx = w / 2, cy = h / 2, t = 0;
  ctx.fillStyle = 'black'; ctx.fillRect(0, 0, w, h);
  function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.03)'; ctx.fillRect(0, 0, w, h);
    for (var ci = 0; ci < 3; ci++) {
      var freqX = 3 + ci * 2 + Math.sin(t * 0.1 + ci) * 0.5;
      var freqY = 2 + ci * 2 + Math.cos(t * 0.13 + ci) * 0.5;
      var phase = t * 0.3 + ci * Math.PI / 3;
      var radius = Math.min(w, h) * (0.3 + ci * 0.05);
      var hue = (ci * 120 + t * 10) % 360;
      ctx.beginPath(); ctx.strokeStyle = 'hsla(' + hue + ',70%,60%,0.15)'; ctx.lineWidth = 1.5;
      for (var i = 0; i <= 500; i++) {
        var s = (i / 500) * Math.PI * 2;
        var x = cx + Math.sin(freqX * s + phase) * radius;
        var y = cy + Math.sin(freqY * s) * radius * (h / w);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    t += 0.005;
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Sine Waves ──
function startSineWaves(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var numW = 5, waves = [];
  for (var i = 0; i < numW; i++) waves.push({ amplitude: 30 + i * 15, frequency: 0.005 + i * 0.003, speed: 0.02 + i * 0.008, phase: (i * Math.PI * 2) / numW, yOffset: (i + 1) * (h / (numW + 1)), hue: i * 60 });
  var t = 0;
  function draw() {
    ctx.clearRect(0, 0, w, h); t += 0.016;
    for (var wi = 0; wi < waves.length; wi++) {
      var wave = waves[wi];
      ctx.beginPath(); ctx.strokeStyle = 'hsla(' + ((wave.hue + t * 15) % 360) + ',60%,55%,0.12)'; ctx.lineWidth = 2;
      for (var x = 0; x <= w; x += 2) {
        var y = wave.yOffset;
        for (var j = 0; j < waves.length; j++) y += waves[j].amplitude * Math.sin(x * waves[j].frequency + t * waves[j].speed + waves[j].phase);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = 'hsla(' + ((wave.hue + t * 15) % 360) + ',60%,55%,0.02)'; ctx.fill();
    }
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Apollonian Gasket ──
function startApollonian(w, h) {
  var c = createCanvas(); var ctx = c.getContext('2d');
  var cx = w / 2, cy = h / 2;
  var circles = [];
  function descartes(k1, k2, k3) { return k1 + k2 + k3 + 2 * Math.sqrt(k1 * k2 + k2 * k3 + k1 * k3); }
  function apollonian(c1, c2, c3, depth, maxD) {
    if (depth > maxD) return;
    var k1 = 1 / c1.r, k2 = 1 / c2.r, k3 = 1 / c3.r, k4 = descartes(k1, k2, k3);
    if (k4 <= 0 || 1 / k4 < 2) return;
    var r4 = 1 / k4, totalK = k1 + k2 + k3;
    var nc = { x: (c1.x * k1 + c2.x * k2 + c3.x * k3) / totalK, y: (c1.y * k1 + c2.y * k2 + c3.y * k3) / totalK, r: r4, depth: depth };
    circles.push(nc);
    apollonian(c1, c2, nc, depth + 1, maxD); apollonian(c1, c3, nc, depth + 1, maxD); apollonian(c2, c3, nc, depth + 1, maxD);
  }
  var R = Math.min(w, h) * 0.42;
  circles.push({ x: cx, y: cy, r: R, depth: 0 });
  var ir = R / (1 + 2 / Math.sqrt(3)), inners = [];
  for (var i = 0; i < 3; i++) { var a = i * 2 * Math.PI / 3 - Math.PI / 2; inners.push({ x: cx + (R - ir) * Math.cos(a), y: cy + (R - ir) * Math.sin(a), r: ir, depth: 1 }); }
  circles.push.apply(circles, inners);
  apollonian(inners[0], inners[1], inners[2], 2, 6);
  var angle = 0;
  function draw() {
    ctx.clearRect(0, 0, w, h); angle += 0.001;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.translate(-cx, -cy);
    for (var i = 0; i < circles.length; i++) {
      var ci = circles[i], hue = (ci.depth * 45 + angle * 50) % 360;
      var alpha = Math.max(0.04, 0.2 - ci.depth * 0.025);
      ctx.beginPath(); ctx.arc(ci.x, ci.y, Math.max(ci.r, 1), 0, Math.PI * 2);
      ctx.strokeStyle = 'hsla(' + hue + ',50%,60%,' + alpha + ')';
      ctx.lineWidth = Math.max(0.5, 2 - ci.depth * 0.3); ctx.stroke();
    }
    ctx.restore();
    bgRAF = requestAnimationFrame(draw);
  }
  bgRAF = requestAnimationFrame(draw);
}

// ── Wallpaper Engine property listener ──
window.wallpaperPropertyListener = {
  applyUserProperties: function(props) {
    if (props.palette) S.palette = props.palette.value;
    if (props.background) { S.background = props.background.value; startBackground(); }
    if (props.bgopacity) { S.bgOpacity = props.bgopacity.value / 100; document.getElementById('bg-layer').style.opacity = S.bgOpacity; }
    if (props.smooth !== undefined) S.smooth = props.smooth.value;
    if (props.alignment) {
      S.alignment = props.alignment.value;
      var cl = document.getElementById('clock-layer');
      cl.className = 'align-' + S.alignment;
    }
    if (props.ringseconds !== undefined) S.ringSeconds = props.ringseconds.value;
    if (props.ringminutes !== undefined) S.ringMinutes = props.ringminutes.value;
    if (props.ringhours !== undefined) S.ringHours = props.ringhours.value;
    if (props.ringdays !== undefined) S.ringDays = props.ringdays.value;
    if (props.ringmonths !== undefined) S.ringMonths = props.ringmonths.value;
    if (props.ringdayofyear !== undefined) S.ringDayOfYear = props.ringdayofyear.value;
    if (props.ringweekofyear !== undefined) S.ringWeekOfYear = props.ringweekofyear.value;
    if (props.showcity !== undefined) S.showCity = props.showcity.value;
    if (props.showdate !== undefined) S.showDate = props.showdate.value;
    if (props.timezone) S.timezone = props.timezone.value;
    if (props.citylabel) S.cityLabel = props.citylabel.value;
  }
};

// ── Lively Wallpaper property listener ──
function livelyPropertyListener(name, val) {
  if (name === 'palette') S.palette = val;
  else if (name === 'background') { S.background = val; startBackground(); }
  else if (name === 'bgOpacity') { S.bgOpacity = parseFloat(val) / 100; document.getElementById('bg-layer').style.opacity = S.bgOpacity; }
  else if (name === 'smooth') S.smooth = val;
  else if (name === 'alignment') { S.alignment = val; document.getElementById('clock-layer').className = 'align-' + val; }
  else if (name === 'ringSeconds') S.ringSeconds = val;
  else if (name === 'ringMinutes') S.ringMinutes = val;
  else if (name === 'ringHours') S.ringHours = val;
  else if (name === 'ringDays') S.ringDays = val;
  else if (name === 'ringMonths') S.ringMonths = val;
  else if (name === 'ringDayOfYear') S.ringDayOfYear = val;
  else if (name === 'ringWeekOfYear') S.ringWeekOfYear = val;
  else if (name === 'showCity') S.showCity = val;
  else if (name === 'showDate') S.showDate = val;
  else if (name === 'timezone') S.timezone = val;
  else if (name === 'cityLabel') S.cityLabel = val;
}

// ── Init ──
var clockInterval = S.smooth ? 50 : 1000;
setInterval(renderClock, clockInterval);
renderClock();
startBackground();

window.addEventListener('resize', function() {
  renderClock();
  startBackground();
});
</${'script'}>
</body>
</html>`;
}

export function generateWEProjectJson(): string {
  return JSON.stringify({
    description: "Polar Clock - Animated clock wallpaper with concentric time rings",
    file: "index.html",
    general: {
      properties: {
        palette: {
          order: 0,
          text: "Color Palette",
          type: "combo",
          value: "default",
          options: [
            { label: "Indigo Teal", value: "default" },
            { label: "Sunset", value: "sunset" },
            { label: "Ocean", value: "ocean" },
            { label: "Neon", value: "neon" },
            { label: "Monochrome", value: "mono" },
            { label: "Aurora", value: "aurora" },
            { label: "Cyberpunk", value: "cyberpunk" },
            { label: "Earth", value: "earth" },
          ],
        },
        background: {
          order: 1,
          text: "Background Animation",
          type: "combo",
          value: "none",
          options: [
            { label: "None", value: "none" },
            { label: "Game of Life", value: "gol" },
            { label: "Julia Set", value: "julia" },
            { label: "Mandelbrot", value: "mandelbrot" },
            { label: "Koch Snowflake", value: "koch" },
            { label: "Starfield", value: "starfield" },
            { label: "Particle Flow", value: "particles" },
            { label: "Matrix Rain", value: "matrix" },
            { label: "Voronoi Cells", value: "voronoi" },
            { label: "Ripples", value: "ripples" },
            { label: "Lissajous Curves", value: "lissajous" },
            { label: "Sine Waves", value: "sinewaves" },
            { label: "Apollonian Gasket", value: "apollonian" },
          ],
        },
        bgopacity: {
          order: 2,
          text: "Background Opacity",
          type: "slider",
          value: 100,
          min: 0,
          max: 100,
          step: 5,
        },
        smooth: {
          order: 3,
          text: "Smooth Animation",
          type: "bool",
          value: true,
        },
        alignment: {
          order: 4,
          text: "Clock Position",
          type: "combo",
          value: "center",
          options: [
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
            { label: "Right", value: "right" },
          ],
        },
        timezone: {
          order: 5,
          text: "Timezone",
          type: "combo",
          value: "America/New_York",
          options: [
            { label: "New York", value: "America/New_York" },
            { label: "Los Angeles", value: "America/Los_Angeles" },
            { label: "Chicago", value: "America/Chicago" },
            { label: "London", value: "Europe/London" },
            { label: "Paris", value: "Europe/Paris" },
            { label: "Berlin", value: "Europe/Berlin" },
            { label: "Tokyo", value: "Asia/Tokyo" },
            { label: "Sydney", value: "Australia/Sydney" },
            { label: "Dubai", value: "Asia/Dubai" },
            { label: "Mumbai", value: "Asia/Kolkata" },
            { label: "Singapore", value: "Asia/Singapore" },
            { label: "Hong Kong", value: "Asia/Hong_Kong" },
            { label: "Moscow", value: "Europe/Moscow" },
            { label: "Sao Paulo", value: "America/Sao_Paulo" },
            { label: "Auckland", value: "Pacific/Auckland" },
            { label: "Honolulu", value: "Pacific/Honolulu" },
            { label: "Denver", value: "America/Denver" },
            { label: "Kingston", value: "America/Toronto" },
            { label: "Vancouver", value: "America/Vancouver" },
            { label: "Seoul", value: "Asia/Seoul" },
          ],
        },
        citylabel: {
          order: 6,
          text: "City Label",
          type: "textinput",
          value: "New York",
        },
        ringseconds: { order: 10, text: "Show Seconds Ring", type: "bool", value: true },
        ringminutes: { order: 11, text: "Show Minutes Ring", type: "bool", value: true },
        ringhours: { order: 12, text: "Show Hours Ring", type: "bool", value: true },
        ringdays: { order: 13, text: "Show Days Ring", type: "bool", value: true },
        ringmonths: { order: 14, text: "Show Months Ring", type: "bool", value: true },
        ringdayofyear: { order: 15, text: "Show Day of Year Ring", type: "bool", value: false },
        ringweekofyear: { order: 16, text: "Show Week of Year Ring", type: "bool", value: false },
        showcity: { order: 20, text: "Show City Name", type: "bool", value: true },
        showdate: { order: 21, text: "Show Date", type: "bool", value: true },
      },
    },
    title: "Polar Clock",
    type: "web",
    visibility: "private",
  }, null, 2);
}

export function generateLivelyProperties(): string {
  return JSON.stringify([
    { type: "dropdown", label: "Color Palette", name: "palette", value: "default",
      items: ["default", "sunset", "ocean", "neon", "mono", "aurora", "cyberpunk", "earth"] },
    { type: "dropdown", label: "Background Animation", name: "background", value: "none",
      items: ["none", "gol", "julia", "mandelbrot", "koch", "starfield", "particles", "matrix", "voronoi", "ripples", "lissajous", "sinewaves", "apollonian"] },
    { type: "slider", label: "Background Opacity", name: "bgOpacity", value: 100, min: 0, max: 100, step: 5 },
    { type: "checkbox", label: "Smooth Animation", name: "smooth", value: true },
    { type: "dropdown", label: "Clock Position", name: "alignment", value: "center", items: ["left", "center", "right"] },
    { type: "dropdown", label: "Timezone", name: "timezone", value: "America/New_York",
      items: ["America/New_York", "America/Los_Angeles", "America/Chicago", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Europe/Moscow", "America/Sao_Paulo", "Pacific/Auckland", "Pacific/Honolulu", "America/Denver", "America/Toronto", "America/Vancouver", "Asia/Seoul"] },
    { type: "textinput", label: "City Label", name: "cityLabel", value: "New York" },
    { type: "checkbox", label: "Show Seconds Ring", name: "ringSeconds", value: true },
    { type: "checkbox", label: "Show Minutes Ring", name: "ringMinutes", value: true },
    { type: "checkbox", label: "Show Hours Ring", name: "ringHours", value: true },
    { type: "checkbox", label: "Show Days Ring", name: "ringDays", value: true },
    { type: "checkbox", label: "Show Months Ring", name: "ringMonths", value: true },
    { type: "checkbox", label: "Show Day of Year Ring", name: "ringDayOfYear", value: false },
    { type: "checkbox", label: "Show Week of Year Ring", name: "ringWeekOfYear", value: false },
    { type: "checkbox", label: "Show City Name", name: "showCity", value: true },
    { type: "checkbox", label: "Show Date", name: "showDate", value: true },
  ], null, 2);
}

// ── Minimal ZIP generator ──
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeU16(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xFF;
  arr[offset + 1] = (val >> 8) & 0xFF;
}

function writeU32(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xFF;
  arr[offset + 1] = (val >> 8) & 0xFF;
  arr[offset + 2] = (val >> 16) & 0xFF;
  arr[offset + 3] = (val >> 24) & 0xFF;
}

export function downloadZip(filename: string, files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const entries = files.map(f => ({
    name: encoder.encode(f.name),
    data: encoder.encode(f.content),
  }));

  // Calculate total size
  let localSize = 0;
  for (const e of entries) localSize += 30 + e.name.length + e.data.length;
  let centralSize = 0;
  for (const e of entries) centralSize += 46 + e.name.length;
  const endSize = 22;
  const total = localSize + centralSize + endSize;

  const buf = new Uint8Array(total);
  let localOffset = 0;
  const offsets: number[] = [];

  // Local file headers + data
  for (const e of entries) {
    offsets.push(localOffset);
    const crc = crc32(e.data);
    // Local file header signature
    writeU32(buf, localOffset, 0x04034b50); localOffset += 4;
    writeU16(buf, localOffset, 20); localOffset += 2; // version needed
    writeU16(buf, localOffset, 0); localOffset += 2;  // flags
    writeU16(buf, localOffset, 0); localOffset += 2;  // compression (store)
    writeU16(buf, localOffset, 0); localOffset += 2;  // mod time
    writeU16(buf, localOffset, 0); localOffset += 2;  // mod date
    writeU32(buf, localOffset, crc); localOffset += 4;
    writeU32(buf, localOffset, e.data.length); localOffset += 4; // compressed
    writeU32(buf, localOffset, e.data.length); localOffset += 4; // uncompressed
    writeU16(buf, localOffset, e.name.length); localOffset += 2;
    writeU16(buf, localOffset, 0); localOffset += 2; // extra field length
    buf.set(e.name, localOffset); localOffset += e.name.length;
    buf.set(e.data, localOffset); localOffset += e.data.length;
  }

  // Central directory
  const centralStart = localOffset;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crc = crc32(e.data);
    writeU32(buf, localOffset, 0x02014b50); localOffset += 4; // central dir signature
    writeU16(buf, localOffset, 20); localOffset += 2; // version made by
    writeU16(buf, localOffset, 20); localOffset += 2; // version needed
    writeU16(buf, localOffset, 0); localOffset += 2;  // flags
    writeU16(buf, localOffset, 0); localOffset += 2;  // compression
    writeU16(buf, localOffset, 0); localOffset += 2;  // mod time
    writeU16(buf, localOffset, 0); localOffset += 2;  // mod date
    writeU32(buf, localOffset, crc); localOffset += 4;
    writeU32(buf, localOffset, e.data.length); localOffset += 4;
    writeU32(buf, localOffset, e.data.length); localOffset += 4;
    writeU16(buf, localOffset, e.name.length); localOffset += 2;
    writeU16(buf, localOffset, 0); localOffset += 2; // extra field
    writeU16(buf, localOffset, 0); localOffset += 2; // comment
    writeU16(buf, localOffset, 0); localOffset += 2; // disk number
    writeU16(buf, localOffset, 0); localOffset += 2; // internal attrs
    writeU32(buf, localOffset, 0); localOffset += 4;  // external attrs
    writeU32(buf, localOffset, offsets[i]); localOffset += 4; // local header offset
    buf.set(e.name, localOffset); localOffset += e.name.length;
  }

  // End of central directory
  writeU32(buf, localOffset, 0x06054b50); localOffset += 4;
  writeU16(buf, localOffset, 0); localOffset += 2; // disk number
  writeU16(buf, localOffset, 0); localOffset += 2; // disk with central dir
  writeU16(buf, localOffset, entries.length); localOffset += 2;
  writeU16(buf, localOffset, entries.length); localOffset += 2;
  writeU32(buf, localOffset, localOffset - centralStart - 22); // Fix: centralSize
  localOffset += 4;
  writeU32(buf, localOffset, centralStart); localOffset += 4;
  writeU16(buf, localOffset, 0); localOffset += 2; // comment length

  const blob = new Blob([buf], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
