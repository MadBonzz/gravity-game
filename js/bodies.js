// Game body definitions: Sun, Planet, BlackHole

// Sun size tiers — radius maps to mass and visual style
const SUN_TIERS = [
  { name: 'dwarf',   radius: 28,  massMultiplier: 0.6,  color: '#ff4d4d', coreColor: '#ffb3b3', glowColor: 'rgba(255,77,77,0.35)' },
  { name: 'small',   radius: 40,  massMultiplier: 1.0,  color: '#ffa64d', coreColor: '#ffd9b3', glowColor: 'rgba(255,166,77,0.3)' },
  { name: 'medium',  radius: 56,  massMultiplier: 1.8,  color: '#ffdf80', coreColor: '#fff2cc', glowColor: 'rgba(255,223,128,0.25)' },
  { name: 'large',   radius: 75,  massMultiplier: 3.2,  color: '#b3d9ff', coreColor: '#e6f2ff', glowColor: 'rgba(179,217,255,0.2)' },
  { name: 'giant',   radius: 100, massMultiplier: 6.0,  color: '#99ccff', coreColor: '#ffffff', glowColor: 'rgba(153,204,255,0.2)' },
];

// Base mass unit — scaled by multiplier per tier
const BASE_MASS = 8000;

class Sun {
  constructor(x, y, tierIndex) {
    const tier = SUN_TIERS[clamp(tierIndex, 0, SUN_TIERS.length - 1)];
    this.pos    = { x, y };
    this.vel    = { x: 0, y: 0 };
    this.radius = tier.radius;
    this.mass   = BASE_MASS * tier.massMultiplier;
    this.tier   = tier;
    this.angle  = 0; // for surface animation
    // Point score awarded for orbiting a smaller sun (harder = more points)
    this.scoreValue = Math.round(1000 / tier.massMultiplier);
  }
}

class BlackHole {
  constructor(x, y) {
    this.pos           = { x, y };
    this.vel           = { x: 0, y: 0 };
    this.radius        = 22;
    this.eventHorizonR = 70;   // point of no return — cross this and you're consumed
    this.mass          = BASE_MASS * 12; // very strong pull
    this.isBlackHole   = true;
  }
}

const PLANET_RADIUS = 10;

class Planet {
  constructor(x, y) {
    this.pos    = { x, y };
    this.vel    = { x: 0, y: 0 };
    this.radius = PLANET_RADIUS;
    this.mass   = 1;  // planet mass negligible — doesn't affect suns

    // Orbit state
    this.orbitSun   = null;   // Sun currently orbiting
    this.orbitPhase = 0;      // angle around orbitSun (radians)
    this.orbitRadius = 0;     // distance from orbitSun center
    this.orbitDir   = 1;      // +1 CCW, -1 CW

    // Jump state
    this.frozen     = false;  // spacebar held — planet frozen
    this.launched   = false;  // has left orbit
    this.trail      = [];     // recent positions for motion trail
  }
}
