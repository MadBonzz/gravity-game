// Main game loop — Part 4: audio, trajectory preview, difficulty, persistence

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Scale UI elements relative to a 450px baseline using the shorter screen dimension
function uiScale() { return Math.max(0.65, Math.min(1.4, Math.min(canvas.width, canvas.height) / 450)); }

function resize() {
  canvas.width  = Math.floor(window.innerWidth);
  canvas.height = Math.floor(window.innerHeight);
  // Scale gravity to compensate for larger inter-star distances on wider screens.
  // xRangeScale tells us how much further apart stars are vs the 450px baseline.
  // Exponent 1.5 is a partial correction (full compensation would be ^2.0) —
  // gravity grows noticeably stronger on big screens without feeling overpowered.
  const xRangeScale = GEN.xRange / 190;
  PHYSICS.G = Math.round(500 * Math.pow(xRangeScale, 1.5));
}
window.addEventListener('resize', resize);
resize();

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = { x: 0, y: 0, smoothY: 0 };

function worldToScreen(wx, wy) {
  return {
    x: canvas.width  / 2 + (wx - camera.x),
    y: canvas.height / 2 - (wy - camera.smoothY),
  };
}

// ── World state ───────────────────────────────────────────────────────────────
let suns       = [];
let blackHoles = [];
let planet     = null;

function initWorld() {
  suns       = [];
  blackHoles = [];
  worldTopY  = 0;
  sunsSinceBlackHole = 0;

  // Starting sun
  const startSun = new Sun(0, 0, 1);
  suns.push(startSun);
  worldTopY = 0;

  // Pre-generate enough suns to fill ~2 screens above start
  generateUpTo(canvas.height * 2.5, suns, blackHoles);

  // Spawn planet in circular orbit
  const orbitR = startSun.radius + 65;
  planet = new Planet(orbitR, 0);
  planet.orbitSun    = startSun;
  planet.orbitRadius = orbitR;
  planet.orbitPhase  = 0;
  planet.orbitDir    = 1;
  const v = orbitalSpeed(startSun, orbitR);
  planet.vel = { x: 0, y: v };

  camera.x       = 0;
  camera.y       = 0;
  camera.smoothY = 0;

  resetScore();
  score.lastSun = startSun;
  // Restore persisted best
  const saved = parseInt(localStorage.getItem('gravityHopperBest') || '0', 10);
  if (saved > score.best) score.best = saved;
}

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = { space: false };
let spaceWasDown = false;

window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); keys.space = true; }
  if (e.code === 'KeyD') {
    difficultyMode = difficultyMode === 'easy' ? 'hard' : 'easy';
    if (planet && planet.orbitSun) {
      addPopup(`${difficultyMode.toUpperCase()} MODE`, planet.orbitSun.pos.x, planet.orbitSun.pos.y + 40, '#ffffff');
    }
  }
  if (e.code === 'KeyM') {
    Audio.setMuted(!Audio.isMuted());
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') { keys.space = false; }
});

// Touch support — tap = space
window.addEventListener('touchstart', e => { e.preventDefault(); keys.space = true; },  { passive: false });
window.addEventListener('touchend',   e => { e.preventDefault(); keys.space = false; }, { passive: false });

// ── Power bar ─────────────────────────────────────────────────────────────────
const powerBar = {
  active:    false,
  value:     0,
  direction: 1,
  speed:     0.85, // cycles per second
};

function updatePowerBar(dt) {
  if (!powerBar.active) return;
  powerBar.value += powerBar.direction * powerBar.speed * dt;
  if (powerBar.value >= 1) { powerBar.value = 1;  powerBar.direction = -1; }
  if (powerBar.value <= 0) { powerBar.value = 0;  powerBar.direction =  1; }
}

// ── Orbit helpers ─────────────────────────────────────────────────────────────
function updateOrbit(dt) {
  const sun = planet.orbitSun;
  planet.orbitPhase += planet.orbitDir * (orbitalSpeed(sun, planet.orbitRadius) / planet.orbitRadius) * dt;
  planet.pos.x = sun.pos.x + Math.cos(planet.orbitPhase) * planet.orbitRadius;
  planet.pos.y = sun.pos.y + Math.sin(planet.orbitPhase) * planet.orbitRadius;
  const speed = orbitalSpeed(sun, planet.orbitRadius);
  planet.vel.x = -Math.sin(planet.orbitPhase) * speed * planet.orbitDir;
  planet.vel.y =  Math.cos(planet.orbitPhase) * speed * planet.orbitDir;
}

function launchPlanet() {
  const sun  = planet.orbitSun;
  const r    = planet.orbitRadius;
  const vEsc = escapeVelocity(sun, r);
  const vOrb = orbitalSpeed(sun, r);

  const tangent    = Vec2.norm(planet.vel);
  const radial     = Vec2.norm(Vec2.sub(planet.pos, sun.pos));
  const extraSpeed = powerBar.value * vEsc * 1.8;

  planet.vel.x = tangent.x * vOrb + radial.x * extraSpeed;
  planet.vel.y = tangent.y * vOrb + radial.y * extraSpeed;

  launchCooldownSun   = sun;
  launchCooldownTimer = 0.6;   // don't recapture the launch sun for 0.6 s
  planet.orbitSun = null;
  planet.launched = true;
  planet.frozen   = false;
}

