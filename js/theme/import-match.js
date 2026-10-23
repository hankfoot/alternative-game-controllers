// Which drawing or sound an imported file is for, read off its name.
//
// The AI prompts ask for files named exactly after their slot — `player.png`,
// `crash.mp3` — so those match first. Tools rename things, and people do too,
// so the words a person would use for each piece match as well: `Far
// background.png`, `pillar_1.png`, `explosion.wav`. A name that matches
// nothing is reported rather than guessed at, since a sky imported as the
// player is worse than a sky not imported.

import { SLOTS } from './defaults.js';
import { SOUND_EVENTS } from './audio.js';

const IMAGE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|webm|flac)$/i;

// Checked in this order, and the first whose words all appear wins. Order
// matters where names overlap: "far background" is the far slot, not the
// sky, so `far` comes before `backdrop`.
const SPRITE_WORDS = [
  ['far', ['far', 'distant', 'hills', 'mountains', 'skyline', 'horizon']],
  ['backdrop', ['backdrop', 'sky', 'background', 'bg']],
  ['obstacle', ['obstacle', 'obstacles', 'pillar', 'pillars', 'column', 'columns', 'pipe', 'pipes', 'tower']],
  ['block', ['block', 'blocks', 'floating', 'box', 'crate']],
  ['ground', ['ground', 'floor', 'terrain', 'grass']],
  ['near', ['near', 'scenery', 'tree', 'trees', 'rock', 'rocks', 'bush', 'prop']],
  ['decor', ['decor', 'drifting', 'cloud', 'clouds', 'bird', 'birds']],
  ['player', ['player', 'you', 'character', 'hero', 'craft', 'ship']],
];

const SOUND_WORDS = [
  ['music', ['music', 'loop', 'song', 'soundtrack', 'bgm']],
  ['crash', ['crash', 'hit', 'die', 'death', 'lose', 'explosion', 'gameover']],
  ['score', ['score', 'point', 'points', 'coin', 'ding', 'pass', 'clear']],
  ['launch', ['launch', 'start', 'begin', 'go', 'ready']],
  ['thrust', ['thrust', 'steer', 'steering', 'engine', 'flap', 'whoosh', 'move']],
];

const SLOT_IDS = new Set(SLOTS.map((slot) => slot.id));
const SOUND_IDS = new Set([...SOUND_EVENTS.map(([event]) => event), 'music']);

/** A file name's words: no folder, no extension, lower case, split on anything not a letter or digit. */
function wordsOf(name) {
  const base = name.split('/').pop().replace(/\.[^.]+$/, '');
  const words = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return { base: base.toLowerCase(), words, joined: words.join('') };
}

function lookUp(name, ids, table) {
  const { base, words, joined } = wordsOf(name);
  if (ids.has(base)) return base;
  for (const [id, synonyms] of table) {
    if (synonyms.some((word) => words.includes(word) || joined === word)) return id;
  }
  return null;
}

/**
 * What a file is for: `{ kind: 'sprite', slot }`, `{ kind: 'sound', event }`
 * (with 'music' for the music), or null if its name says nothing usable.
 * `type` is the file's MIME type, used when the name has no extension.
 */
export function matchImport(name, type = '') {
  const image = IMAGE.test(name) || type.startsWith('image/');
  const audio = AUDIO.test(name) || type.startsWith('audio/');
  if (image) {
    const slot = lookUp(name, SLOT_IDS, SPRITE_WORDS);
    return slot ? { kind: 'sprite', slot } : null;
  }
  if (audio) {
    const event = lookUp(name, SOUND_IDS, SOUND_WORDS);
    return event ? { kind: 'sound', event } : null;
  }
  return null;
}

/**
 * Sorts a set of files into where each goes. One file per slot: a second
 * file for a slot already taken is set aside and named, rather than silently
 * replacing the first. Files are `{ name, type? }`, plus whatever the caller
 * needs to carry along.
 */
export function planImport(files) {
  const placed = [];
  const unknown = [];
  const doubled = [];
  const taken = new Set();
  for (const file of files) {
    const target = matchImport(file.name, file.type ?? '');
    if (!target) {
      unknown.push(file.name.split('/').pop());
      continue;
    }
    const key = `${target.kind}:${target.slot ?? target.event}`;
    if (taken.has(key)) {
      doubled.push(file.name.split('/').pop());
      continue;
    }
    taken.add(key);
    placed.push({ file, target });
  }
  return { placed, unknown, doubled };
}
