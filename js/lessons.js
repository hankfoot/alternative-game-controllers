// The Sensing screen: four lessons, each a small program to try and a live
// view of what it sends.
//
// The point of the screen is to see a reading arrive. So every lesson is the
// same shape — what you are making, how to clip it, the code to download, and
// the rows that fill in the moment the board starts talking — and the code is
// built by the same assembler the controller's program is, so the pin fixes
// are the same ones. A snippet per lesson rather than one program for all
// four, because each download is also the lesson: paste, flash, watch.

import { assemble, variantFor } from './builder.js';
import { createChannelView } from './visualizer.js';

export const LESSONS = [
  {
    id: 'touch',
    title: 'Touch',
    emoji: '🫳',
    intro: 'One wire, one piece of foil. The pin senses your body through the clip — nothing to hold in the other hand.',
    steps: [
      'Clip one end of a crocodile lead to the P0 pad on the board.',
      'Clip the other end to a square of foil. Tape the foil to anything you like.',
      'Copy the code, download it, and press Connect. Keep your hands off the foil for a second while it connects.',
      'Touch the foil: the row below goes to 1.',
    ],
    image: { src: 'assets/lesson-touch.jpg', alt: 'A crocodile clip from P0 to a square of foil' },
    inputs: [{ id: 'p0', mode: 'touch' }],
  },
  {
    id: 'switch',
    title: 'Switch',
    emoji: '🔛',
    intro: 'Two pieces of foil that meet. While they touch, the circuit is closed and the reading is 1.',
    steps: [
      'Clip a lead from the 3V pad to one piece of foil.',
      'Clip a lead from the P1 pad to a second piece of foil.',
      'Mount them so they can meet: one on each jaw of a puppet, one under a flap, two sides of a hinge.',
      'Copy the code, download it, press Connect, and bring the foils together.',
    ],
    image: { src: 'assets/lesson-switch.jpg', alt: 'Two foil pieces on a hinge, one clipped to 3V and one to P1' },
    inputs: [{ id: 'p1', mode: 'switch' }],
  },
  {
    id: 'analog',
    title: 'Analog',
    emoji: '📈',
    intro: 'Readings that are numbers, not on/off. Tilt the board, cover the LEDs — and read a voltage off a pencil line.',
    steps: [
      'Pitch and light need no wiring: tip the board, then cover the LEDs with your hand.',
      'For P2, draw a thick line with a soft (6B) pencil, going over it several times.',
      'Clip 3V to one end of the line and GND to the other. Keep those two clips apart.',
      'Clip P2 to a third lead and slide its clip along the line: the number follows it. Graphite is noisy — light is the steadier choice for a controller.',
    ],
    image: { src: 'assets/lesson-analog.jpg', alt: 'A pencil line with clips at each end and a third clip sliding along it' },
    inputs: [{ id: 'pitch' }, { id: 'light' }, { id: 'p2', mode: 'analog' }],
  },
  {
    id: 'events',
    title: 'Events',
    emoji: '👏',
    intro: 'Things that happen once. The board sends a single 1 the moment it happens, and nothing in between — free for the radio.',
    steps: [
      'No wiring. Copy the code, download it, press Connect.',
      'Shake the board: the Shake row flashes and counts.',
      'Clap near the gold logo, where the mic is: the Loud sound row counts too.',
    ],
    image: { src: 'assets/lesson-events.jpg', alt: 'A hand clapping next to the micro:bit' },
    inputs: [{ id: 'shake' }, { id: 'loud' }],
  },
];

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

export function initLessons({ host, signalStore }) {
  if (!host || !signalStore) return null;
  host.textContent = '';
  const views = [];

  LESSONS.forEach((lesson, index) => {
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
    host.appendChild(item);
  });

  return { destroy: () => views.forEach((view) => view.destroy()) };
}