// ── Orbit capture ─────────────────────────────────────────────────────────────
const CAPTURE_RADIUS_FACTOR = 3.5;
let launchCooldownSun   = null;  // sun we just left — skip briefly to avoid instant recapture
let launchCooldownTimer = 0;

function doCapture(sun, orbitRadius) {
  const safeR = sun.radius + planet.radius + 5;

  // Hard cap: orbit can be at most 2× the star's radius beyond its surface.
  // This prevents ridiculously large orbits regardless of where capture triggered.
  const hardCap = sun.radius * 2.0;

  let r = Math.max(Math.min(orbitRadius, hardCap), safeR);

  // Also clamp so orbit can't reach any neighboring body.
  for (const other of [...suns, ...blackHoles]) {
    if (other === sun) continue;
    const distToOther = Vec2.dist(sun.pos, other.pos);
    const otherDanger = (other.eventHorizonR !== undefined) ? other.eventHorizonR : other.radius;
    const maxR = distToOther - otherDanger - 12;
    if (maxR >= safeR) r = Math.min(r, maxR);
  }
  r = Math.max(r, safeR); // never shrink below safe minimum

  const rel   = Vec2.sub(planet.pos, sun.pos);
  const cross = rel.x * planet.vel.y - rel.y * planet.vel.x;
  planet.orbitSun    = sun;
  planet.orbitRadius = r;
  planet.orbitDir    = cross >= 0 ? 1 : -1;
  planet.orbitPhase  = Math.atan2(rel.y, rel.x);
  planet.launched    = false;
  launchCooldownSun   = null;
  launchCooldownTimer = 0;

  const prevSuns = score.totalSuns;
  onOrbitCapture(sun);
  spawnOrbitBurst(planet.pos.x, planet.pos.y, sun.tier.color);
  triggerShake(3);
  try { Audio.playCapture(SUN_TIERS.findIndex(t => t.name === sun.tier.name)); } catch(_) {}
  if (score.totalSuns !== prevSuns && score.totalSuns % 5 === 0) {
    addPopup(`${score.totalSuns} STARS!`, sun.pos.x, sun.pos.y + sun.radius + 40, '#ffdd44');
    try { Audio.playMilestone(); } catch(_) {}
  }
}

function checkOrbitCapture() {
  // Find the closest eligible sun to the planet.
  // Use the closest one — this prevents a distant giant capturing the planet
  // just because its high mass makes the orbital energy more negative.
  let closestSun = null;
  let closestD   = Infinity;
  for (const sun of suns) {
    if (sun === launchCooldownSun && launchCooldownTimer > 0) continue;
    const d = Vec2.dist(planet.pos, sun.pos);
    if (d < closestD) { closestD = d; closestSun = sun; }
  }

  if (!closestSun) return;

  // Touching the star body — force-snap to a tight orbit
  if (closestD < closestSun.radius + planet.radius + 6) {
    doCapture(closestSun, closestSun.radius + planet.radius + 6);
    return;
  }

  // Within capture zone: only capture if speed is below escape velocity for THIS sun.
  // This means N-body effects during flight can redirect you, but once you're
  // slow enough near a specific star, it locks you in.
  if (closestD < closestSun.radius * CAPTURE_RADIUS_FACTOR) {
    const speed = Vec2.len(planet.vel);
    if (speed < escapeVelocity(closestSun, closestD)) {
      doCapture(closestSun, closestD);
    }
  }
}

// Black hole danger — runs every frame, even during orbit.
// The event horizon (70 units) is much larger than the visible radius (22),
// representing the point of no return.
function checkBlackHoleDanger() {
  for (const bh of blackHoles) {
    if (Vec2.dist(planet.pos, bh.pos) < bh.eventHorizonR + planet.radius) {
      triggerDeath('blackhole');
      return;
    }
  }
}

// ── Trail ─────────────────────────────────────────────────────────────────────
const TRAIL_MAX   = 45;
const TRAIL_EVERY = 0.025;
let trailTimer    = 0;

function updateTrail(dt) {
  trailTimer -= dt;
  if (trailTimer <= 0) {
    trailTimer = TRAIL_EVERY;
    planet.trail.push({ x: planet.pos.x, y: planet.pos.y });
    if (planet.trail.length > TRAIL_MAX) planet.trail.shift();
  }
}

// ── Death / state ─────────────────────────────────────────────────────────────
const LOST_TIMEOUT = 8;
let lostTimer   = 0;
let gameState   = 'start';  // 'start' | 'playing' | 'dead'
let deathReason = '';
let difficultyMode = 'easy'; // 'easy' | 'hard'

function triggerDeath(reason) {
  gameState   = 'dead';
  deathReason = reason;
  if (score.current > score.best) {
    score.best = score.current;
    localStorage.setItem('gravityHopperBest', score.best);
  }
  spawnDeathBurst(planet.pos.x, planet.pos.y);
  triggerShake(12);
  try { Audio.playDeath(); } catch(_) {}
}

