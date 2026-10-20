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

const UPLOAD = 'Copy and upload the code to your micro:bit.';

export const SECTIONS = [
  {
    id: 'touch',
    title: 'Touch',
    intro: 'There are three ways to sense a touch. Each one completes a circuit in a different way.',
    lessons: [
      {
        id: 'switch',
        title: 'Switch',
        intro: 'Touching two pieces of conductive material together can complete a circuit just like how a light switch works: when the foils meet, electricity flows from the 3V pin into P0. This is useful for detecting when two objects come into contact, such as when a lid is put on a jar or when a door is closed.',
        steps: [
          'Clip one piece of foil to pin P0.',
          'Clip another piece of foil to the 3V pin.',
          UPLOAD,
          'Touch the foils together.',
        ],
        image: { src: 'assets/lesson-switch.jpg', alt: 'Two pieces of foil, one clipped to P0 and one to 3V' },
        inputs: [{ id: 'p0', mode: 'switch' }],
      },
      {
        id: 'resistive',
        title: 'Resistive touch',
        intro: 'Your body conducts electricity, so you can complete a circuit yourself by touching a pin while holding the ground pin: a tiny current flows from P0, through you, to GND. This is how a fruit piano works: anything a little conductive, like a banana or Play-Doh, can become a button.',
        steps: [
          'Clip one piece of foil to pin P0.',
          'Clip another piece of foil to the GND pin and hold it in one hand.',
          UPLOAD,
          'Touch the P0 foil with your other hand.',
        ],
        image: { src: 'assets/lesson-resistive.jpg', alt: 'A hand holding foil clipped to GND, the other hand touching foil clipped to P0' },
        inputs: [{ id: 'p0', mode: 'resistive' }],
      },
      {
        id: 'capacitive',
        title: 'Capacitive touch',
        intro: 'The micro:bit can also sense your body through a single piece of foil, without you holding anything else: your body holds a little electric charge, so the pin takes longer to charge up while you touch it. This works like the touchscreen on a phone, and it is useful for buttons that should feel like nothing at all.',
        steps: [
          'Fold a piece of foil a few times and clip it to pin P0.',
          UPLOAD + ' Keep your hands off the foil while it starts.',
          'Touch the foil.',
          'If it stays on after you let go, press A and B together to reset it.',
        ],
        image: { src: 'assets/lesson-capacitive.jpg', alt: 'A folded piece of foil clipped to P0' },
        inputs: [{ id: 'p0', mode: 'touch' }],
      },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    intro: 'The micro:bit can feel how it is tilted and moved, and which way it is facing. None of these need any wiring.',
    lessons: [
      {
        id: 'tilt',
        title: 'Tilt',
        intro: 'Pitch and roll measure how far the micro:bit is tilted, in degrees. This is useful for steering, like tilting a phone in a racing game.',
        steps: [
          UPLOAD,
          'Tilt the micro:bit forward and back, then side to side.',
        ],
        image: { src: 'assets/lesson-tilt.jpg', alt: 'A micro:bit tilted forward in a hand' },
        inputs: [{ id: 'pitch' }, { id: 'roll' }],
      },
      {
        id: 'gestures',
        title: 'Gestures',
        intro: 'The micro:bit recognizes quick movements like a shake or a fall, and sends a signal each time one happens. This is useful for one-off actions, like jumping when you shake a maraca.',
        steps: [
          UPLOAD,
          'Shake the micro:bit.',
          'Tap it on the table, then toss it gently and catch it.',
        ],
        image: { src: 'assets/lesson-gestures.jpg', alt: 'A micro:bit being shaken' },
        inputs: [{ id: 'shake' }, { id: 'g3' }, { id: 'freefall' }],
      },
      {
        id: 'compass',
        title: 'Compass',
        intro: 'The compass measures which direction the micro:bit is facing, in degrees from north. This is useful for turning, like a steering wheel or a dial.',
        steps: [
          UPLOAD,
          'Tilt the micro:bit around until every LED is lit. This calibrates the compass.',
          'Hold it flat and turn around slowly.',
        ],
        image: { src: 'assets/lesson-compass.jpg', alt: 'A micro:bit held flat and turned like a dial' },
        inputs: [{ id: 'heading' }],
      },
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient sensing',
    intro: 'The micro:bit can sense the room around it: how bright it is, how loud it is, and how warm it is. This is useful for controls you never touch, like clapping or covering a light.',
    lessons: [
      {
        id: 'ambient',
        title: 'Light, sound and temperature',
        intro: '',
        steps: [
          UPLOAD,
          'Cover the LEDs with your hand, then shine a light on them.',
          'Talk near the micro:bit, then clap once.',
          'Hold the micro:bit between your thumbs and watch the temperature rise.',
        ],
        image: { src: 'assets/lesson-ambient.jpg', alt: 'A hand cupped over the micro:bit LEDs' },
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

  // The photo straight under the title: what you are making, before any words
  // about it.
  const figure = el('figure', 'shot shot-slot');
  figure.setAttribute('aria-label', lesson.image.alt);
  figure.appendChild(document.createComment(` image slot: ${lesson.image.src} — ${lesson.image.alt} `));
  body.appendChild(figure);

  if (lesson.intro) body.appendChild(el('p', null, lesson.intro));

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

/**
 * The line joining a step's number to its lettered examples. Where it has to
 * end — the top of the last letter — depends on how long each example runs,
 * so it is measured, and measured again whenever the step changes size: a
 * fold opening, the window narrowing, the panel being shown at all (hidden,
 * everything measures zero).
 */
function railFor(item) {
  const update = () => {
    const num = item.querySelector(':scope > .step-num');
    const letters = item.querySelectorAll('.substep-num');
    if (!num || !letters.length) return;
    const top = item.getBoundingClientRect().top;
    const from = num.getBoundingClientRect().bottom - top;
    const to = letters[letters.length - 1].getBoundingClientRect().top - top;
    item.style.setProperty('--rail-top', `${from}px`);
    item.style.setProperty('--rail-height', `${Math.max(0, to - from)}px`);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(item);
  update();
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
      item.classList.add('has-substeps');
    } else {
      // A single example needs no letter: its parts sit straight in the step.
      const only = renderExample(section.lessons[0], 0, signalStore, views);
      const inner = only.querySelector('.substep-body');
      inner.querySelector('h4').remove();
      if (section.lessons[0].intro) inner.querySelector(':scope > p').remove();
      // Its photo goes under the step's own title, ahead of the step's intro.
      const figure = inner.querySelector(':scope > figure');
      const title = body.querySelector('h3');
      title.after(figure);
      body.append(...inner.childNodes);
    }
    item.append(el('span', 'step-num', String(index + 1)), body);
    list.appendChild(item);
  });
  host.appendChild(list);
  list.querySelectorAll('.step.has-substeps').forEach(railFor);

  return { destroy: () => views.forEach((view) => view.destroy()) };
}
