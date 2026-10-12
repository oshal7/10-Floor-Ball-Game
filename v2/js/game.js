import { B, WALL, FLOOR_DEFS } from './levels.js';

// ---------------------------------------------------------------- tuning
const FLOORS = FLOOR_DEFS.length;
const BALL_R = 10;
const ACCEL = 1100; // px/s^2 at full tilt
const ROLL_DAMP = 1.1; // per second
const MAX_SPEED = 750;
const STEER_RANGE = 130; // cursor distance (board px) for full tilt
const STEP = 1 / 240;
const BALL_LIFE = 60; // seconds each ball lives, across all floors
const FALL_TIME = 0.55;
const TILE_CRUMBLE = 0.55;
const GLASS_CRACKS = 3;
const DEPTH_ZOOM = 1.7; // how much bigger each floor looks than the one below

const params = new URLSearchParams(location.search);
const TOTAL_BALLS = clampInt(params.get('balls'), 1, 99, 12);
const START_FLOOR = clampInt(params.get('floor'), 1, FLOORS, 1) - 1; // dev: ?floor=7

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- world
let floors; // built per run from FLOOR_DEFS
let bodies = []; // { f, x, y, n, kind: 'body' | 'plug' }
let state = null;

function buildFloors() {
  return FLOOR_DEFS.map((def, f) => {
    const fl = {
      f, def,
      walls: (def.walls || []).map((r) => ({ ...r })),
      holes: (def.holes || []).map((h) => ({ ...h })),
      pits: (def.pits || []).map((p) => ({ ...p, plug: null })),
      glassWalls: (def.glassWalls || []).map((r) => ({ ...r, hp: 1, broken: false, flash: 0, cracks: makeCracks(r) })),
      glassFloors: (def.glassFloors || []).map((g) => ({ ...g, cracks: 0, broken: false, flash: 0, lines: makeRadialCracks(g) })),
      plates: (def.plates || []).map((p) => ({ ...p, pressed: false })),
      doors: (def.doors || []).map((d) => ({ ...d, t: 0, solid: true })),
      sweepers: (def.sweepers || []).map((s) => ({ ...s, a: s.phase })),
      zones: def.zones || [],
      cells: [],
    };
    if (def.grid) {
      const g = def.grid;
      const tiles = new Set(g.tiles.map(([c, r]) => `${c},${r}`));
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          fl.cells.push({
            x: g.x + c * g.cell, y: g.y + r * g.cell, w: g.cell, h: g.cell,
            state: tiles.has(`${c},${r}`) ? 'tile' : 'void', touchedAt: null, plug: null,
          });
        }
      }
    }
    fl.plateById = Object.fromEntries(fl.plates.map((p) => [p.id, p]));
    return fl;
  });
}

const BOUNDS = [
  { x: 0, y: 0, w: B, h: WALL },
  { x: 0, y: B - WALL, w: B, h: WALL },
  { x: 0, y: 0, w: WALL, h: B },
  { x: B - WALL, y: 0, w: WALL, h: B },
];

function makeCracks(r) {
  return Array.from({ length: 8 }, () => {
    let x = r.x + Math.random() * r.w, y = r.y + Math.random() * r.h;
    const pts = [[x, y]];
    for (let k = 0; k < 3; k++) {
      x = clamp(x + (Math.random() - 0.5) * 30, r.x, r.x + r.w);
      y = clamp(y + (Math.random() - 0.5) * 30, r.y, r.y + r.h);
      pts.push([x, y]);
    }
    return pts;
  });
}

function makeRadialCracks(g) {
  return Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
    const pts = [[g.x + (Math.random() - 0.5) * 6, g.y + (Math.random() - 0.5) * 6]];
    let d = 0;
    for (let k = 0; k < 3; k++) {
      d += g.r * (0.25 + Math.random() * 0.15);
      const aa = a + (Math.random() - 0.5) * 0.5;
      pts.push([g.x + Math.cos(aa) * Math.min(d, g.r - 1), g.y + Math.sin(aa) * Math.min(d, g.r - 1)]);
    }
    return pts;
  });
}

// ---------------------------------------------------------------- geometry
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
  const l = px - s.x, rr = s.x + s.w - px, t = py - s.y, b = s.y + s.h - py;
  const m = Math.min(l, rr, t, b);
  if (m === t) return { nx: 0, ny: -1, pen: t + r };
  if (m === b) return { nx: 0, ny: 1, pen: b + r };
  if (m === l) return { nx: -1, ny: 0, pen: l + r };
  return { nx: 1, ny: 0, pen: rr + r };
}

function hitCircle(px, py, r, cx, cy, cr) {
  const dx = px - cx, dy = py - cy;
  const d2 = dx * dx + dy * dy;
  const rr = r + cr;
  if (d2 > rr * rr || d2 < 1e-9) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, pen: rr - d };
}

function segDist(px, py, x1, y1, x2, y2) {
  const ex = x2 - x1, ey = y2 - y1;
  const t = clamp(((px - x1) * ex + (py - y1) * ey) / (ex * ex + ey * ey), 0, 1);
  return Math.hypot(px - (x1 + ex * t), py - (y1 + ey * t));
}

