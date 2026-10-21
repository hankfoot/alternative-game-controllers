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
    intro: 'Electricity only flows when it has a complete path to travel, called a circuit. Each of these examples gives your micro:bit a different way to notice when that path is completed.',
    note: 'For the best results, stick your foil or copper tape onto something stiff, like cardboard, or fold it over on itself, so the crocodile clips have something to grip.',
    lessons: [
      {
        id: 'switch',
        title: 'Switch',
        intro: 'A switch is two pieces of metal that let electricity through only when they touch, like the light switch on a wall. Foil works well because metal carries electricity easily. We can attach foil to two objects to detect when they come together, like a lid closing on a jar or a door shutting.',
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
        intro: 'Your body carries electricity too, just not as easily as metal. The micro:bit can be set to notice even the tiny amount that passes through a person, so when you hold one foil and touch the other, you become part of the path. This is how a fruit piano works: a banana or a lump of Play-Doh carries enough electricity to become a button.',
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
        intro: 'Your body also holds a small amount of electric charge, a bit like a sponge holds water. With just one piece of foil, the micro:bit can feel that charge when your finger touches it, so you don’t need to hold anything else. This is how a phone’s touchscreen works, and it is useful for buttons that should feel like nothing at all.',
        steps: [
          'Clip one piece of foil to pin P0.',
          UPLOAD + ' Keep your hands off the foil while it starts.',
          'Touch the foil.',
          'If it stays on after you let go, press A and B together to reset it.',
        ],
        image: { src: 'assets/lesson-capacitive.jpg', alt: 'A piece of foil clipped to P0' },
        inputs: [{ id: 'p0', mode: 'touch' }],
      },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    intro: 'Inside the micro:bit are tiny sensors that can feel movement. One feels which way gravity is pulling, and another works like a compass. None of these examples need any wiring.',
    lessons: [
      {
        id: 'tilt',
        title: 'Tilt',
        intro: 'When you tilt the micro:bit, it can tell how far by feeling which way gravity is pulling on it. Tipping it forward and back is called pitch, and tipping it side to side is called roll. Both are measured in degrees. This is useful for steering, like tilting a phone in a racing game.',
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
        intro: 'The same sensor can also recognize quick movements, like a shake, a bump, or a moment of falling. Each time one happens, the micro:bit sends a single signal. This is useful for one-off actions, like jumping when you shake a maraca.',
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
        intro: 'The micro:bit can also feel the Earth’s magnetism, just like the needle of a compass. It reports which way it is facing in degrees, where 0 is north. This is useful for turning, like a steering wheel or a dial. Laptops and speakers have magnets of their own, so keep it away from them.',
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
    intro: 'The micro:bit can also sense the room around it. Its lights can measure how bright it is, its microphone can hear how loud it is, and its chip can tell how warm it is. This is useful for controls you never touch, like clapping or covering a light.',
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
 * A card: one row with the fold's label on the left and the copy button on the
 * right, and the code under it when the fold is open. The button sits inside
 * the <summary> so the two share a row; the handler in main.js stops its click
 * from toggling the fold, and finds the `code` by the card rather than the
 * button's parent.
 */
export function copyBlock(code, label) {
  const block = el('div', 'code-block code-block-folded');
  const details = el('details', 'code-details');
  const summary = el('summary');
  summary.appendChild(el('span', 'code-fold-label', 'See the code'));
  const copy = el('button', 'code-copy btn', label);
  copy.type = 'button';
  summary.appendChild(copy);
  const pre = el('pre', 'code-prompt');
  pre.appendChild(el('code', null, code));
  details.append(summary, pre);
  block.appendChild(details);
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
    if (section.note) body.appendChild(el('p', 'note', section.note));
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
