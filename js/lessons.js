// The Sensing screen: three sections — touch, motion, ambient — of short
// lessons, each a small program to try and a live view of what it sends.
//
// The point of the screen is to see a reading arrive. So every lesson is the
// same shape — what you are making, how to clip it, the code to download, and
// the rows that fill in the moment the board starts talking — and the code is
// built by the same assembler the controller's program is, so the pin fixes
// are the same ones. A snippet per lesson rather than one program for all,
// because each download is also the lesson: paste, flash, watch.

import { assemble, variantFor } from './builder.js';
import { createChannelView } from './visualizer.js';

const CONNECT = 'Press Connect and pick your board — until it pairs it shows an X, a Bluetooth sign and its five-letter name, over and over. Once paired it smiles.';

// The three ways a touch becomes a 1, side by side, at the top of the touch
// section: they look alike and differ in what closes the circuit.
export const TOUCH_COMPARISON = {
  columns: ['Switch', 'Resistive touch', 'Capacitive touch'],
  rows: [
    ['Wiring', 'A foil on 3V, a foil on a pin', 'A foil on a pin — and you hold GND', 'One foil on a pin, nothing else'],
    ['What closes it', 'The two foils touch each other', 'Your body, from the pin to GND', 'Your body’s capacitance slows the pin’s charging'],
    ['A person needed?', 'No — a door or a jaw can close it', 'Yes, as the wire', 'Yes, as the capacitor'],
    ['Works through', 'Anything that brings the foils together', 'Fruit, Play-Doh, water, people', 'A fingertip, even through tape'],
    ['The catch', 'You have to build something that closes', 'Someone has to keep holding GND', 'Learns "untouched" at startup; A+B to relearn'],
  ],
};