function resetGame() {
  gameState   = 'playing';
  deathReason = '';
  lostTimer           = 0;
  launchCooldownSun   = null;
  launchCooldownTimer = 0;
  powerBar.active    = false;
  powerBar.value     = 0;
  powerBar.direction = 1;
  popups.length    = 0;
  particles.length = 0;
  shake.intensity  = 0;
  initWorld();
}

// ── Update ────────────────────────────────────────────────────────────────────
let lastTime   = null;
let crashMsg   = null;  // shown on screen if something throws

function update(timestamp) {
  // Always keep the loop alive — never let an exception kill RAF
  requestAnimationFrame(update);

  let dt = 0;
  try {
    dt = lastTime === null ? 0 : Math.min((timestamp - lastTime) / 1000, 0.05);
  } catch(_) {}
  lastTime = timestamp;

  // If a crash was logged, show it and wait for space to reload
  if (crashMsg) {
    try {
      ctx.fillStyle = '#020408';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = '#ff4444';
      ctx.fillText('Internal error — open browser console for details', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '11px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const words = crashMsg.split(' ');
      let line = '', y = canvas.height / 2 + 5;
      for (const w of words) {
        if ((line + w).length > 42) { ctx.fillText(line, canvas.width / 2, y); line = w + ' '; y += 16; }
        else line += w + ' ';
      }
      if (line) ctx.fillText(line, canvas.width / 2, y);
      ctx.font = 'bold 13px Segoe UI';
      ctx.fillStyle = 'rgba(255,255,100,0.8)';
      ctx.fillText('Press F5 to reload', canvas.width / 2, y + 30);
    } catch(_) {}
    return;
  }

  try {

  // Start screen
  if (gameState === 'start') {
    if (keys.space && !spaceWasDown) {
      gameState = 'playing';
    }
    spaceWasDown = keys.space;
    render();
    return;
  }

  if (gameState === 'dead') {
    if (keys.space && !spaceWasDown) resetGame();
    spaceWasDown = keys.space;
    render();
    return;
  }

  // ── Input ──
  if (planet.orbitSun && !planet.frozen) {
    if (keys.space && !spaceWasDown) {
      planet.frozen      = true;
      powerBar.active    = true;
      powerBar.value     = 0;
      powerBar.direction = 1;
    }
  }
  if (planet.frozen && !keys.space && spaceWasDown) {
    powerBar.active = false;
    try { Audio.playLaunch(powerBar.value); } catch(_) {}
    launchPlanet();
  }
  spaceWasDown = keys.space;

  // Difficulty: power bar speeds up with altitude (suns reached)
  powerBar.speed = 0.85 + Math.min(score.totalSuns * 0.022, 1.1);

  updatePowerBar(dt);
  updatePopups(dt);
  updateEffects(dt);

  // ── Physics ──
  if (planet.orbitSun && !planet.frozen) {
    updateOrbit(dt);
  } else if (!planet.orbitSun) {
    const accel = computeGravity(planet, [...suns, ...blackHoles]);
    integrate(planet, accel, dt);

    if (launchCooldownTimer > 0) launchCooldownTimer -= dt;
    checkOrbitCapture();

    // Lost-in-space countdown — only starts if the player has actually launched
    if (planet.launched && !findBoundSun(planet, suns)) {
      const prevFloor = Math.floor(lostTimer);
      lostTimer += dt;
      if (lostTimer > LOST_TIMEOUT) { triggerDeath('lost'); }
      else if (lostTimer >= 2 && Math.floor(lostTimer) > prevFloor) {
        try { Audio.playWarningPing(); } catch(_) {}
      }
    } else {
      lostTimer = 0;
    }
  }

  // Black hole event horizon — checked every frame, even during orbit
  if (gameState === 'playing') checkBlackHoleDanger();

  // Off-screen horizontal death — only meaningful in free flight
  if (!planet.orbitSun) {
    const sp = worldToScreen(planet.pos.x, planet.pos.y);
    if (sp.x < -120 || sp.x > canvas.width + 120) { triggerDeath('offscreen'); }
  }

  // Distance score trickle
  updateDistanceScore(planet.pos.y);

  updateTrail(dt);

  // ── Camera: follow planet, weighted toward looking ahead (upward) ──
  const lookAhead = planet.vel.y > 0 ? 80 : 0;
  const targetY   = planet.pos.y + lookAhead;
  camera.y        = lerp(camera.y, targetY, 0.06);
  camera.smoothY  = lerp(camera.smoothY, camera.y, 0.14);

  // Procedural: generate more world ahead and prune behind
  const cameraTop = camera.smoothY + canvas.height / 2;
  generateUpTo(cameraTop + GEN.lookaheadBuffer, suns, blackHoles);
  pruneBodies(suns, blackHoles, camera.smoothY, planet.orbitSun);

  render();

  } catch (err) {
    crashMsg = String(err);
    console.error('[GravityHopper crash]', err);
  }
}

// ── Starfield (infinite tiling with twinkle) ──────────────────────────────────
const STARS = (() => {
  const arr = [];
  for (let i = 0; i < 280; i++) {
    arr.push({
      ox:         randRange(-canvas.width / 2 - 40, canvas.width / 2 + 40),
      oy:         randRange(0, 900),
      r:          randRange(0.4, 2.0),
      baseBright: randRange(0.3, 1.0),
      twinkleSpd: randRange(0.5, 3.0),
      twinkleOff: randRange(0, Math.PI * 2),
      layer:      randInt(1, 3),
    });
  }
  return arr;
})();
const STAR_TILE = 900;

function drawStarfield() {
  const now = Date.now() / 1000;
  for (const s of STARS) {
    const parallaxFactor = 1 - s.layer * 0.25;
    const worldY  = s.oy - camera.smoothY * parallaxFactor;
    const tiledY  = ((worldY % STAR_TILE) + STAR_TILE) % STAR_TILE - STAR_TILE / 2;
    const sx      = canvas.width  / 2 + s.ox;
    const sy      = canvas.height / 2 - tiledY;
    const twinkle = 0.85 + 0.15 * Math.sin(now * s.twinkleSpd + s.twinkleOff);
    const alpha   = s.baseBright * twinkle;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    ctx.fill();
  }
}

// ── Draw bodies ───────────────────────────────────────────────────────────────
function drawSun(sun) {
  const sp = worldToScreen(sun.pos.x, sun.pos.y);
  const r  = sun.radius;
  // Cull off-screen
  if (sp.x < -r * 5 || sp.x > canvas.width + r * 5 ||
      sp.y < -r * 5 || sp.y > canvas.height + r * 5) return;

  // Outer halo
  const halo = ctx.createRadialGradient(sp.x, sp.y, r * 0.5, sp.x, sp.y, r * 3.5);
  halo.addColorStop(0, sun.tier.glowColor);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r * 3.5, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  // Body
  const grad = ctx.createRadialGradient(sp.x - r * 0.1, sp.y - r * 0.1, 0, sp.x, sp.y, r);
  grad.addColorStop(0, sun.tier.coreColor || '#ffffff');
  grad.addColorStop(0.5, sun.tier.color);
  grad.addColorStop(1, sun.tier.color);
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Gravity influence ring (dashed)
  const captureR = r * CAPTURE_RADIUS_FACTOR;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, captureR, 0, Math.PI * 2);
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  // Tier label near sun
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(sun.tier.name.toUpperCase(), sp.x, sp.y + r + 13);
}