const inRect = (x, y, r, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

function resolve(b, c, bounce = 0.35) {
  b.x += c.nx * c.pen;
  b.y += c.ny * c.pen;
  const vn = b.vx * c.nx + b.vy * c.ny;
  if (vn < 0) {
    const e = -vn < 60 ? 0 : bounce;
    b.vx -= (1 + e) * vn * c.nx;
    b.vy -= (1 + e) * vn * c.ny;
  }
}

function* solids(fl) {
  yield* BOUNDS;
  yield* fl.walls;
  for (const d of fl.doors) if (d.solid) yield d;
  for (const g of fl.glassWalls) if (!g.broken) yield g;
}

// Every opening the ball can drop through: holes and broken glass floors.
function* openings(fl) {
  yield* fl.holes;
  for (const g of fl.glassFloors) if (g.broken) yield { x: g.x, y: g.y, r: g.r - 4 };
}

// ---------------------------------------------------------------- input
// The ball rolls toward the cursor (or finger). The further away the
// pointer, the steeper the "tilt", up to STEER_RANGE board pixels.
const input = { pointer: null, keys: new Set(), override: null };

function tilt() {
  let x = 0, y = 0;
  const b = state && state.ball;
  if (input.pointer && b && b.alive && !b.falling) {
    const p = screenToBoard(input.pointer.x, input.pointer.y);
    const dx = p.x - b.x, dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const k = Math.min(1, d / STEER_RANGE) / d;
      x = dx * k;
      y = dy * k;
    }
  }
  const k = input.keys;
  if (k.has('ArrowLeft') || k.has('a')) x -= 1;
  if (k.has('ArrowRight') || k.has('d')) x += 1;
  if (k.has('ArrowUp') || k.has('w')) y -= 1;
  if (k.has('ArrowDown') || k.has('s')) y += 1;
  if (input.override) ({ x, y } = input.override); // test hook
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y };
}

// ---------------------------------------------------------------- game state
function newGame() {
  floors = buildFloors();
  bodies = [];
  state = {
    phase: 'play',
    time: 0,
    ballNo: 0,
    ball: null,
    depth: START_FLOOR, // camera depth in floors (fractional while diving)
    particles: [],
    respawnAt: 0,
    deathAt: -10,
    bumpAt: 0,
    tiltVis: { x: 0, y: 0 },
  };
  spawnBall();
}

function spawnBall() {
  state.ballNo++;
  const [x, y] = FLOOR_DEFS[START_FLOOR].entries[0];
  state.ball = {
    f: START_FLOOR, x, y, vx: 0, vy: 0,
    n: state.ballNo, alive: true, falling: null, spawnT: 0,
    life: BALL_LIFE, inZone: false,
  };
  sfx.spawn();
}

// Put a dead ball down on floor f at (x, y); it may keep falling.
function placeBody(f, x, y, n) {
  if (f >= FLOORS) return; // dropped out of the shaft
  const fl = floors[f];
  for (const g of fl.glassFloors) {
    if (!g.broken && Math.hypot(x - g.x, y - g.y) < g.r) {
      crackGlassFloor(fl, g, 1);
      if (g.broken) return placeBody(f + 1, x, y, n);
    }
  }
  for (const h of openings(fl)) if (Math.hypot(x - h.x, y - h.y) < h.r) return placeBody(f + 1, x, y, n);
  const pit = pitAt(fl, x, y);
  if (pit) return plugPit(fl, pit, n);
  const o = { f, x, y, n, kind: 'body' };
  separate(o, fl);
  bodies.push(o);
}

function plugPit(fl, pit, n) {
  pit.plug = n;
  if (pit.w) pit.state = 'plugged';
  const cx = pit.w ? pit.x + pit.w / 2 : pit.x, cy = pit.w ? pit.y + pit.h / 2 : pit.y;
  bodies.push({ f: fl.f, x: cx, y: cy, n, kind: 'plug' });
}

function pitAt(fl, x, y) {
  for (const p of fl.pits) if (!p.plug && Math.hypot(x - p.x, y - p.y) < p.r - 4) return p;
  for (const c of fl.cells) if (c.state === 'void' && inRect(x, y, c, -3)) return c;
  return null;
}

// Nudge a resting body out of walls and other bodies.
function separate(o, fl) {
  for (let it = 0; it < 6; it++) {
    for (const s of solids(fl)) {
      const c = hitRect(o.x, o.y, BALL_R, s);
      if (c) { o.x += c.nx * c.pen; o.y += c.ny * c.pen; }
    }
    for (const q of bodies) {
      if (q === o || q.f !== fl.f || q.kind !== 'body') continue;
      const c = hitCircle(o.x, o.y, BALL_R, q.x, q.y, BALL_R);
      if (c) { o.x += c.nx * c.pen; o.y += c.ny * c.pen; }
    }
  }
}

