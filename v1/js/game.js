import { W, H, FLOOR_DEFS } from './levels.js';

// ---------------------------------------------------------------- tuning
const FLOORS = FLOOR_DEFS.length;
const BALL_R = 11;
const G = 1400; // full gravity, px/s^2
const TILT_DEG = 25; // degrees of tilt for full steering
const STEP = 1 / 240; // physics substep
const MAX_SPEED = 1900;
const BALL_LIFE = 60; // seconds each ball lives, across all floors
const TILE_CRUMBLE = 0.3; // seconds from first touch to collapse

const params = new URLSearchParams(location.search);
const TOTAL_BALLS = clampInt(params.get('balls'), 1, 99, 12);
const START_FLOOR = clampInt(params.get('floor'), 1, FLOORS, 1) - 1; // dev: ?floor=7

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- world
let world;
let bodies = []; // dead balls: { x, y, vx, vy, n, state: 'static' | 'loose', supports, still }
let state;

function buildWorld() {
  const w = { buckets: [], plates: [], doors: [], tiles: [], glass: [], pendulums: [], zones: [], hints: [] };
  for (let i = 0; i <= FLOORS; i++) w.buckets.push([]);
  const add = (s, fi) => w.buckets[fi].push(s);

  FLOOR_DEFS.forEach((f, fi) => {
    const oy = fi * H;
    const rect = (r, kind, extra = {}) => ({ kind, x: r.x, y: r.y + oy, w: r.w, h: r.h, floor: fi, ...extra });

    for (const r of f.walls || []) add(rect(r, 'wall'), fi);
    for (const s of f.segs || []) add({ kind: 'seg', x1: s.x1, y1: s.y1 + oy, x2: s.x2, y2: s.y2 + oy, r: s.r, floor: fi }, fi);
    for (const r of f.spikes || []) add(rect(r, 'spike'), fi);
    for (const r of f.glass || []) {
      const g = rect(r, 'glass', { strength: r.strength, hp: 1, broken: false, flash: 0, cracks: makeCracks(r, oy) });
      add(g, fi);
      w.glass.push(g);
    }
    for (const r of f.tiles || []) {
      const t = rect(r, 'tile', { touchedAt: null, gone: false });
      add(t, fi);
      w.tiles.push(t);
    }
    for (const d of f.doors || []) {
      const door = rect(d, 'door', { plates: d.plates, t: 0, solid: true });
      add(door, fi);
      w.doors.push(door);
    }
    for (const p of f.plates || []) w.plates.push(rect(p, 'plate', { id: p.id, label: p.label || '', pressed: false }));
    for (const p of f.pendulums || []) w.pendulums.push({ ...p, py: p.py + oy, floor: fi, bx: p.px, by: p.py + oy + p.len });
    for (const z of f.zones || []) w.zones.push(rect(z, 'zone'));
    for (const h of f.hints || []) w.hints.push({ x: h[0], y: h[1] + oy, text: h[2], size: h[3] || 12 });
  });

  w.plateById = Object.fromEntries(w.plates.map((p) => [p.id, p]));
  // Shaft walls and the lid above floor 1.
  w.bounds = [
    { kind: 'wall', x: -40, y: -60, w: 40, h: FLOORS * H + 400 },
    { kind: 'wall', x: W, y: -60, w: 40, h: FLOORS * H + 400 },
    { kind: 'wall', x: -40, y: -60, w: W + 80, h: 60 },
  ];
  return w;
}

function makeCracks(r, oy) {
  const cracks = [];
  for (let i = 0; i < 8; i++) {
    const pts = [];
    let x = r.x + Math.random() * r.w;
    let y = r.y + oy + Math.random() * r.h;
    pts.push([x, y]);
    for (let k = 0; k < 3; k++) {
      x = clamp(x + (Math.random() - 0.5) * Math.max(16, r.w * 0.5), r.x, r.x + r.w);
      y = clamp(y + (Math.random() - 0.5) * Math.max(10, r.h * 0.5), r.y + oy, r.y + oy + r.h);
      pts.push([x, y]);
    }
    cracks.push(pts);
  }
  return cracks;
}

function isSolid(s) {
  switch (s.kind) {
    case 'glass': return !s.broken;
    case 'tile': return !s.gone;
    case 'door': return s.solid;
    default: return true;
  }
}

