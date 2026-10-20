// What is missing between the controller somebody built and the game.
//
// The sentences on Controls look finished on their own while adding up to a
// game that cannot be flown — a scheme that slides both ways with only "up"
// written, or nothing written at all. So the check belongs here, at the point
// where you find out, and it names the one thing furthest from done rather
// than listing them all.
//
// It is never a blocker. The keys still work, and every message says so: a room
// halfway through building a controller should still be able to play.

import { actionKind } from './controls-codegen.js';
import { controlsFor } from './game-facade.js';

const COUNTS = ['no', 'one', 'two', 'three', 'four'];
const count = (n) => COUNTS[n] ?? String(n);

/**
 * What is wrong with the sentences right now, or null when the controller can
 * fly the craft. Deliberately says nothing about how to word it: this is the
 * half worth testing, and it has no business knowing what a document is.
 *
 * `steering` is what the scheme says it needs — see the SCHEMES merge in
 * js/games/sidescroller.js. `rules` are sentences already checked against
 * `targets` (see normalizeRule in js/controls-codegen.js).
 */
export function diagnose({ steering, targets, rules }) {
  // Which "node.port" each sentence ends up driving.
  const driven = new Set();
  const controls = controlsFor(targets);
  for (const rule of rules) {
    const control = controls.find((c) => c.name === rule.control && c.kind === actionKind(rule.when));
    if (control) driven.add(`${control.node}.${control.port}`);
  }

  const needed = steering.map((control) => ({
    label: control.label,
    total: control.keys.length,
    done: control.keys.filter((key) => driven.has(key)).length,
  }));

  if (!rules.length) return { reason: 'no-rules', level: 'empty', controls: needed };
  if (needed.every((control) => control.done === 0)) return { reason: 'nothing-steered', level: 'empty', controls: needed };

  // A half-written control is worse than an unwritten one and reads worse too —
  // the craft moves, just never back — so it is the one that gets named first.
  const partial = needed.find((control) => control.done > 0 && control.done < control.total);
  if (partial) return { reason: 'half-steered', level: 'partial', control: partial };

  const empty = needed.find((control) => control.done === 0);
  if (empty) return { reason: 'control-unsteered', level: 'partial', control: empty };

  return null;
}

/** A link into another screen, using the same delegated handler the pagers do. */
function tabLink(label, target) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link-btn';
  button.dataset.tabTarget = target;
  button.textContent = label;
  return button;
}

function strong(text) {
  const element = document.createElement('strong');
  element.textContent = text;
  return element;
}

const controlsLink = () => tabLink('Controls', 'controls');

/** The finding, in words. */
function describe(found) {
  if (found.reason === 'no-rules') {
    return [
      'Your controller has no sentences yet, so nothing it does reaches the game. Write one on ',
      controlsLink(),
      '.',
    ];
  }
  if (found.reason === 'nothing-steered') {
    return [
      'Nothing on your controller steers the game yet. Write a sentence that ends in ',
      strong(found.controls.map((control) => control.label).join(' or ')),
      ' on ',
      controlsLink(),
      '.',
    ];
  }
  if (found.reason === 'half-steered') {
    return [
      strong(found.control.label),
      ` takes ${count(found.control.total)} controls and only ${count(found.control.done)} has a sentence,`
      + ' so the craft can only go one way. Add the other on ',
      controlsLink(),
      '.',
    ];
  }
  return [
    'No sentence ends in ',
    strong(found.control.label),
    ' yet — write one on ',
    controlsLink(),
    '.',
  ];
}

export function initGameWarning({ element, host, controls, bridge = null }) {
  if (!element || !host || !controls) return null;

  function render() {
    // A board sending game commands from code somebody wrote by hand answers
    // for the controls itself; the check cannot see inside its program. So
    // while commands arrive the diagnosis stands down, and says so.
    if (bridge?.driven()) {
      element.hidden = false;
      element.dataset.level = 'script';
      element.replaceChildren('Your micro:bit is controlling the game. The keys below the game work too.');
      return;
    }
    const game = host.activeGame();
    const found = game?.steering
      ? diagnose({ steering: game.steering, targets: game.targets, rules: controls.rules() })
      : null;

    element.hidden = !found;
    if (!found) {
      // Emptied rather than just hidden: this is a live region, and leaving the
      // last complaint sitting in it means the next one that happens to match it
      // word for word is never announced.
      element.replaceChildren();
      return;
    }
    element.dataset.level = found.level;
    element.replaceChildren(
      ...describe(found),
      // Said every time rather than once, because it is the reassuring half and
      // whoever is reading this is looking at the alarming half.
      ' The keys below the game work too.',
    );
  }

  controls.subscribe(render);
  host.onGameChange(render);
  bridge?.subscribe((event) => {
    if (event.type === 'driven') render();
  });
  render();
  return { render };
}