const DEATH_MSG = {
  pit: (n) => `#${n} fell on the spikes — its body fills the pit`,
  crushed: (n) => `#${n} shattered by a sweeper`,
  timeout: (n) => `#${n} ran out of time — its body stays here`,
  stop: (n) => `#${n} stopped — its body stays here`,
};

function killBall(cause, pit) {
  const b = state.ball;
  if (!b || !b.alive) return;
  b.alive = false;
  state.deathAt = state.time;
  state.respawnAt = state.time + 0.9;
  const fl = floors[b.f];
  if (cause === 'crushed') {
    burst(b.f, b.x, b.y, '#ff4d6d', 30, 260);
    sfx.crush();
    vibrate([30, 40, 80]);
  } else if (cause === 'pit') {
    plugPit(fl, pit, b.n);
    burst(b.f, b.x, b.y, '#ff4d6d', 12, 120);
    sfx.crush();
    vibrate(80);
  } else {
    const o = { f: b.f, x: b.x, y: b.y, n: b.n, kind: 'body' };
    separate(o, fl);
    bodies.push(o);
    sfx.stop();
    vibrate(25);
    checkGlassWeight(fl);
  }
  const left = TOTAL_BALLS - state.ballNo;
  toast(DEATH_MSG[cause](b.n) + (left > 0 ? `  ·  ${left} left` : ''));
}

// End the current ball early (click / Space / two fingers). Same as its
// time running out: the body stays where it is.
function stopBall() {
  const b = state && state.ball;
  if (state && state.phase === 'play' && b && b.alive && !b.falling) killBall('stop');
}

function endGame(won) {
  state.phase = won ? 'won' : 'lost';
  setTimeout(() => showEnd(won), won ? 1400 : 900);
}

// ---------------------------------------------------------------- glass
function crackGlassFloor(fl, g, amount) {
  if (g.broken) return;
  g.cracks += amount;
  g.flash = 1;
  if (g.cracks >= GLASS_CRACKS) breakGlassFloor(fl, g);
  else { sfx.crack(); vibrate(15); }
}

function breakGlassFloor(fl, g) {
  if (g.broken) return;
  g.broken = true;
  shards(fl.f, g.x - g.r, g.y - g.r, g.r * 2, g.r * 2, 30);
  sfx.shatter();
  vibrate([20, 30, 60]);
  toast('Glass floor shattered');
  // Dead balls resting on it drop to the floor below.
  for (const o of bodies.slice()) {
    if (o.f === fl.f && o.kind === 'body' && Math.hypot(o.x - g.x, o.y - g.y) < g.r) {
      bodies.splice(bodies.indexOf(o), 1);
      placeBody(fl.f + 1, o.x, o.y, o.n);
    }
  }
  const b = state.ball;
  if (b && b.alive && !b.falling && b.f === fl.f && Math.hypot(b.x - g.x, b.y - g.y) < g.r) startFall();
}

// Two balls on one glass floor (live or dead) and it gives way.
function checkGlassWeight(fl) {
  for (const g of fl.glassFloors) {
    if (g.broken) continue;
    let n = 0;
    for (const o of bodies) if (o.f === fl.f && o.kind === 'body' && Math.hypot(o.x - g.x, o.y - g.y) < g.r) n++;
    const b = state.ball;
    if (b && b.alive && !b.falling && b.f === fl.f && Math.hypot(b.x - g.x, b.y - g.y) < g.r) n++;
    if (n >= 2) breakGlassFloor(fl, g);
  }
}

function damageGlassWall(fl, g, impact) {
  const thr = g.strength * 0.4;
  if (impact <= thr) return false;
  g.hp -= (impact - thr) / (g.strength - thr);
  g.flash = 1;
  if (g.hp <= 0) {
    g.broken = true;
    shards(fl.f, g.x, g.y, g.w, g.h, 26);
    sfx.shatter();
    vibrate([20, 30, 60]);
    toast('Glass wall shattered');
    return true;
  }
  sfx.crack();
  vibrate(15);
  return false;
}

// ---------------------------------------------------------------- simulation
function startFall() {
  const b = state.ball;
  b.falling = { t: 0 };
  b.vx = b.vy = 0;
  sfx.drop();
}

function land() {
  const b = state.ball;
  b.falling = null;
  b.f += 1;
  if (b.f >= FLOORS) {
    b.alive = false;
    sfx.win();
    vibrate([50, 50, 50, 50, 150]);
    endGame(true);
    return;
  }
  const fl = floors[b.f];
  sfx.land(b.f);
  vibrate(12);
  // Landing on glass cracks it.
  for (const g of fl.glassFloors) {
    if (!g.broken && Math.hypot(b.x - g.x, b.y - g.y) < g.r) {
      crackGlassFloor(fl, g, 1);
      if (g.broken) return; // breakGlassFloor already started the next fall
      checkGlassWeight(fl);
      if (b.falling) return;
    }
  }
  for (const h of openings(fl)) {
    if (Math.hypot(b.x - h.x, b.y - h.y) < h.r) { startFall(); return; }
  }
  const pit = pitAt(fl, b.x, b.y);
  if (pit) { killBall('pit', pit); return; }
  separate(b, fl);
}