// ---------------------------------------------------------------- collision primitives
function hitRect(px, py, r, s) {
  const cx = clamp(px, s.x, s.x + s.w);
  const cy = clamp(py, s.y, s.y + s.h);
  const dx = px - cx, dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, pen: r - d };
  }
  // Centre is inside the rectangle: push out along the shallowest axis.
  const l = px - s.x, rr = s.x + s.w - px, t = py - s.y, b = s.y + s.h - py;
  const m = Math.min(l, rr, t, b);
  if (m === t) return { nx: 0, ny: -1, pen: t + r };
  if (m === b) return { nx: 0, ny: 1, pen: b + r };
  if (m === l) return { nx: -1, ny: 0, pen: l + r };
  return { nx: 1, ny: 0, pen: rr + r };
}

function hitSeg(px, py, r, s) {
  const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
  const t = clamp(((px - s.x1) * ex + (py - s.y1) * ey) / (ex * ex + ey * ey), 0, 1);
  return hitCircle(px, py, r, s.x1 + ex * t, s.y1 + ey * t, s.r);
}

function hitCircle(px, py, r, cx, cy, cr) {
  const dx = px - cx, dy = py - cy;
  const d2 = dx * dx + dy * dy;
  const rr = r + cr;
  if (d2 > rr * rr || d2 < 1e-9) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, pen: rr - d };
}

const hitShape = (px, py, r, s) => (s.kind === 'seg' ? hitSeg(px, py, r, s) : hitRect(px, py, r, s));
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function resolve(b, c) {
  b.x += c.nx * c.pen;
  b.y += c.ny * c.pen;
  const vn = b.vx * c.nx + b.vy * c.ny;
  if (vn < 0) {
    const e = -vn < 90 ? 0 : 0.32;
    b.vx -= (1 + e) * vn * c.nx;
    b.vy -= (1 + e) * vn * c.ny;
    // a touch of rolling friction along the surface
    const tx = -c.ny, ty = c.nx;
    const vt = b.vx * tx + b.vy * ty;
    b.vx -= vt * tx * 0.0015;
    b.vy -= vt * ty * 0.0015;
  }
  b.contact = true;
}

function* nearbySolids(y) {
  const fi = clamp(Math.floor(y / H), 0, FLOORS - 1);
  for (let k = fi - 1; k <= fi + 1; k++) {
    const bucket = world.buckets[k];
    if (!bucket) continue;
    for (const s of bucket) if (isSolid(s)) yield s;
  }
  yield* world.bounds;
}

// ---------------------------------------------------------------- input
const input = { motion: false, raw: null, neutral: null, keys: new Set(), drag: null };

function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  const angle = screen.orientation && typeof screen.orientation.angle === 'number'
    ? screen.orientation.angle
    : window.orientation || 0;
  const b = e.beta, g = e.gamma;
  let x, y;
  switch ((angle + 360) % 360) {
    case 90: x = b; y = -g; break;
    case 270: x = -b; y = g; break;
    case 180: x = -g; y = -b; break;
    default: x = g; y = b;
  }
  input.raw = { x, y };
  if (!input.motion) {
    input.motion = true;
    calibrate();
  }
}

function calibrate() {
  if (input.raw) input.neutral = { ...input.raw };
}

function tilt() {
  let x = 0, y = 0;
  if (input.motion && input.raw && input.neutral) {
    x += (input.raw.x - input.neutral.x) / TILT_DEG;
    y += (input.raw.y - input.neutral.y) / TILT_DEG;
  }
  const k = input.keys;
  if (k.has('ArrowLeft') || k.has('a')) x -= 1;
  if (k.has('ArrowRight') || k.has('d')) x += 1;
  if (k.has('ArrowUp') || k.has('w')) y -= 1;
  if (k.has('ArrowDown') || k.has('s')) y += 1;
  if (input.drag) {
    x += (input.drag.x - input.drag.sx) / 70;
    y += (input.drag.y - input.drag.sy) / 70;
  }
  if (input.override) ({ x, y } = input.override); // test hook
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y };
}

// Gravity always keeps a downward component (this is a descent), the tilt
// steers sideways and changes how hard the ball falls.
function gravityFor(b, steer) {
  let gx = 0, gy = G * 0.55;
  if (steer) {
    const t = tilt();
    gx = G * 0.8 * t.x;
    gy = G * (0.55 + 0.45 * t.y);
  }
  b.inZone = world.zones.some((z) => inRect(b.x, b.y, z));
  if (b.inZone) gy = -gy;
  return [gx, gy];
}

// ---------------------------------------------------------------- game state
function newGame() {
  world = buildWorld();
  bodies = [];
  state = {
    phase: 'play',
    time: 0,
    ballNo: 0,
    ball: null,
    particles: [],
    camY: START_FLOOR * H,
    respawnAt: 0,
    deathAt: -10,
    bumpAt: 0,
    endAt: null,
  };
  spawnBall();
}

