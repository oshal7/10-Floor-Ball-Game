// Tilt10 v2 level data: ten square boards seen from above.
//
// Each floor is a B x B board (an outer wall is added automatically). The
// ball drops through a hole and lands on the next floor at the SAME x/y, so
// every floor's `entries` must line up with the holes of the floor above.
//
// Shape kinds:
//   walls       – solid blocks
//   holes       – the way down: { x, y, r }
//   pits        – spike pits { x, y, r }: kill the ball, and its body then
//                 plugs the pit so later balls roll straight over
//   glassWalls  – breakable blocks; `strength` = impact speed that breaks a
//                 fresh one in one hit; weaker hits crack it (permanently)
//   glassFloors – glass discs over a hole { x, y, r }. Every ball that lands
//                 on one cracks it (3 cracks = broken), and it breaks at once
//                 when two balls (live or dead) are on it together
//   plates      – pressure plates, pressed while a ball or body sits on them
//   doors       – solid until every plate in `plates` is pressed
//   sweepers    – rotating arms { cx, cy, len, speed, phase } that shatter the
//                 live ball
//   zones       – inverted-control areas
//   grid        – crumbling bridge over a void: { x, y, cell, cols, rows,
//                 tiles: [[col, row], ...] }. Cells without a tile are void
//                 (deadly). Tiles crumble shortly after anything touches them.

export const B = 400;
export const WALL = 12;

const R = (x, y, w, h, extra = {}) => ({ x, y, w, h, ...extra });