function stepBall(dt) {
  const b = state.ball;
  const fl = floors[b.f];
  let t = tilt();
  b.inZone = fl.zones.some((z) => inRect(b.x, b.y, z));
  if (b.inZone) t = { x: -t.x, y: -t.y };

  b.vx += t.x * ACCEL * dt;
  b.vy += t.y * ACCEL * dt;

  // holes pull the ball in near their rim
  for (const h of openings(fl)) {
    const dx = h.x - b.x, dy = h.y - b.y;
    const d = Math.hypot(dx, dy);
    const reach = h.r + 8;
    if (d < reach && d > 0.01) {
      const pull = 700 * (1 - d / reach);
      b.vx += (dx / d) * pull * dt;
      b.vy += (dy / d) * pull * dt;
    }
  }

  const k = Math.max(0, 1 - ROLL_DAMP * dt);
  b.vx *= k;
  b.vy *= k;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  for (const s of solids(fl)) {
    const c = hitRect(b.x, b.y, BALL_R, s);
    if (!c) continue;
    const impact = Math.max(0, -(b.vx * c.nx + b.vy * c.ny));
    if (s.strength && damageGlassWall(fl, s, impact)) {
      b.vx *= 0.6;
      b.vy *= 0.6;
      continue;
    }
    resolve(b, c);
    if (impact > 120) bump(impact);
  }
  for (const s of fl.sweepers) {
    const c = hitCircle(b.x, b.y, BALL_R, s.cx, s.cy, 9);
    if (c) resolve(b, c);
  }
  for (const o of bodies) {
    if (o.f !== b.f || o.kind !== 'body') continue;
    const c = hitCircle(b.x, b.y, BALL_R, o.x, o.y, BALL_R);
    if (!c) continue;
    const impact = Math.max(0, -(b.vx * c.nx + b.vy * c.ny));
    resolve(b, c);
    if (impact > 120) bump(impact);
  }

  // hazards
  for (const s of fl.sweepers) {
    const ex = Math.cos(s.a) * s.len, ey = Math.sin(s.a) * s.len;
    if (segDist(b.x, b.y, s.cx, s.cy, s.cx + ex, s.cy + ey) < BALL_R + 4) {
      killBall('crushed');
      return;
    }
  }
  const pit = pitAt(fl, b.x, b.y);
  if (pit) { killBall('pit', pit); return; }

  // tiles start crumbling under the ball
  for (const c of fl.cells) {
    if (c.state === 'tile' && c.touchedAt === null && inRect(b.x, b.y, c, BALL_R * 0.6)) c.touchedAt = state.time;
  }

  for (const h of openings(fl)) {
    if (Math.hypot(b.x - h.x, b.y - h.y) < h.r - 3) { startFall(); return; }
  }
  checkGlassWeight(fl);
}

function updateWorld(dt) {
  const b = state.ball;
  for (const fl of floors) {
    for (const s of fl.sweepers) s.a = s.phase + s.speed * state.time;
    for (const p of fl.plates) {
      const was = p.pressed;
      p.pressed = bodies.some((o) => o.f === fl.f && o.kind === 'body' && inRect(o.x, o.y, p, 2)) ||
        (b && b.alive && !b.falling && b.f === fl.f && inRect(b.x, b.y, p, 2));
      if (p.pressed !== was && b && b.f === fl.f) sfx.click(p.pressed);
    }
    for (const d of fl.doors) {
      const open = d.plates.every((id) => fl.plateById[id].pressed);
      d.t = clamp(d.t + (open ? 1 : -1) * dt * 4, 0, 1);
      d.solid = d.t < 0.5;
    }
    for (const c of fl.cells) {
      if (c.state === 'tile' && c.touchedAt !== null && state.time - c.touchedAt > TILE_CRUMBLE) {
        c.state = 'void';
        shards(fl.f, c.x, c.y, c.w, c.h, 10, '#f2b13b');
        if (b && b.f === fl.f) sfx.crumble();
        // a dead ball resting on it sinks in and plugs the gap
        const o = bodies.find((q) => q.f === fl.f && q.kind === 'body' && inRect(q.x, q.y, c));
        if (o) {
          bodies.splice(bodies.indexOf(o), 1);
          plugPit(fl, c, o.n);
        }
      }
    }
    for (const g of fl.glassWalls) g.flash = Math.max(0, g.flash - dt * 4);
    for (const g of fl.glassFloors) g.flash = Math.max(0, g.flash - dt * 4);
  }
}