function spawnBall() {
  state.ballNo++;
  const f = FLOOR_DEFS[START_FLOOR];
  state.ball = {
    x: f.entryX + (Math.random() - 0.5) * 4,
    y: START_FLOOR * H + (START_FLOOR === 0 ? 40 : 14),
    vx: 0,
    vy: 40,
    n: state.ballNo,
    alive: true,
    maxFloor: START_FLOOR,
    life: BALL_LIFE,
    contact: false,
    inZone: false,
  };
  sfx.spawn();
}

function makeBody(x, y, vx, vy, n) {
  return { x, y, vx, vy, n, state: 'loose', supports: [], still: 0, contact: false, inZone: false, gone: false };
}

function settle(o) {
  o.state = 'static';
  o.vx = o.vy = 0;
  o.supports = [];
  for (const s of nearbySolids(o.y)) {
    if ((s.kind === 'glass' || s.kind === 'tile' || s.kind === 'door') && hitShape(o.x, o.y, BALL_R + 2, s)) {
      o.supports.push(s);
    }
  }
}

// A support vanished (glass broke, tile crumbled, door opened): bodies resting
// on it come loose and fall.
function releaseSupported(shape) {
  for (const o of bodies) {
    if (o.state === 'static' && o.supports.includes(shape)) {
      o.state = 'loose';
      o.still = 0;
    }
  }
}

const DEATH_MSG = {
  spike: (n) => `#${n} impaled — its body stays on the spikes`,
  crushed: (n) => `#${n} shattered by a pendulum`,
  timeout: (n) => `#${n} ran out of time — its body stays here`,
};

function killBall(cause) {
  const b = state.ball;
  if (!b || !b.alive) return;
  b.alive = false;
  state.deathAt = state.time;
  state.respawnAt = state.time + 1.0;

  if (cause === 'crushed') {
    burst(b.x, b.y, '#ff4d6d', 30, 380);
    sfx.crush();
    vibrate([30, 40, 80]);
  } else {
    const o = makeBody(b.x, b.y, cause === 'spike' ? 0 : b.vx, cause === 'spike' ? 0 : b.vy, b.n);
    if (cause === 'spike') settle(o);
    bodies.push(o);
    if (cause === 'spike') { burst(b.x, b.y, '#ff4d6d', 12, 160); sfx.crush(); vibrate(80); }
    else { sfx.still(); vibrate(25); }
  }
  toast(DEATH_MSG[cause](b.n) + (state.ballNo >= TOTAL_BALLS ? '' : `  ·  ${TOTAL_BALLS - state.ballNo} left`));
}

function endGame(won) {
  state.phase = won ? 'won' : 'lost';
  state.endAt = state.time;
  setTimeout(() => showEnd(won), won ? 1200 : 900);
}

// ---------------------------------------------------------------- simulation
function stepBody(b, dt, isBall) {
  const [gx, gy] = gravityFor(b, isBall);
  b.vx += gx * dt;
  b.vy += gy * dt;
  const k = Math.max(0, 1 - (b.inZone ? 2.4 : 0.12) * dt);
  b.vx *= k;
  b.vy *= k;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) {
    b.vx *= MAX_SPEED / sp;
    b.vy *= MAX_SPEED / sp;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.contact = false;

  for (const s of nearbySolids(b.y)) {
    const c = hitShape(b.x, b.y, BALL_R, s);
    if (!c) continue;
    const impact = Math.max(0, -(b.vx * c.nx + b.vy * c.ny));
    if (s.kind === 'glass' && damageGlass(s, impact)) {
      b.vx *= 0.7;
      b.vy *= 0.7;
      continue; // smashed straight through
    }
    if (s.kind === 'tile' && s.touchedAt === null) s.touchedAt = state.time;
    resolve(b, c);
    if (isBall) {
      if (s.kind === 'spike') {
        killBall('spike');
        return;
      }
      if (impact > 160) bump(impact);
    }
  }

  const others = isBall ? bodies : [...bodies, ...(state.ball && state.ball.alive ? [state.ball] : [])];
  for (const o of others) {
    if (o === b || o.gone) continue;
    const c = hitCircle(b.x, b.y, BALL_R, o.x, o.y, BALL_R);
    if (!c) continue;
    const impact = Math.max(0, -(b.vx * c.nx + b.vy * c.ny));
    // Landing on a body that rests on glass drives the blow into the glass.
    if (o.state === 'static' && impact > 0) {
      for (const s of o.supports) if (s.kind === 'glass' && !s.broken) damageGlass(s, impact * 0.9);
    }
    resolve(b, c);
    if (isBall && impact > 160) bump(impact);
  }
}

