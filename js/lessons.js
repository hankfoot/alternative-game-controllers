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
    wiring: 'Clip a wire from P0 to a square of foil. Clip it on before you connect; the pad learns what untouched feels like the moment the browser connects, so keep your hands off it for a second then.',
    inputs: [{ id: 'p0', mode: 'touch' }],
  },
  {
    id: 'switch',
    title: 'Switch',
    emoji: '🔛',
    intro: 'Two pieces of foil that meet. While they touch, the circuit is closed and the reading is 1.',
    wiring: 'Clip 3V to one foil and P1 to the other. Fold one over a hinge, tape one under a flap, put one on each jaw of a puppet — anything that can close.',
    inputs: [{ id: 'p1', mode: 'switch' }],
  },
  {
    id: 'analog',
    title: 'Analog',
    emoji: '📈',
    intro: 'Readings that are numbers, not on/off. Tilt the board, cover the LEDs — and read a voltage off a pencil line.',
    wiring: 'Pitch and light need no wiring. For P2, draw a thick 6B pencil line, clip 3V to one end, GND to the other, and P2 to a clip you slide along it. Graphite is noisy; a light sensor is the steadier choice for a controller.',
    inputs: [{ id: 'pitch' }, { id: 'light' }, { id: 'p2', mode: 'analog' }],
  },
  {
    id: 'events',
    title: 'Events',
    emoji: '👏',
    intro: 'Things that happen once. The board sends a single 1 the moment it happens, and nothing in between — free for the radio.',
    wiring: 'No wiring. Shake the board, or clap near the mic beside the gold logo.',
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
    body.appendChild(el('p', 'lesson-wiring', lesson.wiring));

    const block = el('div', 'code-block code-block-wide');
    const copy = el('button', 'code-copy', 'Copy');
    copy.type = 'button';
    const pre = el('pre');
    const code = el('code', null, lessonCode(lesson));
    pre.appendChild(code);
    block.append(copy, pre);
    body.appendChild(block);

    body.appendChild(el('p', 'lesson-watch', 'Paste it over everything in the JavaScript tab, Download, press Connect up top — then:'));
    const live = el('div', 'live-rows lesson-live');
    body.appendChild(live);
    views.push(createChannelView(live, { signalStore, channels: lessonChannels(lesson) }));

    item.append(num, body);
    host.appendChild(item);
  });

  return { destroy: () => views.forEach((view) => view.destroy()) };
}