function substep(dt) {
  state.time += dt;
  const b = state.ball;
  if (state.phase === 'play' && b && b.alive) {
    if (b.falling) {
      b.falling.t += dt / FALL_TIME;
      if (b.falling.t >= 1) land();
    } else {
      stepBall(dt);
    }
  }
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

  if (state.phase === 'play' && b && b.alive && !b.falling) {
    b.spawnT = Math.min(1, b.spawnT + dt * 3);
    b.life -= dt;
    if (b.life <= 0) killBall('timeout');
  }

  // camera depth
  if (b && b.alive && b.falling) {
    state.depth = b.f + ease(clamp(b.falling.t, 0, 1));
  } else {
    let target = state.depth;
    if (b && b.alive) target = b.f;
    else if (state.phase === 'won') target = FLOORS;
    else if (state.phase === 'play' && state.time - state.deathAt > 0.6) target = START_FLOOR;
    const rate = Math.abs(target - state.depth) > 1.5 ? 4 : 7;
    state.depth += (target - state.depth) * Math.min(1, dt * rate);
    if (Math.abs(target - state.depth) < 0.002) state.depth = target;
  }

  if (state.phase === 'play' && b && !b.alive) {
    if (state.ballNo >= TOTAL_BALLS) {
      if (state.time - state.deathAt > 1.2) endGame(false);
    } else if (state.time >= state.respawnAt && Math.abs(state.depth - START_FLOOR) < 0.02) {
      spawnBall();
    }
  }

  // board lean follows the steering (purely visual)
  const t = state.phase === 'play' && b && b.alive && !b.falling ? tilt() : { x: 0, y: 0 };
  state.tiltVis.x += (t.x - state.tiltVis.x) * Math.min(1, dt * 8);
  state.tiltVis.y += (t.y - state.tiltVis.y) * Math.min(1, dt * 8);
  canvas.style.transform = `perspective(1100px) rotateX(${(-state.tiltVis.y * 5).toFixed(2)}deg) rotateY(${(state.tiltVis.x * 5).toFixed(2)}deg)`;

  for (const p of state.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 3 * dt;
    p.vy *= 1 - 3 * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  updateHud();
}

function bump(impact) {
  if (state.time - state.bumpAt < 0.08) return;
  state.bumpAt = state.time;
  sfx.bump(Math.min(1, impact / 700));
  if (impact > 350) vibrate(10);
}

function burst(f, x, y, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    state.particles.push({ f, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7, color, size: 2 + Math.random() * 2.5 });
  }
}

function shards(f, x, y, w, h, count, color = '#bff0ff') {
  for (let i = 0; i < count; i++) {
    state.particles.push({
      f, x: x + Math.random() * w, y: y + Math.random() * h,
      vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300,
      life: 0.9, max: 0.9, color, size: 2 + Math.random() * 3,
    });
  }
}

// ---------------------------------------------------------------- view
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const view = { cx: 0, cy: 0, bs: 1, dpr: 1, cw: 0, ch: 0 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const topPad = 70, botPad = 86;
  const size = Math.min(cw - 24, ch - topPad - botPad);
  view.bs = size / B;
  view.cx = cw / 2;
  view.cy = topPad + (ch - topPad - botPad) / 2;
  view.dpr = dpr;
  view.cw = cw;
  view.ch = ch;
}

function floorScale(f) {
  return Math.pow(DEPTH_ZOOM, (state ? state.depth : 0) - f);
}

function screenToBoard(sx, sy) {
  const b = state && state.ball;
  const s = view.bs * floorScale(b ? b.f : 0);
  return { x: (sx - view.cx) / s + B / 2, y: (sy - view.cy) / s + B / 2 };
}

function render() {
  resize();
  const { dpr, cw, ch } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, cw, ch);
  if (!floors) return;

  const depth = state ? state.depth : 0;
  const top = Math.max(0, Math.floor(depth));
  // Deepest first so nearer floors cover them except through their holes.
  for (let f = Math.min(FLOORS, top + 2); f >= top; f--) {
    const s = floorScale(f);
    const past = depth - f; // > 0: we are diving past this floor
    if (past >= 1) continue;
    const alpha = past > 0 ? 1 - past : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setTransform(dpr * view.bs * s, 0, 0, dpr * view.bs * s, dpr * view.cx, dpr * view.cy);
    ctx.translate(-B / 2, -B / 2);
    if (f === FLOORS) drawBottom();
    else drawFloor(floors[f]);
    // darken floors that are still below us
    if (past < 0) {
      ctx.fillStyle = `rgba(5,6,10,${Math.min(0.8, -past * 0.6)})`;
      ctx.fillRect(0, 0, B, B);
    }
    ctx.restore();
  }

  // the live ball (drawn on top, sized for its depth while falling)
  const b = state && state.ball;
  if (b && b.alive) {
    const bf = b.f + (b.falling ? clamp(b.falling.t, 0, 1) : 0);
    const s = view.bs * Math.pow(DEPTH_ZOOM, depth - bf);
    const x = view.cx + (b.x - B / 2) * s, y = view.cy + (b.y - B / 2) * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grow = 1 + (1 - b.spawnT) * 1.2;
    ctx.globalAlpha = b.spawnT * 0.7 + 0.3;
    drawBall(x, y, BALL_R * s * grow, b.n, b.inZone);
    ctx.globalAlpha = 1;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPointer();
  drawShaftMeter();
}

