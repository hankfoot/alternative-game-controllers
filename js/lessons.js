// The Sensing screen: three steps — touch, motion, ambient — each walking
// through a few examples, each example a small program to try and a live view
// of what it sends.
//
// The point of the screen is to see a reading arrive. So every lesson is the
// same shape — what you are making, how to clip it, the code to download, and
// the rows that fill in the moment the board starts talking — and the code is
// built by the same assembler the controller's program is, so the pin fixes
// are the same ones. A snippet per lesson rather than one program for all,
// because each download is also the lesson: paste, flash, watch.

import { assemble, variantFor } from './builder.js';
import { createChannelView } from './visualizer.js';

const COPY = 'Copy the code, download it, and press Connect.';

export const SECTIONS = [
  {
    id: 'touch',
    title: 'Touch',
    intro: 'There are three ways to turn a touch into a signal. They differ in what completes the circuit.',
    lessons: [
      {
        id: 'switch',
        title: 'Switch',
        intro: 'Two pieces of foil complete the circuit when they touch each other.',
        steps: [
          'Clip 3V to one piece of foil and P1 to another.',
          'Mount them so they can meet, like the two jaws of a puppet.',
          COPY,
          'Press the foils together.',
        ],
        image: { src: 'assets/lesson-switch.jpg', alt: 'Two foil pieces on a hinge, one clipped to 3V and one to P1' },
        inputs: [{ id: 'p1', mode: 'switch' }],
      },
      {
        id: 'resistive',
        title: 'Resistive touch',
        intro: 'Your body completes the circuit between the pin and ground.',
        steps: [
          'Clip P2 to a piece of foil, or to a banana.',
          'Clip GND to a second piece of foil and hold it in one hand.',
          COPY,
          'Touch the P2 foil with your other hand.',
        ],
        image: { src: 'assets/lesson-resistive.jpg', alt: 'A hand holding a foil clipped to GND, the other touching a banana clipped to P2' },
        inputs: [{ id: 'p2', mode: 'resistive' }],
      },
      {
        id: 'capacitive',
        title: 'Capacitive touch',
        intro: 'The pin senses your body through a single piece of foil, so there is nothing to hold.',
        steps: [
          'Fold a piece of foil a few times and clip P0 to it.',
          COPY + ' Keep your hands off the foil while the board starts up.',
          'Touch the foil.',
          'If it gets stuck on, press A and B together to reset it.',
        ],
        image: { src: 'assets/lesson-capacitive.jpg', alt: 'A crocodile clip from P0 to a square of folded foil' },
        inputs: [{ id: 'p0', mode: 'touch' }],
      },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    intro: 'The board can tell how it is tilted and how it is moving. None of these need any wiring.',
    lessons: [
      {
        id: 'tilt',
        title: 'Tilt',
        intro: 'Pitch and roll measure the tilt in degrees.',
        steps: [
          COPY,
          'Tip the board forward and back, then side to side.',
        ],
        image: { src: 'assets/lesson-tilt.jpg', alt: 'A micro:bit tipped forward in a hand' },
        inputs: [{ id: 'pitch' }, { id: 'roll' }],
      },
      {
        id: 'gestures',
        title: 'Gestures',
        intro: 'Gestures are sent once each time they happen.',
        steps: [
          COPY,
          'Shake the board, tap it on the table, and toss it gently.',
        ],
        image: { src: 'assets/lesson-gestures.jpg', alt: 'A micro:bit being shaken' },
        inputs: [{ id: 'shake' }, { id: 'g3' }, { id: 'freefall' }],
      },
      {
        id: 'compass',
        title: 'Compass',
        intro: 'The compass measures which way the board points, in degrees from north.',
        steps: [
          'Copy the code and download it.',
          'Tilt the board around until every LED is lit. This calibrates the compass.',
          'Press Connect, hold the board flat, and turn around slowly.',
        ],
        image: { src: 'assets/lesson-compass.jpg', alt: 'A micro:bit held flat and turned like a dial' },
        inputs: [{ id: 'heading' }],
      },
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient sensing',
    intro: 'The board can measure light, sound, and temperature.',
    lessons: [
      {
        id: 'ambient',
        title: 'Light, sound and temperature',
        intro: '',
        steps: [
          COPY,
          'Cover the LEDs with your hand, then shine a light on them.',
          'Talk near the board, then clap once.',
          'Hold the board between your thumbs and watch the temperature rise.',
        ],
        image: { src: 'assets/lesson-ambient.jpg', alt: 'A hand cupped over the micro:bit next to a phone torch' },
        inputs: [{ id: 'light' }, { id: 'mic' }, { id: 'loud' }, { id: 'temp' }],
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

const LETTERS = 'ABCDEFGHIJ';

function renderExample(lesson, index, signalStore, views) {
  const item = el('li', 'substep');
  item.id = `lesson-${lesson.id}`;
  const letter = el('span', 'substep-num', LETTERS[index]);
  letter.setAttribute('aria-hidden', 'true');
  const body = el('div', 'substep-body');
  body.appendChild(el('h4', null, lesson.title));
  if (lesson.intro) body.appendChild(el('p', null, lesson.intro));

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
  body.appendChild(copyBlock(lessonCode(lesson), 'Copy the code'));

  body.appendChild(el('p', 'lesson-watch', 'Readings appear here once the board is connected.'));
  const live = el('div', 'live-rows lesson-live');
  body.appendChild(live);
  views.push(createChannelView(live, { signalStore, channels: lessonChannels(lesson) }));

  item.append(letter, body);
  return item;
}

export function initLessons({ host, signalStore }) {
  if (!host || !signalStore) return null;
  host.textContent = '';
  const views = [];

  // One numbered list — touch, motion, ambient — and inside each step its
  // examples, lettered, so the page reads as three things to do rather than
  // three chapters.
  const list = el('ol', 'steps');
  SECTIONS.forEach((section, index) => {
    const item = el('li', 'step');
    item.id = `sensing-${section.id}`;
    const body = el('div', 'step-body');
    body.appendChild(el('h3', null, section.title));
    body.appendChild(el('p', null, section.intro));
    if (section.lessons.length > 1) {
      const examples = el('ol', 'substeps');
      section.lessons.forEach((lesson, i) => examples.appendChild(renderExample(lesson, i, signalStore, views)));
      body.appendChild(examples);
    } else {
      // A single example needs no letter: its parts sit straight in the step.
      const only = renderExample(section.lessons[0], 0, signalStore, views);
      const inner = only.querySelector('.substep-body');
      inner.querySelector('h4').remove();
      if (section.lessons[0].intro) inner.querySelector('p').remove();
      body.append(...inner.childNodes);
    }
    item.append(el('span', 'step-num', String(index + 1)), body);
    list.appendChild(item);
  });
  host.appendChild(list);

  return { destroy: () => views.forEach((view) => view.destroy()) };
}