function damageGlass(s, impact) {
  const thr = s.strength * 0.35;
  if (impact <= thr) return false;
  s.hp -= (impact - thr) / (s.strength - thr);
  s.flash = 1;
  if (s.hp <= 0) {
    s.broken = true;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    for (let i = 0; i < 26; i++) {
      state.particles.push({
        x: s.x + Math.random() * s.w, y: s.y + Math.random() * s.h,
        vx: (Math.random() - 0.5) * 420, vy: (Math.random() - 0.7) * 380,
        life: 1.2, max: 1.2, color: '#aeeaff', size: 2 + Math.random() * 3, grav: true,
      });
    }
    burst(cx, cy, '#e6fbff', 8, 200);
    sfx.shatter();
    vibrate([20, 30, 60]);
    toast('Glass shattered');
    releaseSupported(s);
    return true;
  }
  sfx.crack();
  vibrate(15);
  return false;
}

function bump(impact) {
  if (state.time - state.bumpAt < 0.08) return;
  state.bumpAt = state.time;
  sfx.bump(Math.min(1, impact / 1200));
  if (impact > 500) vibrate(10);
}

function updatePendulums() {
  for (const p of world.pendulums) {
    const a = p.amp * Math.sin((Math.PI * 2 * state.time) / p.period + p.phase);
    p.a = a;
    p.bx = p.px + Math.sin(a) * p.len;
    p.by = p.py + Math.cos(a) * p.len;
  }
}

function updateBall(dt) {
  const b = state.ball;
  stepBody(b, dt, true);
  if (!b.alive) return;

  for (const p of world.pendulums) {
    if (Math.abs(p.by - b.y) > H) continue;
    if (Math.hypot(p.bx - b.x, p.by - b.y) < BALL_R + p.r - 2) {
      killBall('crushed');
      return;
    }
  }

  const fi = Math.floor(b.y / H);
  if (fi > b.maxFloor && fi < FLOORS) {
    b.maxFloor = fi;
    sfx.floor(fi);
    vibrate(12);
  }
  if (b.y > FLOORS * H + 40) {
    b.alive = false;
    sfx.win();
    vibrate([50, 50, 50, 50, 150]);
    endGame(true);
  }
}

function updateLoose(o, dt) {
  stepBody(o, dt, false);
  if (o.contact && Math.hypot(o.vx, o.vy) < 14) o.still += dt;
  else o.still = 0;
  if (o.still > 0.25) settle(o);
  if (o.y > FLOORS * H + 120) o.gone = true;
}

function updateWorld(dt) {
  // plates
  const pressers = bodies.filter((o) => !o.gone);
  if (state.ball && state.ball.alive) pressers.push(state.ball);
  for (const p of world.plates) {
    const was = p.pressed;
    p.pressed = pressers.some((o) => o.x >= p.x - 6 && o.x <= p.x + p.w + 6 && o.y >= p.y - 18 && o.y <= p.y + p.h + 2);
    if (p.pressed !== was) sfx.click(p.pressed);
  }
  // doors
  for (const d of world.doors) {
    const open = d.plates.every((id) => world.plateById[id].pressed);
    d.t = clamp(d.t + (open ? 1 : -1) * dt * 4, 0, 1);
    const solid = d.t < 0.5;
    if (d.solid && !solid) releaseSupported(d);
    d.solid = solid;
  }
  // tiles
  for (const t of world.tiles) {
    if (!t.gone && t.touchedAt !== null && state.time - t.touchedAt > TILE_CRUMBLE) {
      t.gone = true;
      for (let i = 0; i < 10; i++) {
        state.particles.push({
          x: t.x + Math.random() * t.w, y: t.y + Math.random() * t.h,
          vx: (Math.random() - 0.5) * 80, vy: Math.random() * 60,
          life: 0.9, max: 0.9, color: '#f2b13b', size: 2 + Math.random() * 3, grav: true,
        });
      }
      sfx.crumble();
      releaseSupported(t);
    }
  }
}

function substep(dt) {
  state.time += dt;
  updatePendulums();
  if (state.ball && state.ball.alive && state.phase === 'play') updateBall(dt);
  for (const o of bodies) if (o.state === 'loose' && !o.gone) updateLoose(o, dt);
  updateWorld(dt);
}