function drawBottom() {
  const g = ctx.createRadialGradient(B / 2, B / 2, 10, B / 2, B / 2, B * 0.7);
  g.addColorStop(0, '#ffe08a');
  g.addColorStop(1, '#6b4a00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, B, B);
  ctx.fillStyle = 'rgba(40,25,0,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText('THE BOTTOM', B / 2, B / 2);
}

function drawFloor(fl) {
  const def = fl.def;
  const time = state ? state.time : 0;

  // floor surface with the openings cut out (the floor below shows through)
  ctx.beginPath();
  ctx.rect(0, 0, B, B);
  for (const h of openings(fl)) {
    ctx.moveTo(h.x + h.r, h.y);
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2, true);
  }
  const grad = ctx.createLinearGradient(0, 0, B, B);
  grad.addColorStop(0, `hsl(${def.hue}, 26%, 17%)`);
  grad.addColorStop(1, `hsl(${def.hue}, 22%, 11%)`);
  ctx.fillStyle = grad;
  ctx.fill('evenodd');

  // subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 40; i < B; i += 40) {
    ctx.moveTo(i, WALL); ctx.lineTo(i, B - WALL);
    ctx.moveTo(WALL, i); ctx.lineTo(B - WALL, i);
  }
  ctx.stroke();

  // big floor number + label
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.font = `900 170px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(fl.f + 1), B / 2, B / 2 + 8);

  // hole rims (inner shadow)
  for (const h of openings(fl)) {
    const g = ctx.createRadialGradient(h.x, h.y, h.r * 0.4, h.x, h.y, h.r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(154,216,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // inverted zones
  for (const z of fl.zones) {
    ctx.fillStyle = 'rgba(150,90,255,0.16)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(190,150,255,0.28)';
    ctx.lineWidth = 2;
    const off = (time * 25) % 40;
    for (let yy = z.y - 40 + off; yy < z.y + z.h + 40; yy += 40) {
      for (let xx = z.x + 20; xx < z.x + z.w; xx += 40) {
        ctx.beginPath();
        ctx.arc(xx, yy, 6, 0.3, Math.PI * 1.7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // hints
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [x, y, text, size = 11] of def.hints || []) {
    ctx.font = `${size >= 13 ? 800 : 500} ${size}px ${FONT}`;
    ctx.fillStyle = size >= 13 ? 'rgba(225,232,248,0.55)' : 'rgba(205,214,232,0.42)';
    ctx.fillText(text, x, y);
  }

  // crumbling grid
  for (const c of fl.cells) {
    if (c.state === 'void') {
      ctx.fillStyle = '#030305';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = 'rgba(255,77,109,0.5)';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.arc(c.x + 5 + i * 10, c.y + 5 + j * 10, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (c.state === 'tile') {
      let jx = 0, jy = 0, a = 1;
      if (c.touchedAt !== null) {
        const k = clamp((time - c.touchedAt) / TILE_CRUMBLE, 0, 1);
        jx = (Math.random() - 0.5) * 3 * k;
        jy = (Math.random() - 0.5) * 3 * k;
        a = 1 - k * 0.45;
      }
      ctx.fillStyle = '#030305';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = `rgba(242,177,59,${a})`;
      ctx.fillRect(c.x + 1.5 + jx, c.y + 1.5 + jy, c.w - 3, c.h - 3);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(c.x + 1.5 + jx, c.y + c.h - 5 + jy, c.w - 3, 3.5);
    } else {
      ctx.fillStyle = '#030305';
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }
  }

  // spike pits
  for (const p of fl.pits) {
    ctx.fillStyle = '#0a0306';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    if (!p.plug) {
      ctx.fillStyle = '#ff4d6d';
      const n = Math.max(6, Math.round(p.r * 0.7));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r);
        ctx.lineTo(p.x + Math.cos(a) * p.r * 0.35, p.y + Math.sin(a) * p.r * 0.35);
        ctx.lineTo(p.x + Math.cos(a + 0.35) * p.r, p.y + Math.sin(a + 0.35) * p.r);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,77,109,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // glass floors
  for (const g of fl.glassFloors) {
    if (g.broken) continue;
    ctx.fillStyle = '#05060a';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(150,225,255,${0.22 + g.flash * 0.35})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,240,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const lines = Math.round((g.cracks / GLASS_CRACKS) * g.lines.length);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (let i = 0; i < lines; i++) {
      const c = g.lines[i];
      ctx.beginPath();
      ctx.moveTo(c[0][0], c[0][1]);
      for (let k = 1; k < c.length; k++) ctx.lineTo(c[k][0], c[k][1]);
      ctx.stroke();
    }
  }

  // plates + wiring to their doors
  for (const d of fl.doors) {
    for (const id of d.plates) {
      const p = fl.plateById[id];
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = p.pressed ? 'rgba(61,220,151,0.6)' : 'rgba(255,210,63,0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2, p.y + p.h / 2);
      ctx.lineTo(d.x + d.w / 2, d.y + d.h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const p of fl.plates) {
    ctx.fillStyle = p.pressed ? 'rgba(61,220,151,0.35)' : 'rgba(43,122,92,0.35)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = p.pressed ? '#3ddc97' : '#2b7a5c';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
    if (p.label) {
      ctx.fillStyle = p.pressed ? '#3ddc97' : 'rgba(61,220,151,0.6)';
      ctx.font = `900 20px ${FONT}`;
      ctx.fillText(p.label, p.x + p.w / 2, p.y + p.h / 2);
    }
  }

  // dead balls: plugs sit flush in their pit, bodies are obstacles
  for (const o of bodies) {
    if (o.f !== fl.f) continue;
    if (o.kind === 'plug') {
      ctx.fillStyle = '#3c4254';
      ctx.beginPath();
      ctx.arc(o.x, o.y, BALL_R + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(210,216,230,0.7)';
      ctx.font = `800 9px ${FONT}`;
      ctx.fillText(String(o.n), o.x, o.y + 0.5);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(o.x + 3, o.y + 4, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(o.x - 3, o.y - 4, 1, o.x, o.y, BALL_R);
      g.addColorStop(0, '#9aa2b6');
      g.addColorStop(1, '#3f4556');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e1e6f0';
      ctx.font = `800 9px ${FONT}`;
      ctx.fillText(String(o.n), o.x, o.y + 0.5);
    }
  }

  // raised blocks: shadow, then top face
  const blocks = [...BOUNDS, ...fl.walls];
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (const w of blocks) ctx.fillRect(w.x + 3, w.y + 5, w.w, w.h);
  for (const w of blocks) {
    ctx.fillStyle = '#aeb7c9';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = '#d6dceb';
    ctx.fillRect(w.x, w.y, w.w, Math.max(2, w.h - 3));
  }
  for (const d of fl.doors) if (d.t < 1) drawDoor(d);
  for (const g of fl.glassWalls) {
    if (g.broken) continue;
    ctx.fillStyle = `rgba(150,225,255,${0.3 + g.flash * 0.4})`;
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = 'rgba(200,245,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(g.x + 0.75, g.y + 0.75, g.w - 1.5, g.h - 1.5);
    const n = Math.ceil((1 - g.hp) * g.cracks.length);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const c = g.cracks[i];
      ctx.beginPath();
      ctx.moveTo(c[0][0], c[0][1]);
      for (let k = 1; k < c.length; k++) ctx.lineTo(c[k][0], c[k][1]);
      ctx.stroke();
    }
  }

  // sweepers
  for (const s of fl.sweepers) {
    const ex = s.cx + Math.cos(s.a) * s.len, ey = s.cy + Math.sin(s.a) * s.len;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(s.cx + 4, s.cy + 6);
    ctx.lineTo(ex + 4, ey + 6);
    ctx.stroke();
    ctx.strokeStyle = '#ff4d6d';
    ctx.shadowColor = '#ff4d6d';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(s.cx, s.cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd0d8';
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // particles
  for (const p of state ? state.particles : []) {
    if (p.f !== fl.f) continue;
    ctx.save();
    ctx.globalAlpha *= clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }

  // floor label
  ctx.fillStyle = `hsla(${def.hue}, 60%, 15%, 0.9)`;
  ctx.font = `800 8px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${String(fl.f + 1).padStart(2, '0')} · ${def.name.toUpperCase()} · ${def.theme.toUpperCase()}`, 6, 6.5);
}

function drawDoor(d) {
  ctx.save();
  const k = 1 - d.t;
  ctx.beginPath();
  // slides into the wall along its long side
  if (d.w >= d.h) ctx.rect(d.x, d.y, d.w * k, d.h);
  else ctx.rect(d.x, d.y, d.w, d.h * k);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(d.x + 3, d.y + 5, d.w, d.h);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  const span = d.w + d.h;
  for (let i = -span; i < span; i += 9) {
    ctx.beginPath();
    ctx.moveTo(d.x + i, d.y);
    ctx.lineTo(d.x + i + span, d.y + span);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(x, y, r, n, inZone) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y + r * 0.45, r, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, inZone ? '#b48cff' : '#8fc9f0');
  ctx.fillStyle = g;
  ctx.shadowColor = inZone ? '#b48cff' : '#9ad8ff';
  ctx.shadowBlur = r * 1.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b0d12';
  ctx.font = `800 ${Math.max(8, r * 0.85).toFixed(1)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

// A soft line from the ball to the cursor shows the pull.
function drawPointer() {
  const b = state && state.ball;
  if (!input.pointer || !b || !b.alive || b.falling || state.phase !== 'play') return;
  const s = view.bs * floorScale(b.f);
  const bx = view.cx + (b.x - B / 2) * s, by = view.cy + (b.y - B / 2) * s;
  const { x, y } = input.pointer;
  const d = Math.hypot(x - bx, y - by);
  if (d < 6) return;
  const strength = Math.min(1, d / (STEER_RANGE * s));
  ctx.strokeStyle = `rgba(154,216,255,${0.12 + strength * 0.25})`;
  ctx.setLineDash([2, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(154,216,255,0.6)';
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
}

// A small depth gauge: ten floors, dead balls marked per floor.
function drawShaftMeter() {
  if (!state) return;
  const boardRight = view.cx + (B / 2) * view.bs;
  if (view.cw - boardRight < 30) return; // no room beside the board
  const x = view.cw - 18, y0 = view.cy - 90, h = 180, cell = h / FLOORS;
  for (let f = 0; f < FLOORS; f++) {
    const cur = state.ball && state.ball.alive && state.ball.f === f;
    ctx.fillStyle = cur ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y0 + f * cell + 1, 6, cell - 2);
    const dead = bodies.filter((o) => o.f === f).length;
    ctx.fillStyle = '#9aa3b8';
    for (let i = 0; i < Math.min(dead, 4); i++) ctx.fillRect(x - 5 - i * 4, y0 + f * cell + cell / 2 - 1, 3, 2);
  }
}

// ---------------------------------------------------------------- hud
const hud = { floor: $('hud-floor'), name: $('hud-name'), balls: $('hud-balls'), timer: $('hud-timer') };
let hudCache = '';
function updateHud() {
  const b = state.ball;
  const fi = clamp(Math.round(state.depth), 0, FLOORS - 1);
  const live = !!(b && b.alive);
  const secs = live ? Math.max(0, Math.ceil(b.life)) : 0;
  const key = `${fi}|${state.ballNo}|${live}|${secs}`;
  if (key !== hudCache) {
    hudCache = key;
    hud.floor.textContent = `FLOOR ${fi + 1}/${FLOORS}`;
    hud.name.textContent = live ? `${FLOOR_DEFS[fi].name} · ${secs}s left` : FLOOR_DEFS[fi].name;
    let html = '';
    for (let i = 1; i <= TOTAL_BALLS; i++) {
      const cls = i < state.ballNo || (i === state.ballNo && !live) ? 'used' : i === state.ballNo ? 'live' : '';
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
    best = parseInt(localStorage.getItem('tilt10v2.best'), 10) || null;
    if (won && (!best || used < best)) {
      localStorage.setItem('tilt10v2.best', String(used));
      best = used;
    }
  } catch { /* storage unavailable */ }
  $('end-title').textContent = won ? 'BREACHED' : 'OUT OF BALLS';
  $('end-text').textContent = won
    ? `You reached the bottom with ball #${used} of ${TOTAL_BALLS}.`
    : `${bodies.length} dead balls are left in the shaft. They're cleared when you start again.`;
  $('end-best').textContent = best ? `Best: ${best} ball${best === 1 ? '' : 's'}` : '';
  $('end').classList.remove('hidden');
}

// ---------------------------------------------------------------- audio & haptics
let actx = null;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
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
  drop: () => tone(520, 0.45, 'sine', 0.05, 140),
  land: (f) => tone(180 + f * 25, 0.12, 'triangle', 0.07),
  bump: (k) => tone(120 + k * 120, 0.06, 'triangle', 0.03 + k * 0.06),
  crack: () => noise(0.08, 0.06, 3000),
  shatter: () => { noise(0.45, 0.14, 1800); tone(1800, 0.25, 'triangle', 0.03, 900); },
  crumble: () => noise(0.15, 0.05, 400),
  crush: () => { tone(200, 0.25, 'sawtooth', 0.05, 50); noise(0.2, 0.06, 600); },
  stop: () => tone(300, 0.3, 'sine', 0.06, 120),
  click: (on) => tone(on ? 900 : 500, 0.05, 'square', 0.025),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.06), i * 120)),
};
function vibrate(p) {
  try { navigator.vibrate && navigator.vibrate(p); } catch { /* unsupported */ }
}

