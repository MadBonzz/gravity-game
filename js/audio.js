// Synthesized audio via Web Audio API — no external files needed

const Audio = (() => {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Master gain (lets us mute everything at once)
  let masterGain = null;
  function getMaster() {
    if (!masterGain) {
      masterGain = getCtx().createGain();
      masterGain.gain.value = muted ? 0 : 0.28;
      masterGain.connect(getCtx().destination);
    }
    return masterGain;
  }

  function setMuted(v) {
    muted = v;
    if (masterGain) masterGain.gain.value = v ? 0 : 0.28;
  }

  function isMuted() { return muted; }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function osc(type, freq, startTime, duration, gainPeak, dest) {
    const ac = getCtx();
    const o  = ac.createOscillator();
    const g  = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    o.connect(g);
    g.connect(dest);
    o.start(startTime);
    o.stop(startTime + duration + 0.05);
  }

  function noise(startTime, duration, gainPeak, filterFreq, dest) {
    const ac  = getCtx();
    const buf = ac.createBuffer(1, ac.sampleRate * duration, ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const flt = ac.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = filterFreq;
    flt.Q.value = 1.5;
    const g = ac.createGain();
    g.gain.setValueAtTime(gainPeak, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    src.start(startTime);
    src.stop(startTime + duration);
  }

  // ── Sound definitions ─────────────────────────────────────────────────────

  // Launch whoosh — rising noise + short tone
  function playLaunch(power) {
    const ac   = getCtx();
    const dest = getMaster();
    const now  = ac.currentTime;
    const freq = 200 + power * 400;
    noise(now, 0.35, 0.4, freq, dest);
    osc('sine', freq * 0.5, now, 0.25, 0.3, dest);
  }

  // Orbit capture chime — pitch based on sun tier (smaller = higher)
  const CHIME_FREQS = [880, 660, 440, 330, 220]; // dwarf→giant
  function playCapture(tierIndex) {
    const ac   = getCtx();
    const dest = getMaster();
    const now  = ac.currentTime;
    const base = CHIME_FREQS[clamp(tierIndex, 0, 4)];
    // Two harmonics for a bell-like sound
    osc('sine',     base,      now,        0.7, 0.5, dest);
    osc('sine',     base * 2,  now,        0.4, 0.25, dest);
    osc('triangle', base * 0.5, now + 0.05, 0.3, 0.15, dest);
  }

  // Death explosion — low boom + noise burst
  function playDeath() {
    const ac   = getCtx();
    const dest = getMaster();
    const now  = ac.currentTime;
    noise(now, 0.6, 0.8, 180, dest);
    osc('sawtooth', 80,  now,        0.5, 0.6, dest);
    osc('sine',     40,  now + 0.05, 0.4, 0.5, dest);
    // Pitch-drop on the boom
    const o  = ac.createOscillator();
    const g  = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, now);
    o.frequency.exponentialRampToValueAtTime(30, now + 0.5);
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    o.connect(g); g.connect(dest);
    o.start(now); o.stop(now + 0.6);
  }

  // Lost-in-space warning ping
  function playWarningPing() {
    const ac   = getCtx();
    const dest = getMaster();
    const now  = ac.currentTime;
    osc('sine', 520, now, 0.3, 0.2, dest);
    osc('sine', 420, now + 0.15, 0.3, 0.15, dest);
  }

  // Milestone jingle — ascending arpeggio
  function playMilestone() {
    const ac   = getCtx();
    const dest = getMaster();
    const now  = ac.currentTime;
    const notes = [440, 550, 660, 880];
    notes.forEach((f, i) => osc('sine', f, now + i * 0.09, 0.35, 0.3, dest));
  }

  // Power bar tick (subtle) — very short blip
  function playPowerTick() {
    const ac   = getCtx();
    const dest = getMaster();
    const now  = ac.currentTime;
    osc('square', 1200, now, 0.04, 0.06, dest);
  }

  return { playLaunch, playCapture, playDeath, playWarningPing, playMilestone, playPowerTick, setMuted, isMuted };
})();
