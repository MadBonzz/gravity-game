// Math / vector helpers

const Vec2 = {
  add:    (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub:    (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  scale:  (v, s) => ({ x: v.x * s,   y: v.y * s }),
  dot:    (a, b) => a.x * b.x + a.y * b.y,
  len:    (v)    => Math.sqrt(v.x * v.x + v.y * v.y),
  len2:   (v)    => v.x * v.x + v.y * v.y,
  norm:   (v)    => { const l = Vec2.len(v); return l > 0 ? Vec2.scale(v, 1 / l) : { x: 0, y: 0 }; },
  dist:   (a, b) => Vec2.len(Vec2.sub(b, a)),
  dist2:  (a, b) => Vec2.len2(Vec2.sub(b, a)),
  perp:   (v)    => ({ x: -v.y, y: v.x }),  // 90° CCW
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}