export const FLOOR_DEFS = [
  // ---------------------------------------------------------------- 1–3
  {
    name: 'First Drop',
    theme: 'Introduction',
    hue: 215,
    entries: [[70, 70]],
    hints: [
      [250, 62, 'THE BALL ROLLS TOWARD YOUR CURSOR', 11],
      [250, 82, 'find the hole and drop through', 11],
    ],
    walls: [R(12, 140, 290, 16), R(98, 260, 290, 16)],
    holes: [{ x: 330, y: 330, r: 18 }],
  },
  {
    name: 'Pits',
    theme: 'Introduction',
    hue: 200,
    entries: [[330, 330]],
    hints: [[280, 375, 'SPIKE PITS KILL', 11]],
    walls: [R(156, 170, 16, 218)],
    pits: [
      { x: 250, y: 250, r: 16 },
      { x: 300, y: 130, r: 16 },
      { x: 205, y: 70, r: 16 },
      { x: 105, y: 115, r: 16 },
    ],
    holes: [{ x: 80, y: 330, r: 18 }],
  },
  {
    name: 'The Fallen',
    theme: 'Momentum',
    hue: 190,
    entries: [[80, 330]],
    hints: [
      [180, 290, 'SOME PATHS ARE PAVED', 13],
      [180, 310, 'BY THOSE WHO FELL', 13],
    ],
    walls: [R(12, 190, 330, 16)],
    pits: [{ x: 365, y: 198, r: 22 }],
    holes: [{ x: 80, y: 80, r: 18 }],
  },

  // ---------------------------------------------------------------- 4–6
  {
    name: 'Glass Floor',
    theme: 'Destruction',
    hue: 185,
    entries: [[80, 80]],
    hints: [
      [275, 110, 'GLASS FLOOR', 13],
      [275, 130, 'cracks under weight', 11],
      [275, 148, 'two balls on it at once break it', 11],
    ],
    walls: [R(150, 12, 16, 250)],
    glassFloors: [{ x: 320, y: 320, r: 26 }],
  },
  {
    name: 'Sweepers',
    theme: 'Impact',
    hue: 345,
    entries: [[320, 320]],
    hints: [[200, 372, 'SPEED SHATTERS GLASS WALLS', 11]],
    walls: [R(12, 150, 150, 12)],
    glassWalls: [R(150, 12, 12, 138, { strength: 470 })],
    sweepers: [{ cx: 270, cy: 200, len: 110, speed: 1.5, phase: 0 }],
    holes: [{ x: 80, y: 80, r: 18 }],
  },
  {
    name: 'Shortcut',
    theme: 'Destruction',
    hue: 165,
    entries: [[80, 80]],
    hints: [
      [76, 140, 'every landing', 11],
      [76, 156, 'cracks the glass', 11],
    ],
    walls: [R(140, 12, 16, 280), R(260, 108, 16, 280)],
    glassFloors: [{ x: 80, y: 80, r: 24 }],
    sweepers: [
      { cx: 208, cy: 200, len: 50, speed: 2.2, phase: 0 },
      { cx: 332, cy: 250, len: 54, speed: -2.0, phase: 1.5 },
    ],
    holes: [{ x: 332, y: 355, r: 18 }],
  },

  // ---------------------------------------------------------------- 7–8
  {
    name: 'Pressure',
    theme: 'Switches',
    hue: 135,
    entries: [[332, 355], [80, 80]],
    hints: [
      [250, 220, 'PLATES HOLD DOORS OPEN', 13],
      [250, 240, 'park a ball on it until its time runs out', 11],
    ],
    walls: [R(180, 12, 16, 180), R(12, 280, 110, 12), R(110, 280, 12, 40)],
    plates: [R(300, 40, 60, 60, { id: '7a' })],
    doors: [R(110, 320, 12, 68, { plates: ['7a'] })],
    holes: [{ x: 60, y: 340, r: 18 }],
  },
  {
    name: 'Sequence',
    theme: 'Switches',
    hue: 100,
    entries: [[60, 340]],
    hints: [[76, 200, 'ORDER MATTERS', 12]],
    walls: [
      R(140, 12, 16, 288), R(140, 360, 16, 28),
      R(260, 12, 16, 288), R(260, 360, 16, 28),
    ],
    plates: [R(40, 40, 60, 60, { id: '8a', label: '1' }), R(178, 40, 60, 60, { id: '8b', label: '2' })],
    doors: [R(140, 300, 16, 60, { plates: ['8a'] }), R(260, 300, 16, 60, { plates: ['8b'] })],
    holes: [{ x: 330, y: 80, r: 18 }],
  },

  // ---------------------------------------------------------------- 9–10
  {
    name: 'Inversion',
    theme: 'Precision',
    hue: 270,
    entries: [[330, 80]],
    hints: [[200, 50, 'VIOLET INVERTS YOUR CONTROL', 11]],
    walls: [R(58, 110, 330, 12), R(12, 200, 330, 12), R(58, 290, 330, 12)],
    zones: [R(12, 122, 376, 78), R(12, 302, 376, 86)],
    pits: [
      { x: 150, y: 168, r: 14 },
      { x: 255, y: 152, r: 14 },
      { x: 120, y: 250, r: 14 },
      { x: 220, y: 244, r: 14 },
      { x: 300, y: 256, r: 14 },
    ],
    holes: [{ x: 330, y: 345, r: 18 }],
  },
  {
    name: 'The Crumbling Bottom',
    theme: 'Chaos',
    hue: 20,
    entries: [[330, 345]],
    hints: [
      [340, 170, "DON'T", 14],
      [340, 190, 'STOP', 14],
      [60, 290, 'tiles crumble', 11],
    ],
    walls: [R(110, 360, 180, 28), R(110, 12, 180, 18)],
    grid: {
      x: 110, y: 30, cell: 30, cols: 6, rows: 11,
      // a two-wide path: along the bottom, up the middle, out to the left
      tiles: [
        [5, 10], [4, 10], [3, 10], [5, 9], [4, 9], [3, 9],
        [3, 8], [4, 8], [3, 7], [4, 7], [3, 6], [4, 6],
        [4, 5], [3, 5], [2, 5], [1, 5], [0, 5],
        [4, 4], [3, 4], [2, 4], [1, 4], [0, 4],
      ],
    },
    sweepers: [{ cx: 160, cy: 250, len: 80, speed: 1.4, phase: 2 }],
    holes: [{ x: 55, y: 60, r: 18 }],
  },
];
