// Visual effects: particles, comets, nebulae, screen shake, sun corona

// ── Screen shake ──────────────────────────────────────────────────────────────
const shake = { intensity: 0, decay: 8 };

function triggerShake(amount) {
  shake.intensity = Math.max(shake.intensity, amount);
}

function updateShake(dt) {
  shake.intensity = Math.max(0, shake.intensity - shake.decay * dt);
}

function applyShake() {
  if (shake.intensity < 0.2) return;
  const dx = (Math.random() - 0.5) * shake.intensity * 2;
  const dy = (Math.random() - 0.5) * shake.intensity * 2;
  ctx.translate(dx, dy);
}

// ── Particle system ───────────────────────────────────────────────────────────
const particles = [];

function spawnOrbitBurst(worldX, worldY, color) {
  // Ring of sparks when planet enters orbit
  const count = 22;
  for (let i = 0; i < count; i++) {
    const angle  = (i / count) * Math.PI * 2 + randRange(0, 0.3);
    const speed  = randRange(40, 120);
    particles.push({
      wx: worldX, wy: worldY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r:  randRange(1.5, 3.5),
      life: randRange(0.5, 1.1),
      age: 0,
      color,
      fade: true,
    });
  }
}

function spawnDeathBurst(worldX, worldY) {
  for (let i = 0; i < 35; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(60, 200);
    particles.push({
      wx: worldX, wy: worldY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r:  randRange(2, 5),
      life: randRange(0.8, 1.8),
      age: 0,
      color: `hsl(${randInt(0, 40)},100%,65%)`,
      fade: true,
    });
  }
}

