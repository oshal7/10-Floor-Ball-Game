// Tilt10 level data.
//
// Every floor is authored in its own local coordinates: x runs 0..W and
// y runs 0..H, with the bottom SLAB pixels being the floor slab that the
// ball has to get through to reach the next floor. game.js stacks the
// floors vertically (floor i is offset by i * H).
//
// Shape kinds:
//   walls     – solid rectangles
//   segs      – solid capsules (angled walls / funnels)
//   glass     – breakable rectangles; `strength` is the impact speed (px/s)
//               that breaks a fresh pane in one hit. Weaker hits crack it,
//               and cracks persist for every later ball.
//   spikes    – kill the live ball on contact; its body stays impaled there
//   tiles     – crumble shortly after anything touches them (permanently)
//   plates    – pressure plates; pressed while any ball or body rests on them
//   doors     – solid until every plate in `plates` is pressed
//   pendulums – swinging hazards that shatter the live ball
//   zones     – reverse-gravity areas (vertical gravity is flipped inside)

export const W = 360;
export const H = 640;
export const SLAB = 20;

const R = (x, y, w, h, extra = {}) => ({ x, y, w, h, ...extra });
const S = (x1, y1, x2, y2, r = 6) => ({ x1, y1, x2, y2, r });

// Floor slab with gaps. holes: [[x0, x1], ...] sorted left to right.
function slab(holes) {
  const rects = [];
  let x = 0;
  for (const [a, b] of holes) {
    if (a > x) rects.push(R(x, H - SLAB, a - x, SLAB));
    x = b;
  }
  if (x < W) rects.push(R(x, H - SLAB, W - x, SLAB));
  return rects;
}

const tileRow = (x0, y, count, w, h) =>
  Array.from({ length: count }, (_, i) => R(x0 + i * w, y, w, h));

