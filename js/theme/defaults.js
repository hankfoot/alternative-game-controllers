// What the game looks and sounds like before anybody has changed anything.
//
// ─── ADDING YOUR OWN DEFAULT ASSETS ─────────────────────────────────────────
// Drop files into `assets/sprites/` and `assets/sounds/`, then name them in the
// two manifests below. Anything named here is fetched at startup; anything that
// is missing, or fails to load, quietly falls back — a sprite to the sketch
// drawn further down this file, a sound to silence. So a half-filled manifest
// is fine, and you can add them one at a time.
//
//   SPRITE_FILES.player = 'assets/sprites/player.png';
//   SOUND_FILES.crash   = 'assets/sounds/crash.mp3';
//
// Sprites are drawn onto a 256×256 square, so square art fits best; anything
// else is centre-cropped to fit. Sounds can be any format the browser plays.
// ─────────────────────────────────────────────────────────────────────────────

import { CANVAS } from './raster.js';

/**
 * Slot id → file path, or null to use the built-in sketch.
 *
 * The set that ships is a Flappy Bird knockoff — a bird, green pipes, a sunny
 * sky — made at exactly these sizes from the Design screen's AI prompt. The
 * sketches further down are still the fallback for any file that fails to load.
 */
export const SPRITE_FILES = {
  player: 'assets/sprites/player.png',
  obstacle: 'assets/sprites/obstacle.png',
  block: 'assets/sprites/block.png',
  ground: 'assets/sprites/ground.png',
  backdrop: 'assets/sprites/backdrop.png',
  far: 'assets/sprites/far.png',
  near: 'assets/sprites/near.png',
  decor: 'assets/sprites/decor.png',
};

/**
 * Sound event → the file that ships with the game, or null for no built-in.
 *
 * These are what `'default'` resolves to (see js/theme/audio.js). They are
 * fetched on the first play and cached decoded, so an event nobody triggers
 * costs nothing. Regenerate them with `python3 scripts/make-sounds.py`.
 */
export const SOUND_FILES = {
  launch: 'assets/sounds/launch.mp3',
  score: 'assets/sounds/score.mp3',
  crash: 'assets/sounds/crash.mp3',
  thrust: 'assets/sounds/thrust.mp3',
  music: 'assets/sounds/music.mp3',
};

// --- The built-in sketches ---------------------------------------------------
// Deliberately rough: thick marker outlines and flat fills, drawn a little
// wobbly so they read as something somebody knocked together rather than as
// finished art. They are meant to look replaceable, because they are.

const INK = '#1b1c20';

// One palette for every sketch, so the set reads as drawn by one hand with
// one box of markers: a green for anything that grows (pillars, grass, the
// tree), a tan for the earth, a blue for you, and a single warm accent for the
// one thing that is dangerous and alone. Each colour has its lit and shaded
// neighbour, used the same way on every shape — a highlight down the left,
// a shadow down the right — and everything is outlined in the same ink at
// the same weight.
const PALETTE = Object.freeze({
  leaf: '#4ac06a', leafLight: '#7fdb97', leafDeep: '#2f9350',
  earth: '#d9a066', earthDeep: '#c98d4e', pebble: '#b98c33', bark: '#7a4a26',
  sky: '#8fc4ff', skyPale: '#d8ecff', horizon: '#f4fbf5',
  haze: '#b3c2d8', hazeLight: '#c9d5e6', hazeLine: '#7f93b0',
  body: '#5b8cff', bodyDeep: '#3b6bd8', scarf: '#e5484d',
  ember: '#f2622e', emberLight: '#ff8a5c', emberDeep: '#c4471a',
  sun: '#ffd76b', sunLine: '#e0a93f',
  cloudShade: '#dfe8f5',
});
// The one outline weight, and the lighter one for details inside a shape.
const LINE = 7;
const FINE = 5;

/**
 * Nudges a point off its exact position by a fixed amount for its index, so a
 * shape drawn twice is drawn identically but neither time looks ruled.
 */