let acc = 0;
function update(dt) {
  acc += dt;
  while (acc >= STEP) {
    substep(STEP);
    acc -= STEP;
  }

  const b = state.ball;
  if (state.phase === 'play' && b && b.alive) {
    b.life -= dt;
    if (b.life <= 0) killBall('timeout');
  }

  if (state.phase === 'play' && b && !b.alive) {
    if (state.ballNo >= TOTAL_BALLS) {
      if (state.time - state.deathAt > 1.2) endGame(false);
    } else if (state.time >= state.respawnAt && Math.abs(state.camY - START_FLOOR * H) < 30) {
      spawnBall();
    }
  }

  // camera
  let target = state.camY;
  if (b && b.alive) target = clamp(Math.floor(b.y / H), 0, FLOORS - 1) * H;
  else if (state.phase === 'play' && state.time - state.deathAt > 0.55) target = START_FLOOR * H;
  const dist = Math.abs(target - state.camY);
  const speed = dist > H * 1.5 ? 5 : 9;
  state.camY += (target - state.camY) * Math.min(1, dt * speed);

  // particles & glass flashes
  for (const p of state.particles) {
    p.life -= dt;
    if (p.grav) p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const g of world.glass) g.flash = Math.max(0, g.flash - dt * 4);
  bodies = bodies.filter((o) => !o.gone);

  updateHud();
}

function burst(x, y, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7, color, size: 2 + Math.random() * 2.5, grav: true });
  }
}

// ---------------------------------------------------------------- rendering
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const view = { scale: 1, ox: 0, oy: 0, cw: 0, ch: 0 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const topPad = 64, botPad = 84;
  const scale = Math.min(cw / W, (ch - topPad - botPad) / H);
  view.scale = scale;
  view.ox = (cw - W * scale) / 2;
  view.oy = topPad + Math.max(0, (ch - topPad - botPad - H * scale) / 2);
  view.cw = cw;
  view.ch = ch;
  view.dpr = dpr;
}