export const FLOOR_DEFS = [
  // ---------------------------------------------------------------- 1–3
  {
    name: 'First Drop',
    theme: 'Introduction',
    hue: 215,
    entryX: 180,
    hints: [
      [180, 110, 'TILT TO ROLL', 18],
      [180, 136, 'find the way down'],
      [180, 290, 'gravity always pulls down'],
      [180, 312, 'your tilt steers it'],
    ],
    walls: [R(70, 200, 290, 14), R(0, 380, 290, 14), ...slab([[0, 80]])],
  },
  {
    name: 'Funnels',
    theme: 'Introduction',
    hue: 200,
    entryX: 40,
    hints: [[220, 70, 'FUNNELS', 16]],
    segs: [S(0, 140, 150, 230), S(360, 140, 210, 230)],
    walls: [R(160, 330, 40, 40), R(0, 480, 140, 14), R(220, 480, 140, 14), ...slab([[290, 350]])],
  },
  {
    name: 'The Fallen',
    theme: 'Momentum',
    hue: 190,
    entryX: 320,
    hints: [
      [170, 220, 'SPIKES KEEP WHAT THEY KILL', 14],
      [170, 244, 'jump the pit with speed — or pave it'],
    ],
    walls: [
      R(0, 150, 280, 14),
      R(60, 300, 80, 14),
      R(140, 300, 10, 40),
      R(190, 300, 10, 40),
      R(200, 300, 160, 14),
      R(0, 470, 280, 14),
      ...slab([[0, 80]]),
    ],
    spikes: [R(150, 330, 40, 10)],
  },

  // ---------------------------------------------------------------- 4–6
  {
    name: 'Glass Floor',
    theme: 'Destruction',
    hue: 185,
    entryX: 40,
    hints: [
      [237, 210, 'GLASS', 18],
      [237, 238, 'shatters under a heavy fall'],
      [237, 260, 'tilt forward to slam'],
      [237, 320, 'cracks never heal'],
      [237, 342, 'and the dead still have weight'],
    ],
    walls: [R(100, 0, 14, 620), ...slab([[0, 100]])],
    glass: [R(0, 620, 100, 20, { strength: 1150 })],
  },
  {
    name: 'Pendulum Hall',
    theme: 'Impact',
    hue: 345,
    entryX: 50,
    hints: [
      [250, 220, 'BUILD SPEED', 16],
      [250, 244, 'glass walls crack sideways too'],
    ],
    walls: [R(0, 140, 300, 14), ...slab([[0, 90]])],
    glass: [R(120, 154, 16, 466, { strength: 600 })],
    pendulums: [
      { px: 215, py: 0, len: 125, amp: 0.85, period: 2.0, phase: 0, r: 18 },
      { px: 230, py: 330, len: 260, amp: 0.85, period: 2.6, phase: 1.3, r: 22 },
    ],
  },
  {
    name: 'Two Panes',
    theme: 'Destruction',
    hue: 165,
    entryX: 45,
    hints: [
      [247, 130, 'TWO PANES', 16],
      [247, 154, 'one fall, two breaks'],
      [247, 176, 'mind the blade'],
    ],
    walls: [R(120, 0, 14, 440), R(120, 540, 14, 80), ...slab([[0, 120]])],
    glass: [R(0, 300, 120, 12, { strength: 900 }), R(0, 620, 120, 20, { strength: 1000 })],
    pendulums: [{ px: 180, py: 380, len: 140, amp: 0.9, period: 1.7, phase: 0.5, r: 20 }],
  },

  // ---------------------------------------------------------------- 7–8
  {
    name: 'Pressure',
    theme: 'Switches',
    hue: 135,
    entryX: 60,
    hints: [
      [210, 70, 'PLATES HOLD DOORS', 16],
      [210, 94, 'only while something rests on them'],
      [180, 330, '⚓ ANCHOR gives a ball up for good', 13],
      [180, 352, 'its body stays where it settles', 13],
    ],
    walls: [R(0, 200, 300, 14), ...slab([[150, 210]])],
    plates: [R(20, 614, 60, 6, { id: '7a' })],
    doors: [R(150, 620, 60, 20, { plates: ['7a'] })],
  },
  {
    name: 'Sequence',
    theme: 'Switches',
    hue: 100,
    entryX: 180,
    hints: [
      [180, 110, 'ORDER MATTERS', 16],
      [180, 134, 'some doors hide other plates'],
    ],
    walls: [R(100, 240, 260, 14), R(230, 254, 14, 166), ...slab([[254, 304]])],
    plates: [R(20, 614, 60, 6, { id: '8a', label: '1' }), R(310, 614, 46, 6, { id: '8b', label: '2' })],
    doors: [R(230, 420, 14, 200, { plates: ['8a'] }), R(254, 620, 50, 20, { plates: ['8b'] })],
  },

  // ---------------------------------------------------------------- 9–10
  {
    name: 'Inversion',
    theme: 'Precision',
    hue: 270,
    entryX: 279,
    hints: [
      [150, 70, 'INVERSION', 16],
      [160, 196, 'gravity flips in the violet'],
      [160, 218, 'thread the needle over the wall'],
    ],
    walls: [
      R(40, 130, 320, 14),
      R(0, 250, 320, 14),
      R(150, 264, 50, 32),
      R(170, 330, 14, 290),
      ...slab([[0, 80]]),
    ],
    spikes: [R(110, 606, 60, 14)],
    zones: [R(184, 312, 176, 308)],
  },
  {
    name: 'The Crumbling Bottom',
    theme: 'Chaos',
    hue: 20,
    entryX: 40,
    hints: [
      [203, 300, "DON'T STOP", 18],
      [203, 326, 'tiles crumble under any weight'],
    ],
    walls: [
      R(0, 160, 90, 460),
      R(90, 210, 226, 410),
      R(314, 160, 16, 14),
      R(316, 174, 14, 446),
      ...slab([[330, 360]]),
    ],
    tiles: tileRow(90, 160, 8, 28, 12),
    spikes: [R(90, 200, 226, 10)],
    pendulums: [{ px: 210, py: 20, len: 128, amp: 0.9, period: 2.0, phase: 0, r: 18 }],
  },
];