// ---------------------------------------------------------------- wiring
function start() {
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  $('title').classList.add('hidden');
  $('end').classList.add('hidden');
  newGame();
}

$('start').addEventListener('click', start);
$('again').addEventListener('click', start);

window.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === ' ') { stopBall(); e.preventDefault(); return; }
  if (k.startsWith('Arrow')) e.preventDefault();
  input.keys.add(k);
});
window.addEventListener('keyup', (e) => input.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => { input.keys.clear(); input.pointer = null; });

// Mouse: hovering steers. Touch/pen: steer while the finger is down.
// Over the HUD or buttons the board levels out.
window.addEventListener('pointermove', (e) => {
  if (e.target !== canvas) { input.pointer = null; return; }
  if (e.pointerType === 'mouse' || e.buttons) input.pointer = { x: e.clientX, y: e.clientY };
});
// A mouse click ends the current ball (the cursor never has to leave it);
// on touch screens a second finger does the same.
const touches = new Set();
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') {
    if (e.button === 0) stopBall();
    return;
  }
  touches.add(e.pointerId);
  if (touches.size >= 2) { stopBall(); return; }
  input.pointer = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
const release = (e) => {
  if (e.pointerType === 'mouse') return;
  touches.delete(e.pointerId);
  if (touches.size === 0) input.pointer = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
document.addEventListener('mouseleave', () => { input.pointer = null; });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); stopBall(); });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state) update(dt);
  render();
  requestAnimationFrame(frame);
}

floors = buildFloors(); // drawn behind the title screen
requestAnimationFrame(frame);

// Test/debug hook.
window.tilt10 = {
  get state() { return state; },
  get floors() { return floors; },
  get bodies() { return bodies; },
  input,
  stopBall,
  start,
};