export const SECTIONS = [
  {
    id: 'touch',
    title: 'Touch',
    intro: 'Three ways to turn a touch into a 1. They look alike; what differs is what closes the circuit.',
    comparison: TOUCH_COMPARISON,
    lessons: [
      {
        id: 'switch',
        title: 'Switch',
        emoji: '🔛',
        intro: 'Two pieces of foil that meet. While they touch, the circuit is closed and the reading is 1. No person needed.',
        steps: [
          'Clip a lead from the 3V pad to one piece of foil.',
          'Clip a lead from the P1 pad to a second piece of foil.',
          'Mount them so they can meet: one on each jaw of a puppet, one under a flap, two sides of a hinge.',
          'Copy the code and download it. ' + CONNECT,
          'Bring the foils together: the row below goes to 1.',
        ],
        image: { src: 'assets/lesson-switch.jpg', alt: 'Two foil pieces on a hinge, one clipped to 3V and one to P1' },
        inputs: [{ id: 'p1', mode: 'switch' }],
      },
      {
        id: 'resistive',
        title: 'Resistive touch',
        emoji: '🍌',
        intro: 'You are the wire. Hold GND in one hand, touch the pin with the other, and the circuit closes through you — the classic fruit piano.',
        steps: [
          'Clip a lead from the P2 pad to a piece of foil — or straight into a banana.',
          'Clip a lead from the GND pad to a second piece of foil, and hold it in one hand.',
          'Copy the code and download it. ' + CONNECT,
          'Touch the P2 foil (or the banana) with your other hand: the row goes to 1. Let go of GND and it stops working.',
        ],
        image: { src: 'assets/lesson-resistive.jpg', alt: 'A hand holding a foil clipped to GND, the other touching a banana clipped to P2' },
        inputs: [{ id: 'p2', mode: 'resistive' }],
      },
      {
        id: 'capacitive',
        title: 'Capacitive touch',
        emoji: '🫳',
        intro: 'One wire, one piece of foil. The pin senses your body through the clip — nothing to hold in the other hand.',
        steps: [
          'Clip one end of a lead to the P0 pad, and the other to a square of foil folded over a few times, so the clip has something to bite.',
          'Copy the code and download it, with your hands off the foil — the board learns what untouched feels like the moment it starts.',
          CONNECT,
          'Touch the foil: the row below goes to 1.',
          'Stuck on 1, or moved the foil? Press A and B together: it relearns, and shows a tick.',
        ],
        image: { src: 'assets/lesson-capacitive.jpg', alt: 'A crocodile clip from P0 to a square of folded foil' },
        inputs: [{ id: 'p0', mode: 'touch' }],
      },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    intro: 'The board knows which way it is tilted, and feels it when it is shaken or dropped. No wiring — strap the board, with its battery, to the thing that moves.',
    lessons: [
      {
        id: 'tilt',
        title: 'Tilt',
        emoji: '📐',
        intro: 'Two numbers in degrees: pitch, tipping forward and back, and roll, tipping side to side. Flat is 0.',
        steps: [
          'Copy the code and download it. ' + CONNECT,
          'Tip the board towards you and away: pitch follows.',
          'Tip it left and right: roll follows. Good for steering.',
        ],
        image: { src: 'assets/lesson-tilt.jpg', alt: 'A micro:bit tipped forward in a hand' },
        inputs: [{ id: 'pitch' }, { id: 'roll' }],
      },
      {
        id: 'gestures',
        title: 'Gestures',
        emoji: '🫨',
        intro: 'Moves that happen once. The board sends a single 1 the moment it feels one, and nothing in between — free for the radio.',
        steps: [
          'Copy the code and download it. ' + CONNECT,
          'Shake the board: the Shake row flashes and counts.',
          'Tap it on the table: Small bump. Toss it a little way and catch it: Free fall.',
        ],
        image: { src: 'assets/lesson-gestures.jpg', alt: 'A micro:bit being shaken' },
        inputs: [{ id: 'shake' }, { id: 'g3' }, { id: 'freefall' }],
      },
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient sensing',
    intro: 'What the board can tell about the room around it.',
    lessons: [
      {
        id: 'light',
        title: 'Light',
        emoji: '💡',
        intro: 'The LEDs double as a light sensor: 0 in the dark, 255 under a torch.',
        steps: [
          'Copy the code and download it. ' + CONNECT,
          'Cover the LEDs with your hand, then shine a phone torch on them.',
        ],
        image: { src: 'assets/lesson-light.jpg', alt: 'A hand cupped over the micro:bit LEDs' },
        inputs: [{ id: 'light' }],
      },
      {
        id: 'sound',
        title: 'Sound',
        emoji: '👏',
        intro: 'Two ways to hear: how loud it is right now, from 0 to 255, and a single 1 for every clap or shout.',
        steps: [
          'Copy the code and download it. ' + CONNECT,
          'Talk, hum, blow on the board: Sound rises and falls. The mic is beside the gold logo.',
          'Clap once: Loud sound counts one. Claps are over too fast for the level to catch every one — that is what the count is for.',
        ],
        image: { src: 'assets/lesson-sound.jpg', alt: 'Hands clapping next to the micro:bit' },
        inputs: [{ id: 'mic' }, { id: 'loud' }],
      },
      {
        id: 'temperature',
        title: 'Temperature',
        emoji: '🌡️',
        intro: 'The chip’s own temperature in °C. It moves slowly — room air is around 20.',
        steps: [
          'Copy the code and download it. ' + CONNECT,
          'Hold the board between your thumbs for a minute and watch it creep up.',
        ],
        image: { src: 'assets/lesson-temperature.jpg', alt: 'A micro:bit held between two thumbs' },
        inputs: [{ id: 'temp' }],
      },
    ],
  },
];

/** Every lesson, in page order. */
export const LESSONS = SECTIONS.flatMap((section) => section.lessons);

/** The parts a lesson's program is made of. */
export function lessonParts(lesson) {
  return lesson.inputs.map(({ id, mode }) => variantFor(id, mode));
}

/** The channels a lesson streams, in order, with the kind each will show as. */
export function lessonChannels(lesson) {
  return lessonParts(lesson).flatMap((part) => part.channels.map((channel) => ({ channel, kind: part.kind })));
}

/** The complete program for one lesson. */
export function lessonCode(lesson) {
  return assemble(lessonParts(lesson));
}

// --- The screen ---------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * A copy button with its code folded away beneath it. The button is a
 * `.code-copy` beside a `code`, so the one handler in main.js binds it.
 */
export function copyBlock(code, label) {
  const block = el('div', 'code-block code-block-folded');
  const copy = el('button', 'code-copy btn', label);
  copy.type = 'button';
  const details = el('details', 'code-details');
  details.appendChild(el('summary', null, 'See the code'));
  const pre = el('pre', 'code-prompt');
  pre.appendChild(el('code', null, code));
  details.appendChild(pre);
  block.append(copy, details);
  return block;
}

function comparisonTable({ columns, rows }) {
  const wrap = el('div', 'compare-wrap');
  const table = el('table', 'compare');
  const head = el('tr');
  head.appendChild(el('th', null, ''));
  for (const column of columns) head.appendChild(el('th', null, column));
  const thead = el('thead');
  thead.appendChild(head);
  const tbody = el('tbody');
  for (const [label, ...cells] of rows) {
    const tr = el('tr');
    tr.appendChild(el('th', null, label));
    for (const cell of cells) tr.appendChild(el('td', null, cell));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderLesson(lesson, index, signalStore, views) {
  const item = el('li', 'step');
  item.id = `lesson-${lesson.id}`;
  const num = el('span', 'step-num', String(index + 1));
  const body = el('div', 'step-body');
  body.appendChild(el('h3', null, `${lesson.emoji} ${lesson.title}`));
  body.appendChild(el('p', null, lesson.intro));

  const figure = el('figure', 'shot shot-slot');
  figure.setAttribute('aria-label', lesson.image.alt);
  figure.appendChild(document.createComment(` image slot: ${lesson.image.src} — ${lesson.image.alt} `));
  body.appendChild(figure);

  const steps = el('ol', 'lesson-steps');
  for (const step of lesson.steps) steps.appendChild(el('li', null, step));
  body.appendChild(steps);

  // The code is copied, not read: what the lesson teaches is the sensor,
  // and a page of scaffold in the way of it would be the wrong thing to
  // look at. It is still there under the fold for anyone curious.
  body.appendChild(copyBlock(lessonCode(lesson), 'Copy the code for this lesson'));

  body.appendChild(el('p', 'lesson-watch', 'Paste it over everything in the JavaScript tab, Download, press Connect up top — then:'));
  const live = el('div', 'live-rows lesson-live');
  body.appendChild(live);
  views.push(createChannelView(live, { signalStore, channels: lessonChannels(lesson) }));

  item.append(num, body);
  return item;
}

export function initLessons({ host, signalStore }) {
  if (!host || !signalStore) return null;
  host.textContent = '';
  const views = [];

  for (const section of SECTIONS) {
    const block = el('section', 'lesson-section');
    block.id = `sensing-${section.id}`;
    block.appendChild(el('h2', 'lesson-section-title', section.title));
    block.appendChild(el('p', 'lesson-section-intro', section.intro));
    if (section.comparison) block.appendChild(comparisonTable(section.comparison));
    const list = el('ol', 'steps');
    section.lessons.forEach((lesson, index) => list.appendChild(renderLesson(lesson, index, signalStore, views)));
    block.appendChild(list);
    host.appendChild(block);
  }

  return { destroy: () => views.forEach((view) => view.destroy()) };
}
