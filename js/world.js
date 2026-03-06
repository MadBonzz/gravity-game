// Procedural world generation + scoring

// ── Generation config ─────────────────────────────────────────────────────────
const GEN = {
  sunSpacingMin:    260,   // min vertical gap between suns
  sunSpacingMax:    420,   // max vertical gap
  // Spread scales with screen width but is capped at 350 world units so that
  // inter-star distances stay manageable. resize() scales PHYSICS.G to compensate.
  get xRange()        { return Math.max(190, Math.min(350, Math.floor(canvas.width * 0.28))); },
  minSunDistance:   180,   // minimum distance between any two suns
  blackHoleEvery:   5,     // spawn one black hole every N suns (approx)
  // black hole offsets track xRange so they remain within the visible play area
  get blackHoleXMin() { return Math.max(110, Math.floor(GEN.xRange * 0.65)); },
  get blackHoleXMax() { return Math.max(200, Math.floor(GEN.xRange * 1.20)); },
  pruneDistance:    900,   // remove bodies this far below camera
  lookaheadBuffer:  700,   // generate when top sun is within this of camera top
};

// Tier weight tables — index = tier (0=dwarf .. 4=giant)
// At low altitude: favour medium. At high altitude: more extremes.
function getTierWeights(altitude) {
  // altitude in world units (higher = harder)
  const t = clamp(altitude / 5000, 0, 1);
  // lerp from easy distribution to hard distribution
  const easy = [0.10, 0.35, 0.35, 0.15, 0.05];
  const hard = [0.25, 0.20, 0.20, 0.20, 0.15];
  return easy.map((e, i) => lerp(e, hard[i], t));
}

function weightedRandom(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ── World generator ───────────────────────────────────────────────────────────
let worldTopY       = 0;   // highest Y already generated
let sunsSinceBlackHole = 0;

/**
 * Extend the world upward until we have bodies up to `targetY`.
 * Mutates the `suns` and `blackHoles` arrays from game.js (passed as refs).
 */
function generateUpTo(targetY, sunsArr, blackHolesArr) {
  while (worldTopY < targetY) {
    const gap = randRange(GEN.sunSpacingMin, GEN.sunSpacingMax);
    worldTopY += gap;

    const altitude = worldTopY;
    const weights  = getTierWeights(altitude);
    const tier     = weightedRandom(weights);

    // Pick X, nudge away from existing nearby suns
    let x, attempts = 0, ok = false;
    while (attempts++ < 20 && !ok) {
      x = randRange(-GEN.xRange, GEN.xRange);
      ok = sunsArr.every(s => {
        const dx = s.pos.x - x;
        const dy = s.pos.y - worldTopY;
        return Math.sqrt(dx * dx + dy * dy) >= GEN.minSunDistance;
      });
    }

    sunsArr.push(new Sun(x, worldTopY, tier));
    sunsSinceBlackHole++;

    // Maybe spawn a black hole offset to the side
    if (sunsSinceBlackHole >= GEN.blackHoleEvery && Math.random() < 0.6) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const bhX  = x + side * randRange(GEN.blackHoleXMin, GEN.blackHoleXMax);
      const bhY  = worldTopY + randRange(-80, 80);
      blackHolesArr.push(new BlackHole(bhX, bhY));
      sunsSinceBlackHole = 0;
    }
  }
}

/**
 * Remove bodies that are far below the camera (Y < camera.y - pruneDistance).
 * Keeps the arrays from growing unbounded.
 * Never prunes the sun the planet is currently orbiting.
 */
function pruneBodies(sunsArr, blackHolesArr, cameraY, orbitSun) {
  const cutoff = cameraY - GEN.pruneDistance;
  for (let i = sunsArr.length - 1; i >= 0; i--) {
    if (sunsArr[i].pos.y < cutoff && sunsArr[i] !== orbitSun) {
      sunsArr.splice(i, 1);
    }
  }
  for (let i = blackHolesArr.length - 1; i >= 0; i--) {
    if (blackHolesArr[i].pos.y < cutoff) {
      blackHolesArr.splice(i, 1);
    }
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────
const score = {
  current:    0,
  best:       0,
  combo:      1,        // multiplier, resets when planet returns to same sun
  lastSun:    null,     // last sun captured — detect same-sun return
  totalSuns:  0,        // suns successfully hopped to (new ones only)
  distanceBase: 0,      // planet.pos.y when last captured
};

const DIST_POINTS_PER_100 = 5; // points per 100 world units of altitude gain

function onOrbitCapture(sun) {
  const isNewSun = (sun !== score.lastSun);

  if (isNewSun) {
    // Count suns skipped between last capture and this one (by Y position)
    let skipped = 0;
    if (score.lastSun) {
      const minY = Math.min(score.lastSun.pos.y, sun.pos.y);
      const maxY = Math.max(score.lastSun.pos.y, sun.pos.y);
      skipped = suns.filter(s => s !== score.lastSun && s !== sun &&
                                  s.pos.y > minY && s.pos.y < maxY).length;
    }

    // Combo increments for each unique new sun
    score.combo = Math.min(score.combo + 1, 8);
    const basePoints = Math.round(sun.scoreValue * score.combo);
    // Skip bonus: 300 pts per skipped star, multiplied by current combo
    const skipBonus  = skipped > 0 ? skipped * 300 * score.combo : 0;
    score.current += basePoints + skipBonus;
    score.totalSuns++;
    score.lastSun = sun;

    // Floating score popups
    addPopup(`+${basePoints}`, sun.pos.x, sun.pos.y + sun.radius + 20, sun.tier.color);
    if (skipBonus > 0) {
      addPopup(`SKIP ×${skipped}  +${skipBonus}`, sun.pos.x, sun.pos.y + sun.radius + 42, '#ffaa00');
    }
  } else {
    // Returned to same sun — reset combo
    if (score.combo > 1) {
      addPopup('Combo lost!', sun.pos.x, sun.pos.y + sun.radius + 20, '#ff6666');
    }
    score.combo = 1;
  }

  score.distanceBase = sun.pos.y;

  if (score.current > score.best) score.best = score.current;
}

function updateDistanceScore(planetY) {
  // Award trickle points for altitude gain (only going up)
  const gain = planetY - score.distanceBase;
  if (gain > 100) {
    const pts = Math.floor(gain / 100) * DIST_POINTS_PER_100;
    score.current += pts;
    score.distanceBase += Math.floor(gain / 100) * 100;
    if (score.current > score.best) score.best = score.current;
  }
}

function resetScore() {
  score.current   = 0;
  score.combo     = 1;
  score.lastSun   = null;
  score.totalSuns = 0;
  score.distanceBase = 0;
  // best score persists across games
}

// ── Score popups ──────────────────────────────────────────────────────────────
const popups = [];

function addPopup(text, wx, wy, color) {
  popups.push({ text, wx, wy, color, life: 1.2, age: 0 });
}

function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].age += dt;
    popups[i].wy  += 30 * dt; // float upward in world coords
    if (popups[i].age >= popups[i].life) popups.splice(i, 1);
  }
}

function drawPopups(worldToScreen) {
  for (const p of popups) {
    const t   = p.age / p.life;
    const sp  = worldToScreen(p.wx, p.wy);
    const alpha = 1 - t * t;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 14px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillStyle = p.color || '#ffffff';
    ctx.fillText(p.text, sp.x, sp.y);
    ctx.restore();
  }
}