function spawnTrailSpark(worldX, worldY) {
  particles.push({
    wx: worldX, wy: worldY,
    vx: randRange(-15, 15),
    vy: randRange(-15, 15),
    r:  randRange(0.8, 2),
    life: randRange(0.2, 0.5),
    age: 0,
    color: `hsl(${randInt(190, 220)},80%,70%)`,
    fade: true,
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    // Simple drag
    p.vx *= 1 - dt * 1.8;
    p.vy *= 1 - dt * 1.8;
    p.wx += p.vx * dt;
    p.wy += p.vy * dt;
  }
}

function drawParticles() {
  for (const p of particles) {
    const t  = p.age / p.life;
    const sp = worldToScreen(p.wx, p.wy);
    ctx.save();
    ctx.globalAlpha = p.fade ? (1 - t * t) : 1;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, p.r * (1 - t * 0.4), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();
  }
}

// ── Nebula clouds ─────────────────────────────────────────────────────────────
// Generated once, tiled vertically with parallax (very slow layer)
const NEBULA_TILE = 2400;
const nebulae = (() => {
  const arr = [];
  const palettes = [
    ['rgba(80,0,120,', 'rgba(40,0,80,'],
    ['rgba(0,40,120,', 'rgba(0,20,80,'],
    ['rgba(120,30,0,', 'rgba(80,10,0,'],
    ['rgba(0,80,60,',  'rgba(0,50,40,'],
  ];
  for (let i = 0; i < 14; i++) {
    const pal = palettes[randInt(0, palettes.length - 1)];
    arr.push({
      ox:     randRange(-350, 350),
      oy:     randRange(0, NEBULA_TILE),
      rx:     randRange(120, 280),
      ry:     randRange(80, 180),
      rot:    randRange(0, Math.PI),
      alpha:  randRange(0.04, 0.12),
      color1: pal[0],
      color2: pal[1],
    });
  }
  return arr;
})();

function drawNebulae() {
  for (const n of nebulae) {
    // Very slow parallax (0.05 factor)
    const worldY  = n.oy - camera.smoothY * 0.05;
    const tiledY  = ((worldY % NEBULA_TILE) + NEBULA_TILE) % NEBULA_TILE - NEBULA_TILE / 2;
    const sx      = canvas.width  / 2 + n.ox;
    const sy      = canvas.height / 2 - tiledY;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(n.rot);
    ctx.scale(1, n.ry / n.rx);

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, n.rx);
    g.addColorStop(0, n.color1 + n.alpha + ')');
    g.addColorStop(1, n.color2 + '0)');
    ctx.beginPath();
    ctx.arc(0, 0, n.rx, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
}

// ── Comets ────────────────────────────────────────────────────────────────────
const comets = [];
const COMET_SPAWN_INTERVAL = 3.5;
let cometTimer = 1.0;

function spawnComet() {
  // Comets cross screen diagonally in the background (screen-space)
  const fromLeft = Math.random() < 0.5;
  const sx  = fromLeft ? -80 : canvas.width + 80;
  const sy  = randRange(canvas.height * 0.05, canvas.height * 0.7);
  const spd = randRange(200, 420);
  const ang = randRange(-0.3, 0.3) + (fromLeft ? 0 : Math.PI);
  comets.push({
    x: sx, y: sy,
    vx: Math.cos(ang) * spd,
    vy: Math.sin(ang) * spd,
    len: randRange(40, 110),
    width: randRange(1, 2.5),
    life: 3,
    age: 0,
    color: Math.random() < 0.3 ? '#ffeeaa' : '#aaddff',
  });
}

function updateComets(dt) {
  cometTimer -= dt;
  if (cometTimer <= 0) {
    spawnComet();
    cometTimer = COMET_SPAWN_INTERVAL + randRange(-1, 1);
  }
  for (let i = comets.length - 1; i >= 0; i--) {
    const c = comets[i];
    c.age += dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (c.x < -200 || c.x > canvas.width + 200 ||
        c.y < -200 || c.y > canvas.height + 200 || c.age > c.life) {
      comets.splice(i, 1);
    }
  }
}

function drawComets() {
  for (const c of comets) {
    const t     = c.age / c.life;
    const alpha = Math.sin(t * Math.PI) * 0.55;
    if (alpha < 0.01) continue;

    const nx = -c.vx / Math.sqrt(c.vx * c.vx + c.vy * c.vy);
    const ny = -c.vy / Math.sqrt(c.vx * c.vx + c.vy * c.vy);

    const tailX = c.x + nx * c.len;
    const tailY = c.y + ny * c.len;

    // Draw with globalAlpha
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = c.color;
    ctx.lineWidth   = c.width;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // Head glow dot
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.width * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.restore();
  }
}

// ── Sun corona rays ───────────────────────────────────────────────────────────
// Each sun gets animated corona spikes. State stored on sun object.
function initSunEffects(sun) {
  if (sun._corona) return;
  const count = 8 + randInt(0, 4);
  sun._corona = [];
  for (let i = 0; i < count; i++) {
    sun._corona.push({
      angle:  (i / count) * Math.PI * 2 + randRange(0, 0.5),
      length: randRange(0.25, 0.55),  // multiplier of radius
      speed:  randRange(0.3, 0.9) * (Math.random() < 0.5 ? 1 : -1),
      width:  randRange(0.04, 0.12),  // angle half-width
      phase:  randRange(0, Math.PI * 2),
    });
  }
  sun._pulsePhase = randRange(0, Math.PI * 2);
}

function updateSunEffects(dt) {
  for (const sun of suns) {
    initSunEffects(sun);
    sun._pulsePhase += dt * 1.2;
    for (const ray of sun._corona) {
      ray.angle += ray.speed * dt * 0.15;
      ray.phase += dt * 2.5;
    }
  }
}

function drawSunCorona(sun) {
  const sp    = worldToScreen(sun.pos.x, sun.pos.y);
  const r     = sun.radius;
  const pulse = 1 + 0.04 * Math.sin(sun._pulsePhase);

  // Pulsing outer glow
  const halo = ctx.createRadialGradient(sp.x, sp.y, r * pulse, sp.x, sp.y, r * 4);
  halo.addColorStop(0,   sun.tier.glowColor);
  halo.addColorStop(0.6, sun.tier.glowColor.replace(/[\d.]+\)$/, '0.05)'));
  halo.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r * 4, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  // Corona rays
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const ray of sun._corona) {
    const len    = r * (ray.length + 0.15 * Math.sin(ray.phase));
    const halfW  = ray.width + 0.04 * Math.sin(ray.phase * 0.7);
    const a0     = ray.angle - halfW;
    const a1     = ray.angle + halfW;
    const tipX   = sp.x + Math.cos(ray.angle) * (r + len);
    const tipY   = sp.y + Math.sin(ray.angle) * (r + len);
    const e0X    = sp.x + Math.cos(a0) * r * pulse;
    const e0Y    = sp.y + Math.sin(a0) * r * pulse;
    const e1X    = sp.x + Math.cos(a1) * r * pulse;
    const e1Y    = sp.y + Math.sin(a1) * r * pulse;

    const rg = ctx.createLinearGradient(
      (e0X + e1X) / 2, (e0Y + e1Y) / 2, tipX, tipY
    );
    rg.addColorStop(0, sun.tier.color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.moveTo(e0X, e0Y);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(e1X, e1Y);
    ctx.closePath();
    ctx.fillStyle = rg;
    ctx.fill();
  }
  ctx.restore();
}

// ── Black hole spinning ring ───────────────────────────────────────────────────
function initBHEffects(bh) {
  if (bh._angle !== undefined) return;
  bh._angle   = 0;
  bh._angle2  = Math.PI;
}

function updateBHEffects(dt) {
  for (const bh of blackHoles) {
    initBHEffects(bh);
    bh._angle  += dt * 1.4;
    bh._angle2 += dt * 0.9;
  }
}

function drawBlackHoleEffect(bh) {
  initBHEffects(bh);  // safe to call before updateBHEffects runs
  const sp = worldToScreen(bh.pos.x, bh.pos.y);
  const r  = bh.radius;
  if (sp.x < -r * 8 || sp.x > canvas.width + r * 8 ||
      sp.y < -r * 8 || sp.y > canvas.height + r * 8) return;

  // Outer gravitational lensing haze
  const outer = ctx.createRadialGradient(sp.x, sp.y, r * 1.2, sp.x, sp.y, r * 6);
  outer.addColorStop(0,   'rgba(160,50,255,0.35)');
  outer.addColorStop(0.4, 'rgba(80,0,200,0.12)');
  outer.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r * 6, 0, Math.PI * 2);
  ctx.fillStyle = outer;
  ctx.fill();

  // Spinning accretion arcs
  ctx.save();
  ctx.translate(sp.x, sp.y);
  for (let arc = 0; arc < 2; arc++) {
    const baseAngle = arc === 0 ? bh._angle : bh._angle2;
    ctx.save();
    ctx.rotate(baseAngle);
    const ag = ctx.createConicalGradient
      ? null   // fallback below
      : null;
    // Draw arc as a stroked arc with gradient alpha trick
    const arcStart = -0.7;
    const arcEnd   =  0.7;
    const diskR    = r * 2.2 + arc * r * 0.6;
    const grad = ctx.createLinearGradient(-diskR, 0, diskR, 0);
    grad.addColorStop(0,   'rgba(0,0,0,0)');
    grad.addColorStop(0.3, arc === 0 ? 'rgba(200,100,255,0.7)' : 'rgba(100,150,255,0.5)');
    grad.addColorStop(0.7, arc === 0 ? 'rgba(200,100,255,0.7)' : 'rgba(100,150,255,0.5)');
    grad.addColorStop(1,   'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.arc(0, 0, diskR, arcStart, arcEnd);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = arc === 0 ? 3 : 2;
    ctx.stroke();
    ctx.restore();
  }

  // Event horizon ring — pulsing red boundary showing the point of no return
  const ehR = bh.eventHorizonR;  // 70 units in world space
  const pulse = 0.4 + 0.2 * Math.sin(bh._angle * 2.5);
  ctx.beginPath();
  ctx.arc(0, 0, ehR, 0, Math.PI * 2);
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = `rgba(255,60,60,${pulse})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  // Black center
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.strokeStyle = 'rgba(180,80,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

// ── Trail sparks (called from game loop while in free flight) ─────────────────
let sparkTimer = 0;
function updateTrailSparks(dt) {
  if (!planet || planet.orbitSun) return;
  sparkTimer -= dt;
  if (sparkTimer <= 0) {
    sparkTimer = 0.04;
    spawnTrailSpark(planet.pos.x, planet.pos.y);
  }
}

// ── Master update/draw ────────────────────────────────────────────────────────
function updateEffects(dt) {
  updateShake(dt);
  updateParticles(dt);
  updateComets(dt);
  updateSunEffects(dt);
  updateBHEffects(dt);
  updateTrailSparks(dt);
}

function drawBackgroundEffects() {
  drawNebulae();
  drawComets();
}

function drawWorldEffects() {
  // Sun coronas drawn before sun bodies (behind)
  for (const sun of suns) {
    initSunEffects(sun);
    drawSunCorona(sun);
  }
  // Black hole rings drawn instead of base drawBlackHole
  for (const bh of blackHoles) drawBlackHoleEffect(bh);
}

function drawForegroundEffects() {
  drawParticles();
}