function render() {
  resize();
  const { dpr, scale, ox, oy, cw, ch } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#06070b';
  ctx.fillRect(0, 0, cw, ch);
  if (!world) return;

  const camY = state ? state.camY : 0;
  const time = state ? state.time : performance.now() / 1000;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * (oy - camY * scale));

  const top = camY - oy / scale;
  const bottom = camY + (ch - oy) / scale;
  const f0 = Math.max(0, Math.floor(top / H));
  const f1 = Math.min(FLOORS - 1, Math.floor(bottom / H));
  const visible = (y0, y1) => y1 >= top - 40 && y0 <= bottom + 40;

  // floor backgrounds
  for (let f = f0; f <= f1; f++) {
    const def = FLOOR_DEFS[f];
    const y = f * H;
    const grad = ctx.createLinearGradient(0, y, 0, y + H);
    grad.addColorStop(0, `hsl(${def.hue}, 28%, 10%)`);
    grad.addColorStop(1, `hsl(${def.hue}, 22%, 6%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.font = `900 150px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(f + 1), W - 12, y + 150);
    ctx.fillStyle = `hsla(${def.hue}, 60%, 75%, 0.45)`;
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${String(f + 1).padStart(2, '0')} · ${def.name.toUpperCase()} · ${def.theme.toUpperCase()}`, 8, y + 14);
  }
  // abyss / exit below the last floor
  if (bottom > FLOORS * H) {
    const y = FLOORS * H;
    const grad = ctx.createLinearGradient(0, y, 0, y + 200);
    grad.addColorStop(0, 'rgba(255,214,102,0.25)');
    grad.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, W, 200);
  }

  // reverse-gravity zones
  for (const z of world.zones) {
    if (!visible(z.y, z.y + z.h)) continue;
    ctx.fillStyle = 'rgba(150,90,255,0.16)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(190,150,255,0.35)';
    ctx.lineWidth = 2;
    const off = (time * 50) % 40;
    for (let yy = z.y + z.h + 40 - off; yy > z.y - 20; yy -= 40) {
      for (let xx = z.x + 22; xx < z.x + z.w; xx += 44) {
        ctx.beginPath();
        ctx.moveTo(xx - 6, yy + 5);
        ctx.lineTo(xx, yy - 1);
        ctx.lineTo(xx + 6, yy + 5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // hints
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of world.hints) {
    if (!visible(h.y, h.y)) continue;
    const big = h.size >= 14;
    ctx.font = `${big ? 800 : 500} ${h.size}px ${FONT}`;
    ctx.fillStyle = big ? 'rgba(220,228,245,0.55)' : 'rgba(200,210,230,0.38)';
    ctx.fillText(h.text, h.x, h.y);
  }

  // plate → door wiring
  for (const d of world.doors) {
    for (const id of d.plates) {
      const p = world.plateById[id];
      if (!visible(Math.min(p.y, d.y), Math.max(p.y, d.y))) continue;
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = p.pressed ? 'rgba(61,220,151,0.55)' : 'rgba(255,210,63,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2, p.y);
      ctx.lineTo(p.x + p.w / 2, p.y - 24);
      ctx.lineTo(d.x + d.w / 2, p.y - 24);
      ctx.lineTo(d.x + d.w / 2, d.y + d.h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // plates
  for (const p of world.plates) {
    if (!visible(p.y, p.y + p.h)) continue;
    const sink = p.pressed ? 3 : 0;
    ctx.fillStyle = p.pressed ? '#3ddc97' : '#2b7a5c';
    ctx.shadowColor = p.pressed ? '#3ddc97' : 'transparent';
    ctx.shadowBlur = p.pressed ? 12 : 0;
    ctx.fillRect(p.x, p.y + sink, p.w, p.h - sink);
    ctx.shadowBlur = 0;
    if (p.label) {
      ctx.fillStyle = 'rgba(61,220,151,0.8)';
      ctx.font = `800 11px ${FONT}`;
      ctx.fillText(p.label, p.x + p.w / 2, p.y - 32);
    }
  }

  // tiles
  for (const t of world.tiles) {
    if (t.gone || !visible(t.y, t.y + t.h)) continue;
    let jx = 0, jy = 0, a = 1;
    if (t.touchedAt !== null) {
      const k = clamp((time - t.touchedAt) / TILE_CRUMBLE, 0, 1);
      jx = (Math.random() - 0.5) * 3 * k;
      jy = Math.random() * 2 * k;
      a = 1 - k * 0.5;
    }
    ctx.fillStyle = `rgba(242,177,59,${a})`;
    ctx.fillRect(t.x + 1 + jx, t.y + jy, t.w - 2, t.h);
    ctx.fillStyle = `rgba(0,0,0,0.25)`;
    ctx.fillRect(t.x + 1 + jx, t.y + t.h - 3 + jy, t.w - 2, 3);
  }

  // glass
  for (const g of world.glass) {
    if (g.broken || !visible(g.y, g.y + g.h)) continue;
    ctx.fillStyle = `rgba(150,225,255,${0.2 + g.flash * 0.35})`;
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = 'rgba(190,240,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(g.x + 0.75, g.y + 0.75, g.w - 1.5, g.h - 1.5);
    const n = Math.ceil((1 - g.hp) * g.cracks.length);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const c = g.cracks[i];
      ctx.beginPath();
      ctx.moveTo(c[0][0], c[0][1]);
      for (let k = 1; k < c.length; k++) ctx.lineTo(c[k][0], c[k][1]);
      ctx.stroke();
    }
  }

  // solids
  for (let f = Math.max(0, f0 - 1); f <= f1; f++) {
    for (const s of world.buckets[f]) {
      if (s.kind === 'wall') {
        if (!visible(s.y, s.y + s.h)) continue;
        if (s.w > 60 && s.h > 60) {
          // big filler blocks: dark body with a bright rim so they don't glare
          ctx.fillStyle = '#1b2030';
          ctx.fillRect(s.x, s.y, s.w, s.h);
          ctx.strokeStyle = '#cdd5e3';
          ctx.lineWidth = 2;
          ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
        } else {
          ctx.fillStyle = '#cdd5e3';
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
      } else if (s.kind === 'seg') {
        ctx.strokeStyle = '#cdd5e3';
        ctx.lineWidth = s.r * 2;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      } else if (s.kind === 'spike') {
        if (!visible(s.y, s.y + s.h)) continue;
        ctx.fillStyle = '#5a1f2b';
        ctx.fillRect(s.x, s.y + s.h * 0.6, s.w, s.h * 0.4);
        ctx.fillStyle = '#ff4d6d';
        const n = Math.max(1, Math.round(s.w / 10));
        const sw = s.w / n;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          ctx.moveTo(s.x + i * sw, s.y + s.h);
          ctx.lineTo(s.x + i * sw + sw / 2, s.y);
          ctx.lineTo(s.x + (i + 1) * sw, s.y + s.h);
        }
        ctx.fill();
      } else if (s.kind === 'door') {
        if (s.t >= 1 || !visible(s.y, s.y + s.h)) continue;
        drawDoor(s);
      }
    }
  }

  // dead balls
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const o of bodies) {
    if (!visible(o.y - 20, o.y + 20)) continue;
    ctx.fillStyle = o.state === 'loose' ? '#596178' : '#4a5163';
    ctx.strokeStyle = '#7a8399';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(o.x, o.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d3d9e6';
    ctx.font = `800 9px ${FONT}`;
    ctx.fillText(String(o.n), o.x, o.y + 0.5);
  }

  // pendulums
  for (const p of world.pendulums) {
    if (!visible(p.py - 20, p.py + p.len + 30)) continue;
    ctx.strokeStyle = 'rgba(255,77,109,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.px, p.py);
    ctx.lineTo(p.bx, p.by);
    ctx.stroke();
    ctx.fillStyle = '#ff9aac';
    ctx.beginPath();
    ctx.arc(p.px, p.py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff4d6d';
    ctx.shadowColor = '#ff4d6d';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(p.bx, p.by, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // live ball
  const b = state && state.ball;
  if (b && b.alive) {
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = b.inZone ? '#b48cff' : '#9ad8ff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0d12';
    ctx.font = `800 9px ${FONT}`;
    ctx.fillText(String(b.n), b.x, b.y + 0.5);
  }

  // particles
  for (const p of state ? state.particles : []) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // ----- screen space overlays
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Keep the current floor in focus: hide what's above (behind the HUD) and
  // dim the peek at the floor below.
  const floorTop = oy - (camY - Math.round(camY / H) * H) * scale;
  const floorBot = floorTop + H * scale;
  ctx.fillStyle = 'rgba(6,7,11,0.92)';
  ctx.fillRect(0, 0, cw, Math.max(0, floorTop));
  ctx.fillStyle = 'rgba(6,7,11,0.6)';
  ctx.fillRect(0, floorBot, cw, Math.max(0, ch - floorBot));
  drawMinimap();
  drawTiltIndicator();
  if (input.drag) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(input.drag.sx, input.drag.sy, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const dx = clamp(input.drag.x - input.drag.sx, -70, 70), dy = clamp(input.drag.y - input.drag.sy, -70, 70);
    ctx.beginPath();
    ctx.arc(input.drag.sx + dx, input.drag.sy + dy, 18, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDoor(d) {
  ctx.save();
  let x = d.x, y = d.y, w = d.w, h = d.h;
  const k = 1 - d.t;
  ctx.beginPath();
  if (w >= h) {
    // trapdoor: two leaves slide apart
    const half = (w / 2) * k;
    ctx.rect(x, y, half, h);
    ctx.rect(x + w - half, y, half, h);
  } else {
    // gate: lifts upward
    ctx.rect(x, y, w, h * k);
  }
  ctx.clip();
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  for (let i = -h; i < w + h; i += 9) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i - h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMinimap() {
  if (!state) return;
  const { ox, oy, scale, ch } = view;
  const mh = Math.min(260, ch - oy - 110);
  if (mh < 80) return;
  const mw = 6;
  const x = ox + W * scale - mw - 6;
  const y0 = oy + 24;
  const cell = mh / FLOORS;
  const b = state.ball;
  const cur = b && b.alive ? Math.floor(b.y / H) : -1;
  for (let f = 0; f < FLOORS; f++) {
    ctx.fillStyle = f === cur ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y0 + f * cell + 1, mw, cell - 2);
  }
  ctx.fillStyle = '#9aa3b8';
  for (const o of bodies) {
    const yy = y0 + (o.y / H) * cell;
    ctx.fillRect(x - 4, yy - 1, 3, 2);
  }
  if (b && b.alive) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + mw / 2, y0 + clamp(b.y / H, 0, FLOORS) * cell, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTiltIndicator() {
  if (!state || state.phase !== 'play') return;
  const t = tilt();
  const { ox, oy } = view;
  const cx = ox + 26, cy = oy + 40, r = 14;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(154,216,255,0.85)';
  ctx.beginPath();
  ctx.arc(cx + t.x * r, cy + t.y * r, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- hud
const hud = { floor: $('hud-floor'), name: $('hud-name'), balls: $('hud-balls'), timer: $('hud-timer') };
let hudCache = '';
function updateHud() {
  const b = state.ball;
  const fi = b && b.alive ? clamp(Math.floor(b.y / H), 0, FLOORS - 1) : clamp(Math.round(state.camY / H), 0, FLOORS - 1);
  const live = !!(b && b.alive);
  const secs = live ? Math.max(0, Math.ceil(b.life)) : 0;
  const key = `${fi}|${state.ballNo}|${live}|${secs}`;
  if (key !== hudCache) {
    hudCache = key;
    hud.floor.textContent = `FLOOR ${fi + 1}/${FLOORS}`;
    hud.name.textContent = live ? `${FLOOR_DEFS[fi].name} · ${secs}s left` : FLOOR_DEFS[fi].name;
    let html = '';
    for (let i = 1; i <= TOTAL_BALLS; i++) {
      const cls = i < state.ballNo || (i === state.ballNo && !(b && b.alive)) ? 'used' : i === state.ballNo ? 'live' : '';
      html += `<i class="${cls}"></i>`;
    }
    hud.balls.innerHTML = html;
  }
  const frac = live ? clamp(b.life / BALL_LIFE, 0, 1) : 0;
  hud.timer.style.transform = `scaleX(${frac})`;
  hud.timer.classList.toggle('low', frac < 0.25);
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function showEnd(won) {
  const used = state.ballNo;
  let best = null;
  try {
    best = parseInt(localStorage.getItem('tilt10.best'), 10) || null;
    if (won && (!best || used < best)) {
      localStorage.setItem('tilt10.best', String(used));
      best = used;
    }
  } catch { /* storage unavailable */ }
  $('end-title').textContent = won ? 'BREACHED' : 'OUT OF BALLS';
  $('end-text').textContent = won
    ? `You reached the bottom with ball #${used} of ${TOTAL_BALLS}.`
    : `${bodies.length} bodies remain in the shaft. They'll be gone next run.`;
  $('end-best').textContent = best ? `Best: ${best} ball${best === 1 ? '' : 's'}` : '';
  $('end').classList.remove('hidden');
}