function drawBlackHole(bh) {
  const sp = worldToScreen(bh.pos.x, bh.pos.y);
  const r  = bh.radius;
  if (sp.x < -r * 6 || sp.x > canvas.width + r * 6 ||
      sp.y < -r * 6 || sp.y > canvas.height + r * 6) return;

  const outer = ctx.createRadialGradient(sp.x, sp.y, r, sp.x, sp.y, r * 5);
  outer.addColorStop(0,   'rgba(160,50,255,0.45)');
  outer.addColorStop(0.5, 'rgba(80,0,200,0.15)');
  outer.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r * 5, 0, Math.PI * 2);
  ctx.fillStyle = outer;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,50,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPlanet() {
  // Trail
  if (planet.trail.length > 1) {
    for (let i = 1; i < planet.trail.length; i++) {
      const a     = worldToScreen(planet.trail[i - 1].x, planet.trail[i - 1].y);
      const b     = worldToScreen(planet.trail[i].x,     planet.trail[i].y);
      const alpha = (i / planet.trail.length) * 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(100,180,255,${alpha})`;
      ctx.lineWidth   = lerp(0.5, 2.5, i / planet.trail.length);
      ctx.stroke();
    }
  }

  const sp = worldToScreen(planet.pos.x, planet.pos.y);
  const r  = planet.radius;

  const grad = ctx.createRadialGradient(sp.x - r * 0.3, sp.y - r * 0.3, r * 0.1, sp.x, sp.y, r);
  grad.addColorStop(0,   '#99ddff');
  grad.addColorStop(0.5, '#2277bb');
  grad.addColorStop(1,   '#0d1e33');
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Atmosphere glow
  const atmo = ctx.createRadialGradient(sp.x, sp.y, r, sp.x, sp.y, r + 5);
  atmo.addColorStop(0, 'rgba(100,200,255,0.4)');
  atmo.addColorStop(1, 'rgba(100,200,255,0)');
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = atmo;
  ctx.fill();
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function drawHUD() {
  const S   = uiScale();
  const pad = Math.round(14 * S);

  // Score — top left
  ctx.textAlign = 'left';
  ctx.font = `bold ${Math.round(22 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(score.current.toLocaleString(), pad, Math.round(36 * S));

  ctx.font = `${Math.round(11 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('SCORE', pad, Math.round(50 * S));

  // Best — top right
  ctx.textAlign = 'right';
  ctx.font = `${Math.round(13 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,200,50,0.7)';
  ctx.fillText(`BEST  ${score.best.toLocaleString()}`, canvas.width - pad, Math.round(30 * S));

  // Suns count
  ctx.font = `${Math.round(11 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(`${score.totalSuns} suns`, canvas.width - pad, Math.round(46 * S));

  // Combo — below score (only if > 1)
  if (score.combo > 1) {
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round((12 + score.combo) * S)}px Segoe UI`;
    const comboColor = score.combo >= 5 ? '#ff9900' : score.combo >= 3 ? '#ffdd44' : '#aaffcc';
    ctx.fillStyle = comboColor;
    ctx.fillText(`×${score.combo} COMBO`, pad, Math.round(68 * S));
  }

  // Difficulty indicator — top center, subtle. Includes Mode now.
  const diffLevel = Math.floor(score.totalSuns / 5) + 1;
  const diffLabel = diffLevel <= 2 ? 'EASY' : diffLevel <= 4 ? 'NORMAL' : diffLevel <= 7 ? 'HARD' : 'EXTREME';
  const diffColor = diffLevel <= 2 ? 'rgba(100,255,120,0.4)' : diffLevel <= 4 ? 'rgba(255,220,60,0.4)' : diffLevel <= 7 ? 'rgba(255,140,40,0.4)' : 'rgba(255,60,60,0.5)';
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(10 * S)}px Segoe UI`;
  ctx.fillStyle = diffColor;
  ctx.fillText(`LEVEL ${diffLevel}  ${diffLabel}`, canvas.width / 2, Math.round(18 * S));
  
  ctx.fillStyle = difficultyMode === 'easy' ? 'rgba(80,255,120,0.6)' : 'rgba(255,80,80,0.6)';
  ctx.fillText(`${difficultyMode.toUpperCase()} MODE (Press D)`, canvas.width / 2, Math.round(32 * S));

  // Current orbit info — bottom center
  if (planet.orbitSun) {
    const sun = planet.orbitSun;
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(11 * S)}px Segoe UI`;
    ctx.fillStyle = `rgba(255,255,255,0.5)`;
    ctx.fillText(`Orbiting: ${sun.tier.name} star  •  worth ${sun.scoreValue} pts`, canvas.width / 2, canvas.height - Math.round(80 * S));
  }

  drawPowerBar();
  drawLostTimerHUD();
}

function drawPowerBar() {
  if (difficultyMode === 'hard') return;
  if (!powerBar.active) return;

  const S     = uiScale();
  const BAR_W = Math.round(160 * S);
  const BAR_H = Math.round(16 * S);
  const BAR_X = canvas.width / 2 - BAR_W / 2;
  const BAR_Y = canvas.height - Math.round(60 * S);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 4);
  ctx.fill(); ctx.stroke();

  const v  = powerBar.value;
  const rc = Math.round(lerp(50, 255, v));
  const gc = Math.round(lerp(220, 50, v));
  ctx.fillStyle = `rgb(${rc},${gc},50)`;
  ctx.beginPath();
  ctx.roundRect(BAR_X + 1, BAR_Y + 1, (BAR_W - 2) * v, BAR_H - 2, 3);
  ctx.fill();

  // Escape velocity marker (at ~0.55 power the planet roughly hits escape vel)
  const escMark = BAR_X + (BAR_W - 2) * 0.55;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(escMark, BAR_Y);
  ctx.lineTo(escMark, BAR_Y + BAR_H);
  ctx.stroke();

  const barLabel = isTouchDevice ? 'POWER  —  release to launch' : 'POWER  —  release SPACE';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `${Math.round(11 * S)}px Segoe UI`;
  ctx.textAlign = 'center';
  ctx.fillText(barLabel, canvas.width / 2, BAR_Y - Math.round(6 * S));

  // Tiny "ESC" label above marker
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `${Math.round(9 * S)}px Segoe UI`;
  ctx.fillText('esc', escMark, BAR_Y - 1);
}

function drawLostTimerHUD() {
  if (planet.orbitSun) return;
  const bound = findBoundSun(planet, suns);
  if (bound) return;
  if (lostTimer < 1) return;

  const S         = uiScale();
  const remaining = LOST_TIMEOUT - lostTimer;
  const t = remaining / LOST_TIMEOUT;
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(17 * S)}px Segoe UI`;
  ctx.fillStyle = `rgba(255,${Math.round(60 * t)},${Math.round(60 * t)},${pulse})`;
  ctx.fillText(`Lost in space… ${Math.ceil(remaining)}s`, canvas.width / 2, Math.round(80 * S));
}

// ── Trajectory preview ────────────────────────────────────────────────────────
// Simulate N steps forward from current frozen position at current power value,
// draw ghost dots showing predicted path.
const TRAJ_STEPS = 80;
const TRAJ_DT    = 0.055;

function drawTrajectoryPreview() {
  if (difficultyMode === 'hard') return;
  if (!planet.orbitSun) return;

  // In easy mode, if not actively charging, show a basic unpowered path (power = 0)
  const powerUsed = powerBar.active ? powerBar.value : 0;

  const sun    = planet.orbitSun;
  const r      = planet.orbitRadius;
  const vEsc   = escapeVelocity(sun, r);
  const vOrb   = orbitalSpeed(sun, r);
  const tangent = Vec2.norm(planet.vel);
  const radial  = Vec2.norm(Vec2.sub(planet.pos, sun.pos));
  const extra   = powerUsed * vEsc * 1.8;

  // Simulated initial velocity
  let px = planet.pos.x, py = planet.pos.y;
  let vx = tangent.x * vOrb + radial.x * extra;
  let vy = tangent.y * vOrb + radial.y * extra;

  const sources = [...suns, ...blackHoles];
  let hitSun = null;

  for (let i = 0; i < TRAJ_STEPS; i++) {
    // Gravity step
    let ax = 0, ay = 0;
    for (const src of sources) {
      const dx = src.pos.x - px;
      const dy = src.pos.y - py;
      const r2 = dx * dx + dy * dy + PHYSICS.SOFTENING;
      const f  = PHYSICS.G * src.mass / r2;
      const rm = Math.sqrt(r2);
      ax += f * dx / rm;
      ay += f * dy / rm;
    }
    vx += ax * TRAJ_DT;
    vy += ay * TRAJ_DT;
    px += vx * TRAJ_DT;
    py += vy * TRAJ_DT;

    // Check if captured by a sun (stop drawing there)
    for (const s of suns) {
      if (!s.isBlackHole && Vec2.dist({ x: px, y: py }, s.pos) < s.radius * CAPTURE_RADIUS_FACTOR * 0.8) {
        hitSun = s; break;
      }
    }

    const t     = i / TRAJ_STEPS;
    const alpha = (1 - t) * 0.55;
    const sp    = worldToScreen(px, py);
    const dotR  = lerp(3, 1, t);

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, dotR, 0, Math.PI * 2);
    // Color: green if below escape, yellow near it, red above
    const v2   = vx * vx + vy * vy;
    const vEscAt = escapeVelocity(sun, Vec2.dist({ x: px, y: py }, sun.pos));
    const ratio  = Math.sqrt(v2) / vEscAt;
    const dotColor = ratio < 0.9
      ? `rgba(80,255,120,${alpha})`
      : ratio < 1.15
        ? `rgba(255,220,60,${alpha})`
        : `rgba(255,100,80,${alpha})`;
    ctx.fillStyle = dotColor;
    ctx.fill();

    if (hitSun) break;
  }

  // Draw capture target ring if we predict landing on a sun
  if (hitSun && hitSun !== sun) {
    const sp = worldToScreen(hitSun.pos.x, hitSun.pos.y);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, hitSun.radius * CAPTURE_RADIUS_FACTOR, 0, Math.PI * 2);
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = `rgba(80,255,120,0.3)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Mute button ───────────────────────────────────────────────────────────────
const MUTE_BTN = { x: 0, y: 0, size: 28 };

function drawMuteButton() {
  const S        = uiScale();
  const iconSize = Math.round((isTouchDevice ? 26 : 18) * S);
  const pad      = Math.round(iconSize * 0.75);
  MUTE_BTN.x    = canvas.width  - pad;
  MUTE_BTN.y    = canvas.height - pad;
  MUTE_BTN.size = iconSize + pad;
  const icon = Audio.isMuted() ? '🔇' : '🔊';
  ctx.font = `${iconSize}px serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = 0.65;
  ctx.fillText(icon, MUTE_BTN.x, MUTE_BTN.y);
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';
}

function isInMuteBtn(sx, sy) {
  return sx > canvas.width - MUTE_BTN.size && sy > canvas.height - MUTE_BTN.size;
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const sx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const sy   = (e.clientY - rect.top)  * (canvas.height / rect.height);

  // About overlay intercepts all clicks while open
  if (aboutOpen) {
    if (sx >= ABOUT_LINK.x && sx <= ABOUT_LINK.x + ABOUT_LINK.w &&
        sy >= ABOUT_LINK.y && sy <= ABOUT_LINK.y + ABOUT_LINK.h) {
      window.open('https://github.com/MadBonzz/gravity-game', '_blank', 'noopener');
    }
    aboutOpen = false;
    return;
  }

  if (isInMuteBtn(sx, sy)) {
    Audio.setMuted(!Audio.isMuted());
    return;
  }

  if (isInAboutBtn(sx, sy)) {
    aboutOpen = true;
    return;
  }

  if (gameState === 'start') {
    if (sx >= DIFF_BTN.x && sx <= DIFF_BTN.x + DIFF_BTN.w &&
        sy >= DIFF_BTN.y && sy <= DIFF_BTN.y + DIFF_BTN.h) {
      difficultyMode = difficultyMode === 'easy' ? 'hard' : 'easy';
      // prevent this click from also starting the game if they clicked the spacebar too
      spaceWasDown = true;
    }
  }
});

// ── About button / overlay ─────────────────────────────────────────────────────
const ABOUT_BTN  = { x: 0, y: 0, size: 0 };
const ABOUT_LINK = { x: 0, y: 0, w: 0, h: 0 }; // hit-rect for the GitHub URL
let   aboutOpen  = false;

function drawAboutButton() {
  const S   = uiScale();
  const r   = Math.round((isTouchDevice ? 13 : 9) * S);
  const pad = Math.round(r * 1.9);
  const bx  = pad;
  const by  = canvas.height - pad;
  ABOUT_BTN.size = (r + pad);  // square hit region from corner

  ctx.save();
  ctx.globalAlpha = aboutOpen ? 1.0 : 0.50;

  // circle background
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fillStyle = aboutOpen ? 'rgba(100,160,255,0.28)' : 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = aboutOpen ? '#88ccff' : 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // "i" letter
  ctx.font         = `bold ${Math.round(r * 1.25)}px Segoe UI`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = aboutOpen ? '#88ccff' : '#ffffff';
  ctx.fillText('i', bx, by);

  ctx.restore();
}

function isInAboutBtn(sx, sy) {
  return sx < ABOUT_BTN.size && sy > canvas.height - ABOUT_BTN.size;
}

function drawAboutOverlay() {
  if (!aboutOpen) return;

  const S   = uiScale();
  const W   = Math.min(canvas.width * 0.82, Math.round(310 * S));
  const H   = Math.round(168 * S);
  const ox  = canvas.width  / 2 - W / 2;
  const oy  = canvas.height / 2 - H / 2;
  const pad = Math.round(18 * S);
  const cx  = canvas.width / 2;

  // dim backdrop
  ctx.fillStyle = 'rgba(0,0,0,0.60)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // card background
  ctx.fillStyle   = 'rgba(6,12,26,0.97)';
  ctx.strokeStyle = 'rgba(100,160,255,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(ox, oy, W, H, Math.round(10 * S));
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';

  // game title
  ctx.font      = `bold ${Math.round(17 * S)}px Segoe UI`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('GRAVITY HOPPER', cx, oy + pad + Math.round(15 * S));

  // made by line
  ctx.font      = `${Math.round(11 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(160,190,255,0.70)';
  ctx.fillText('made by  MadBonzz', cx, oy + pad + Math.round(34 * S));

  // thin divider
  ctx.strokeStyle = 'rgba(100,160,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(ox + pad, oy + pad + Math.round(48 * S));
  ctx.lineTo(ox + W - pad, oy + pad + Math.round(48 * S));
  ctx.stroke();

  // GitHub link
  const linkText = 'github.com/MadBonzz/gravity-game';
  const linkY    = oy + pad + Math.round(78 * S);
  ctx.font       = `${Math.round(11 * S)}px Segoe UI`;
  ctx.fillStyle  = '#4d9fff';
  ctx.fillText(linkText, cx, linkY);

  // underline
  const tw = ctx.measureText(linkText).width;
  ctx.strokeStyle = 'rgba(77,159,255,0.6)';
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - tw / 2, linkY + 2);
  ctx.lineTo(cx + tw / 2, linkY + 2);
  ctx.stroke();

  // store hit-rect for click detection (set every frame so scale changes are handled)
  ABOUT_LINK.x = cx - tw / 2;
  ABOUT_LINK.y = linkY - Math.round(14 * S);
  ABOUT_LINK.w = tw;
  ABOUT_LINK.h = Math.round(20 * S);

  // close hint
  ctx.font      = `${Math.round(10 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText(
    isTouchDevice ? 'tap anywhere to close' : 'click anywhere to close',
    cx, oy + H - Math.round(12 * S)
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────
const DIFF_BTN = { x: 0, y: 0, w: 120, h: 40 };

function drawStartScreen() {
  const S  = uiScale();
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = 'center';

  // ── Title ──
  ctx.font      = `bold ${Math.round(38 * S)}px Segoe UI`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('GRAVITY HOPPER', cx, cy - Math.round(148 * S));

  // ── Tagline ──
  ctx.font      = `italic ${Math.round(12 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(160,200,255,0.60)';
  ctx.fillText('Every orbit is a controlled fall \u2014 until you let go.', cx, cy - Math.round(116 * S));

  // ── Description ──
  ctx.font      = `${Math.round(12 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fillText('Hop between stars using gravitational momentum.', cx, cy - Math.round(84 * S));
  ctx.fillText("Avoid black holes. Don't drift too far. Rise forever.", cx, cy - Math.round(68 * S));

  // ── Thin separator ──
  const sepW = Math.min(canvas.width * 0.50, Math.round(250 * S));
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(cx - sepW / 2, cy - Math.round(50 * S));
  ctx.lineTo(cx + sepW / 2, cy - Math.round(50 * S));
  ctx.stroke();

  // ── Controls ──
  if (isTouchDevice) {
    ctx.font      = `${Math.round(12 * S)}px Segoe UI`;
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.fillText('TAP & HOLD to charge power \u2014 release to launch', cx, cy - Math.round(28 * S));
    ctx.fillText('TAP the mode button below to toggle Easy / Hard', cx, cy - Math.round(12 * S));
  } else {
    const ctrlRows = [
      ['SPACE', 'hold to charge power \u2014 release to launch'],
      ['D',     'toggle Easy / Hard difficulty'],
      ['M',     'toggle sound on / off'],
    ];
    const lineH    = Math.round(20 * S);
    const keyColX  = cx - Math.round(92 * S);
    const descColX = cx - Math.round(56 * S);

    for (let i = 0; i < ctrlRows.length; i++) {
      const [k, desc] = ctrlRows[i];
      const y = cy - Math.round(30 * S) + i * lineH;

      // key cap
      ctx.font = `bold ${Math.round(10 * S)}px Segoe UI`;
      const kw = Math.max(Math.round(44 * S), ctx.measureText(k).width + Math.round(18 * S));
      const kh = Math.round(17 * S);
      ctx.fillStyle   = 'rgba(255,255,255,0.09)';
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.roundRect(keyColX - kw / 2, y - Math.round(13 * S), kw, kh, 3);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fillText(k, keyColX, y);

      // description
      ctx.textAlign = 'left';
      ctx.font      = `${Math.round(11 * S)}px Segoe UI`;
      ctx.fillStyle = 'rgba(200,215,255,0.44)';
      ctx.fillText(desc, descColX, y);
    }
  }

  // ── MODE toggle button — dimensions set before x so centering is correct ──
  ctx.textAlign  = 'center';
  DIFF_BTN.w     = Math.round(148 * S);
  DIFF_BTN.h     = Math.round(37 * S);
  DIFF_BTN.x     = cx - DIFF_BTN.w / 2;       // centred using the just-set width
  DIFF_BTN.y     = cy + Math.round(34 * S);

  ctx.fillStyle   = difficultyMode === 'easy' ? 'rgba(80,255,120,0.15)' : 'rgba(255,80,80,0.15)';
  ctx.strokeStyle = difficultyMode === 'easy' ? 'rgba(80,255,120,0.75)' : 'rgba(255,80,80,0.75)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(DIFF_BTN.x, DIFF_BTN.y, DIFF_BTN.w, DIFF_BTN.h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font      = `bold ${Math.round(13 * S)}px Segoe UI`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`MODE: ${difficultyMode.toUpperCase()}`, cx, DIFF_BTN.y + DIFF_BTN.h / 2 + Math.round(5 * S));

  ctx.font      = `${Math.round(9 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText('click to toggle', cx, DIFF_BTN.y + DIFF_BTN.h + Math.round(10 * S));

  // ── Start prompt (pulsing) ──
  const pulse = 0.65 + 0.35 * Math.sin(Date.now() / 600);
  ctx.font      = `bold ${Math.round(14 * S)}px Segoe UI`;
  ctx.fillStyle = `rgba(255,255,120,${pulse.toFixed(2)})`;
  ctx.fillText(isTouchDevice ? 'TAP TO BEGIN' : 'PRESS SPACE TO BEGIN', cx, cy + Math.round(94 * S));
}

function drawDeathScreen() {
  const S = uiScale();
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const msgs = {
    blackhole: 'Consumed by a Black Hole',
    lost:      'Lost in Space',
    offscreen: 'Drifted into the Void',
  };

  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(28 * S)}px Segoe UI`;
  ctx.fillStyle = '#ff5555';
  ctx.fillText(msgs[deathReason] || 'Game Over', canvas.width / 2, canvas.height / 2 - Math.round(55 * S));

  ctx.font = `bold ${Math.round(20 * S)}px Segoe UI`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(score.current.toLocaleString(), canvas.width / 2, canvas.height / 2 - Math.round(15 * S));
  ctx.font = `${Math.round(12 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('SCORE', canvas.width / 2, canvas.height / 2 + Math.round(4 * S));

  ctx.font = `${Math.round(13 * S)}px Segoe UI`;
  ctx.fillStyle = 'rgba(255,200,50,0.8)';
  ctx.fillText(`Best: ${score.best.toLocaleString()}  •  Stars reached: ${score.totalSuns}`, canvas.width / 2, canvas.height / 2 + Math.round(28 * S));

  const ctaText = isTouchDevice ? 'TAP TO RETRY' : 'PRESS SPACE TO RETRY';
  ctx.font = `bold ${Math.round(15 * S)}px Segoe UI`;
  ctx.fillStyle = `rgba(255,255,100,${0.7 + 0.3 * Math.sin(Date.now() / 500)})`;
  ctx.fillText(ctaText, canvas.width / 2, canvas.height / 2 + Math.round(68 * S));
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#020408';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  applyShake();

  // Layer 1: deep background (nebulae, stars, comets)
  drawNebulae();
  drawStarfield();
  drawComets();

  // Layer 2: sun coronas (drawn before sun bodies so glow sits behind)
  for (const sun of suns) { initSunEffects(sun); drawSunCorona(sun); }

  // Layer 3: sun bodies + black holes
  for (const sun of suns) drawSun(sun);
  for (const bh of blackHoles) drawBlackHoleEffect(bh);

  // Layer 4: planet + trajectory preview + particles + popups
  if (gameState !== 'start') {
    if (planet.orbitSun) drawTrajectoryPreview();
    drawPlanet();
    drawForegroundEffects();
    drawPopups(worldToScreen);
    drawHUD();
  }

  ctx.restore();

  // Screen overlays drawn first so persistent UI renders on top of them
  if (gameState === 'start') drawStartScreen();
  if (gameState === 'dead')  drawDeathScreen();

  drawMuteButton();
  drawAboutButton();
  drawAboutOverlay();
}

// ── Start ─────────────────────────────────────────────────────────────────────
initWorld();
requestAnimationFrame(update);