function wobble(index, amount = 3) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 2 * amount;
}

/** A closed shape through the given points, with a hand-drawn waver. */
function scrawl(ctx, points, { fill, stroke = INK, width = LINE, close = true } = {}) {
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const px = x + wobble(i * 2);
    const py = y + wobble(i * 2 + 1);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  if (close) ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

const SKETCHES = {
  // A little flier with a face on it. The point of drawing a creature rather
  // than a shape is that the first thing most people do here is give it a
  // different expression, and a wedge with no eyes doesn't invite that.
  player(ctx, s) {
    // A scarf trailing off the back, which is most of what sells the motion.
    scrawl(ctx, [
      [s * 0.3, s * 0.46], [s * 0.1, s * 0.4], [s * 0.02, s * 0.5],
      [s * 0.12, s * 0.52], [s * 0.28, s * 0.56],
    ], { fill: PALETTE.scarf, width: FINE });
    // The body: a rounded wedge, nose to the right. Enough points round the
    // back that the waver reads as a hand-drawn curve rather than a kink.
    scrawl(ctx, [
      [s * 0.3, s * 0.3], [s * 0.5, s * 0.28], [s * 0.7, s * 0.34], [s * 0.9, s * 0.5],
      [s * 0.7, s * 0.66], [s * 0.5, s * 0.72], [s * 0.3, s * 0.7],
      [s * 0.19, s * 0.6], [s * 0.16, s * 0.5], [s * 0.19, s * 0.4],
    ], { fill: PALETTE.body });
    // A wing swept back along the near side, a shade darker so it reads as
    // behind. Set back from the eyes: sitting under them it read as a mouth.
    scrawl(ctx, [
      [s * 0.28, s * 0.46], [s * 0.5, s * 0.48], [s * 0.42, s * 0.62],
      [s * 0.26, s * 0.6],
    ], { fill: PALETTE.bodyDeep, width: FINE });

    const eye = (cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = FINE;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      // Pupils sit forward in the eye, so it is looking where it is going.
      ctx.arc(cx + r * 0.34, cy, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    };
    eye(s * 0.58, s * 0.44, s * 0.085);
    eye(s * 0.75, s * 0.47, s * 0.06);
  },

  // A pillar, whole: a cap at the top and a shaft running off the bottom of
  // the drawing. It is drawn once per bar, cap at the gap and the shaft
  // carrying on past the edge of the field, so the bottom of this drawing is
  // never seen and the shaft is the part that gets stretched if a bar is
  // longer than the drawing is. Which is why the shaft is plain below the
  // last band: a stretched stripe is still a stripe.
  obstacle(ctx, w, h) {
    const capH = h * 0.11;
    const inset = w * 0.1;
    // The shaft, lit down the left and shaded down the right like everything
    // else solid in the set.
    scrawl(ctx, [
      [inset, capH * 0.8], [w - inset, capH * 0.8], [w - inset, h + 20], [inset, h + 20],
    ], { fill: PALETTE.leaf });
    ctx.fillStyle = PALETTE.leafLight;
    ctx.fillRect(inset + 6, capH, w * 0.12, h);
    ctx.fillStyle = PALETTE.leafDeep;
    ctx.fillRect(w - inset - 6 - w * 0.12, capH, w * 0.12, h);
    // The cap: a lip wider than the shaft, which is what says "pillar" rather
    // than "stripe" at the end you actually see.
    scrawl(ctx, [[4, 4], [w - 4, 4], [w - 4, capH], [4, capH]], { fill: PALETTE.leafLight });
    ctx.fillStyle = PALETTE.leafDeep;
    ctx.fillRect(4, capH * 0.66, w - 8, capH * 0.3);
    // Bands down the shaft, then nothing: the plain stretch below is what gets
    // pulled when a bar runs long.
    for (const y of [0.3, 0.46, 0.62]) {
      scrawl(ctx, [[inset + 10, h * y], [w - inset - 10, h * y]], { stroke: PALETTE.leafDeep, width: FINE, close: false });
    }
  },

  // The floating obstacle, which is one object rather than a length of
  // something — so it is square, and it is its own drawing. Sharing one with the
  // pillars meant a shape that had to work both stacked and alone, and did
  // neither especially well.
  block(ctx, s) {
    scrawl(ctx, [
      [s * 0.12, s * 0.2], [s * 0.88, s * 0.14], [s * 0.9, s * 0.84], [s * 0.1, s * 0.88],
    ], { fill: PALETTE.ember });
    // Lit on the left, shaded on the right, like the pillars and the tree.
    scrawl(ctx, [[s * 0.16, s * 0.24], [s * 0.26, s * 0.23], [s * 0.25, s * 0.82], [s * 0.15, s * 0.84]],
      { fill: PALETTE.emberLight, stroke: null });
    scrawl(ctx, [[s * 0.76, s * 0.18], [s * 0.86, s * 0.17], [s * 0.86, s * 0.82], [s * 0.76, s * 0.83]],
      { fill: PALETTE.emberDeep, stroke: null });
    // A face, because it is the thing you spend the round dodging.
    ctx.fillStyle = INK;
    for (const x of [0.36, 0.64]) {
      ctx.beginPath();
      ctx.arc(s * x, s * 0.42, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
    scrawl(ctx, [[s * 0.34, s * 0.66], [s * 0.5, s * 0.58], [s * 0.66, s * 0.66]],
      { stroke: INK, width: LINE, close: false });
  },

  // A strip of ground: earth with a band of grass on top, and a few tufts. Flat
  // left and right edges so it runs along the floor without a join showing.
  ground(ctx, s) {
    ctx.fillStyle = PALETTE.earth;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = PALETTE.earthDeep;
    ctx.fillRect(0, s * 0.4, s, s * 0.6);
    ctx.fillStyle = PALETTE.leaf;
    ctx.fillRect(0, 0, s, s * 0.22);
    ctx.fillStyle = PALETTE.leafDeep;
    ctx.fillRect(0, s * 0.19, s, s * 0.05);
    // The grass has the same inked edge as everything else, along the line
    // where it meets the earth; the top edge is the horizon and stays open.
    ctx.lineWidth = LINE;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.24);
    ctx.lineTo(s, s * 0.24);
    ctx.stroke();

    for (let i = 0; i < 4; i += 1) {
      const x = s * (0.14 + i * 0.24);
      scrawl(ctx, [[x, s * 0.2], [x + s * 0.03, s * 0.06]], { stroke: PALETTE.leafDeep, width: FINE, close: false });
    }
    // Pebbles, so the earth below the grass isn't a flat slab.
    ctx.fillStyle = PALETTE.pebble;
    for (const [x, y, r] of [[0.2, 0.6, 0.045], [0.55, 0.78, 0.035], [0.82, 0.55, 0.05]]) {
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * r, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // The whole sky, for when somebody would rather draw one than pick a colour.
  //
  // The only sketch that has to cover its frame edge to edge and opaquely:
  // every other slot is a shape with the page behind it, and this one *is* the
  // page. A transparent margin here shows as a band of browser chrome around
  // the game, which reads as a bug rather than as a drawing.
  backdrop(ctx, w, h) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, PALETTE.sky);
    sky.addColorStop(0.65, PALETTE.skyPale);
    sky.addColorStop(1, PALETTE.horizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sized off the short side, or it becomes a dinner plate on a wide sky.
    // Small and high in a corner: the menu card sits across the middle of the
    // field, and a sun behind lettering is worse than no sun.
    const sun = Math.min(w, h) * 0.085;
    ctx.beginPath();
    ctx.arc(w * 0.86, h * 0.16, sun, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.sun;
    ctx.fill();
    ctx.lineWidth = FINE;
    ctx.strokeStyle = PALETTE.sunLine;
    ctx.stroke();

    // A far-off ridge, well above where the real scenery sits, so the sky has
    // some depth to it rather than being a flat wash behind everything.
    ctx.globalAlpha = 0.35;
    scrawl(ctx, [
      [0, h], [0, h * 0.82], [w * 0.18, h * 0.7], [w * 0.34, h * 0.79],
      [w * 0.52, h * 0.66], [w * 0.72, h * 0.78], [w, h * 0.72], [w, h],
    ], { fill: PALETTE.haze, stroke: null });
    ctx.globalAlpha = 1;
  },

  // Rolling hills, repeated end to end across the back. Both side edges sit at
  // the same height so a row of them joins into one continuous skyline.
  //
  // Outlined in a washed-out blue rather than in ink. Everything else here is
  // drawn with the same near-black marker, but this band is the furthest thing
  // in the picture and a hard black edge on it pulls it forward — it ends up
  // reading as the scenery rather than as the distance behind the scenery.
  far(ctx, s) {
    const HAZE = PALETTE.hazeLine;
    scrawl(ctx, [
      [0, s], [0, s * 0.7], [s * 0.16, s * 0.5], [s * 0.32, s * 0.64],
      [s * 0.52, s * 0.38], [s * 0.72, s * 0.62], [s * 0.86, s * 0.52],
      [s, s * 0.7], [s, s],
    ], { fill: PALETTE.haze, stroke: HAZE, width: 4 });
    // A lighter face on one side of each peak, for a bit of relief.
    scrawl(ctx, [
      [s * 0.52, s * 0.38], [s * 0.72, s * 0.62], [s * 0.62, s * 0.66],
    ], { fill: PALETTE.hazeLight, stroke: null });
  },

  // A tree, standing on its own. Unlike the band behind it this one is dotted
  // along with air either side, so it is drawn as one object rather than as a
  // strip that has to join up with itself.
  near(ctx, s) {
    // The trunk first, so the canopy sits over it.
    scrawl(ctx, [
      [s * 0.45, s * 0.98], [s * 0.45, s * 0.72], [s * 0.55, s * 0.72], [s * 0.55, s * 0.98],
    ], { fill: PALETTE.bark, width: FINE });
    // One silhouette rather than three stacked triangles: a stepped outline
    // from the tip down each side, so the tree is a single shape with a single
    // edge — the stack had each tier's outline cutting across the one below
    // and read as three hats. Drawn without the outline first, then the lit
    // left face inside it, then the outline on top of both so the highlight
    // never leaks past the edge.
    const canopy = [
      [s * 0.5, s * 0.06],
      [s * 0.7, s * 0.36], [s * 0.62, s * 0.36],
      [s * 0.8, s * 0.62], [s * 0.7, s * 0.62],
      [s * 0.9, s * 0.86], [s * 0.1, s * 0.86],
      [s * 0.3, s * 0.62], [s * 0.2, s * 0.62],
      [s * 0.38, s * 0.36], [s * 0.3, s * 0.36],
    ];
    scrawl(ctx, canopy, { fill: PALETTE.leaf, stroke: null });
    scrawl(ctx, [
      [s * 0.5, s * 0.1], [s * 0.5, s * 0.84], [s * 0.16, s * 0.84],
      [s * 0.34, s * 0.62], [s * 0.26, s * 0.62],
      [s * 0.42, s * 0.36], [s * 0.35, s * 0.36],
    ], { fill: PALETTE.leafLight, stroke: null });
    scrawl(ctx, canopy, { fill: null });
  },

  // A cloud. Also has to pass for a bubble or a speck, being the only one.
  //
  // Filled twice rather than filled and stroked: three overlapping circles in
  // one path stroke as three rings, including the arcs buried inside the shape,
  // which reads as chainmail rather than as a cloud. A dark blob with a
  // slightly smaller white one on top leaves an outline around the silhouette
  // and nothing across the middle.
  decor(ctx, s) {
    const puffs = [[0.32, 0.58, 0.19], [0.5, 0.44, 0.24], [0.7, 0.56, 0.18]];
    const blob = (grow, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const [x, y, r] of puffs) ctx.arc(s * x, s * y, s * r + grow, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(4, INK);
    blob(-1, '#ffffff');
    // A soft underside, so it isn't a flat white cut-out.
    ctx.save();
    ctx.beginPath();
    for (const [x, y, r] of puffs) ctx.arc(s * x, s * y, s * r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = PALETTE.cloudShade;
    ctx.fillRect(0, s * 0.6, s, s);
    ctx.restore();
  },
};

/** The shape of a drawing, unless a slot says otherwise. */
export const SLOT_SIZE = Object.freeze({ width: CANVAS, height: CANVAS });

// The sky is the one slot with a size of its own: it is stretched across the
// whole field rather than repeated or drawn as an object, so a square drawing
// would be squashed to nothing like the right proportions. 768×480 is exactly
// the field's 8:5 and exactly three times the working unit.
const WIDE = Object.freeze({ width: 768, height: 480 });

export const SLOTS = Object.freeze([
  { id: 'player', label: 'You', emoji: '🚀', help: 'The thing you steer.' },
  {
    id: 'obstacle',
    label: 'Pillars',
    emoji: '🧱',
    help: 'Top end at each gap you fly through; the bottom runs off the edge of the field.',
    // A portrait: a whole pillar, cap at the top, shaft running off the
    // bottom. Drawn once per bar with the cap at the gap, so the bottom of
    // the drawing is the end nobody sees — and the end that is stretched when
    // a bar is longer than the drawing. Two and a half times as tall as wide:
    // tall enough to cover most bars at a bar's width without a stretch, and
    // not so tall that the editor can show it only as a sliver.
    size: Object.freeze({ width: 192, height: 480 }),
  },
  { id: 'block', label: 'Floating blocks', emoji: '🟧', help: 'The one that hangs in mid-air.' },
  { id: 'ground', label: 'The ground', emoji: '🟫', help: 'Repeated along the floor.' },
  {
    id: 'backdrop',
    label: 'The sky',
    emoji: '🌤️',
    help: 'Behind everything, stretched to fill the whole field.',
    size: WIDE,
    // Cropping to the ink is meaningless for a drawing defined to fill its
    // frame, and measuring it is a full pixel read on every brush stroke.
    crop: false,
  },
  { id: 'far', label: 'Far background', emoji: '⛰️', help: 'Repeated across the back, scrolling slowly.' },
  { id: 'near', label: 'Scenery', emoji: '🌴', help: 'Dotted in front of that — trees, rocks, whatever you like.' },
  { id: 'decor', label: 'Drifting things', emoji: '☁️', help: 'Scattered through the air.' },
]);

export const SLOT_IDS = Object.freeze(SLOTS.map((slot) => slot.id));

const BY_ID = new Map(SLOTS.map((slot) => [slot.id, slot]));

/**
 * How big a slot's drawing is. The only door to "the sky is the exception", so
 * that fact lives in exactly one place and everything downstream just asks.
 */
export function sizeOf(slotId) {
  return BY_ID.get(slotId)?.size ?? SLOT_SIZE;
}

/** Whether a slot's drawing should be cropped to its ink when shown small. */
export function cropsToInk(slotId) {
  return BY_ID.get(slotId)?.crop !== false;
}

/**
 * Paints a slot's built-in sketch onto a canvas context.
 *
 * Both dimensions are passed, but only the sky reads the second: for every
 * other slot they are equal, and rewriting six square sketches to mention a
 * height they cannot differ in would only invite the mistake of turning a
 * radius into one of the two axes.
 */
export function drawSketch(slot, ctx, size = SLOT_SIZE) {
  const sketch = SKETCHES[slot];
  if (!sketch) return false;
  ctx.save();
  sketch(ctx, size.width, size.height);
  ctx.restore();
  return true;
}