// ---------------------------------------------------------------- audio & haptics
let actx = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { actx = null; }
}
function tone(f, d, type = 'sine', v = 0.06, f2 = null) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + d + 0.02);
}
function noise(d, v = 0.08, hp = 2000) {
  if (!actx) return;
  const len = Math.floor(actx.sampleRate * d);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const filt = actx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = hp;
  const g = actx.createGain();
  g.gain.value = v;
  src.connect(filt).connect(g).connect(actx.destination);
  src.start();
}
const sfx = {
  spawn: () => tone(660, 0.12, 'sine', 0.04, 880),
  bump: (k) => tone(120 + k * 120, 0.06, 'triangle', 0.03 + k * 0.06),
  crack: () => noise(0.08, 0.06, 3000),
  shatter: () => { noise(0.45, 0.14, 1800); tone(1800, 0.25, 'triangle', 0.03, 900); },
  crumble: () => noise(0.15, 0.05, 400),
  crush: () => { tone(200, 0.25, 'sawtooth', 0.05, 50); noise(0.2, 0.06, 600); },
  still: () => tone(300, 0.3, 'sine', 0.06, 120),
  click: (on) => tone(on ? 900 : 500, 0.05, 'square', 0.025),
  floor: (fi) => tone(330 + fi * 40, 0.1, 'sine', 0.035),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.06), i * 120)),
};
function vibrate(p) {
  try { navigator.vibrate && navigator.vibrate(p); } catch { /* unsupported */ }
}

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && state.phase === 'play') keepAwake();
});

