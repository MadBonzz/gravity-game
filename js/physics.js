// Physics constants and gravity simulation

const PHYSICS = {
  G: 500,           // Gravitational constant (tuned for game feel)
  SOFTENING: 200,   // Softening factor squared — prevents singularity at r→0
  MIN_ORBIT_CHECK_INTERVAL: 0.1, // seconds between orbit-capture checks
};

/**
 * Compute gravitational acceleration on `target` from a list of `sources`.
 * Uses: a = G * M / (r^2 + softening) * unit_vector
 * Returns: { x, y } acceleration vector
 */
function computeGravity(target, sources) {
  let ax = 0, ay = 0;

  for (const src of sources) {
    if (src === target) continue;
    const dx = src.pos.x - target.pos.x;
    const dy = src.pos.y - target.pos.y;
    const r2 = dx * dx + dy * dy + PHYSICS.SOFTENING;
    const force = PHYSICS.G * src.mass / r2;
    const r = Math.sqrt(r2);
    ax += force * dx / r;
    ay += force * dy / r;
  }

  return { x: ax, y: ay };
}

/**
 * Integrate velocity and position using semi-implicit Euler (symplectic).
 * Better energy conservation than plain Euler for orbits.
 * dt in seconds.
 */
function integrate(body, accel, dt) {
  body.vel.x += accel.x * dt;
  body.vel.y += accel.y * dt;
  body.pos.x += body.vel.x * dt;
  body.pos.y += body.vel.y * dt;
}

/**
 * Compute the circular orbital speed around `sun` at distance `r`.
 * v = sqrt(G * M / r)
 */
function orbitalSpeed(sun, r) {
  return Math.sqrt(PHYSICS.G * sun.mass / r);
}

/**
 * Compute escape velocity from `sun` at distance `r`.
 * v_esc = sqrt(2 * G * M / r)
 */
function escapeVelocity(sun, r) {
  return Math.sqrt(2 * PHYSICS.G * sun.mass / r);
}

/**
 * Given a planet's position and velocity relative to a sun,
 * return the orbital energy (negative = bound orbit).
 * E = 0.5 * v^2 - G*M/r
 */
function orbitalEnergy(planet, sun) {
  const r = Vec2.dist(planet.pos, sun.pos);
  const v2 = Vec2.len2(planet.vel);
  return 0.5 * v2 - PHYSICS.G * sun.mass / r;
}

/**
 * Determine which sun (if any) the planet is gravitationally bound to.
 * Returns the sun with the lowest (most negative) specific orbital energy,
 * provided that energy is negative (bound). Returns null if unbound to all.
 */
function findBoundSun(planet, suns) {
  let best = null;
  let bestEnergy = 0; // must be negative to be bound

  for (const sun of suns) {
    const e = orbitalEnergy(planet, sun);
    if (e < bestEnergy) {
      bestEnergy = e;
      best = sun;
    }
  }

  return best;
}