// ---------------------------------------------------------------- wiring
async function start() {
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch { /* denied: fall back to touch */ }
  window.addEventListener('deviceorientation', onOrientation);
  keepAwake();
  $('title').classList.add('hidden');
  $('end').classList.add('hidden');
  newGame();
  setTimeout(() => {
    if (!input.motion) toast('No tilt sensor found — drag on screen or use arrow keys');
    else toast('Hold the phone how it feels natural — that is "level"');
  }, 1200);
}

$('start').addEventListener('click', start);
$('again').addEventListener('click', start);
$('calib').addEventListener('click', () => {
  calibrate();
  toast(input.motion ? 'Tilt recalibrated' : 'No tilt sensor — drag or use arrow keys');
});

window.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'c') calibrate();
  if (k.startsWith('Arrow')) e.preventDefault();
  input.keys.add(k);
});
window.addEventListener('keyup', (e) => {
  input.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
});
window.addEventListener('blur', () => input.keys.clear());

canvas.addEventListener('pointerdown', (e) => {
  if (!state || state.phase !== 'play') return;
  canvas.setPointerCapture(e.pointerId);
  input.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (input.drag && input.drag.id === e.pointerId) {
    input.drag.x = e.clientX;
    input.drag.y = e.clientY;
  }
});
const endDrag = (e) => { if (input.drag && input.drag.id === e.pointerId) input.drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state) update(dt);
  render();
  requestAnimationFrame(frame);
}

world = buildWorld(); // drawn behind the title screen
requestAnimationFrame(frame);

// Test/debug hook.
window.tilt10 = {
  get state() { return state; },
  get world() { return world; },
  get bodies() { return bodies; },
  input,
  start,
};
