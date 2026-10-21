// Sentences into a program.
//
// A controller on the Controls screen is a list of sentences — "when Button A
// is pressed, flap"; "when light goes below 100, hold thrust"; "pitch steers
// paddle between -40 and 30" — and this turns them into the MakeCode program
// the board runs. The program reads the inputs the sentences use, sends every
// reading so the page can show it against the threshold being tuned, and
// drives the game through the four helpers (see js/game-commands.js).
//
// It builds on the input catalogue in js/builder.js rather than beside it: the
// same scaffold, the same pin fixes, and — the part that matters most — the
// same handler for an input's event as the one that reports it. MakeCode's
// Blocks view allows one handler per event, so every sentence on Button A goes
// into the one DOWN handler, right after the line that reports the press.
//
// Pure. Nothing here knows what a dropdown is.

import { INPUTS, assemble, handler, switchScan, variantFor } from './builder.js';
import { channelInfo } from './channels.js';
import { controlsFor } from './game-facade.js';

// --- What a sentence can say -------------------------------------------------

// The inputs a sentence can start with. A pin appears once per way of reading
// it; the screen lets a pin be read one way at a time.
// A compass bearing is a number to a sentence: "goes above 180" is a thing to
// say about it, even if the seam at north makes it a poor dial.
const family = (kind) => (kind === 'bearing' ? 'number' : kind);

export const INPUT_CHOICES = INPUTS.flatMap((input) => {
  if (!input.modes) {
    return [{ id: input.id, label: input.name, family: family(input.kind), catalogue: input.id, mode: null }];
  }
  return Object.entries(input.modes).map(([mode, variant]) => ({
    id: `${input.id}:${mode}`,
    label: `${input.name} ${variant.label.toLowerCase()}`,
    family: family(variant.kind),
    catalogue: input.id,
    mode,
    pin: input.id,
  }));
});

// How the input dropdown is grouped: what a person reaches for first is the
// kind of thing, not its name.
export const INPUT_GROUPS = [
  ['Buttons & touch', ['btna', 'btnb', 'logo']],
  ['Pins — crocodile clips', ['p0', 'p1', 'p2']],
  ['Tilt & direction', ['pitch', 'roll', 'heading', 'accel', 'accelx', 'accely', 'accelz']],
  ['Gestures', ['shake', 'tiltleft', 'tiltright', 'logoup', 'logodown', 'faceup', 'facedown', 'freefall', 'g3', 'g6', 'g8']],
  ['Sound, light & heat', ['loud', 'quiet', 'mic', 'light', 'temp']],
];

/**
 * The input choices in their groups, as `[label, choices]`, keeping only the
 * ones `keep` accepts and dropping a group left empty. Anything the catalogue
 * has that no group names lands in "Other", so a new input is never lost.
 */
export function groupedInputChoices(keep = () => true) {
  const named = new Set(INPUT_GROUPS.flatMap(([, ids]) => ids));
  const groups = INPUT_GROUPS.map(([label, ids]) => [
    label, INPUT_CHOICES.filter((choice) => ids.includes(choice.catalogue) && keep(choice)),
  ]);
  groups.push(['Other', INPUT_CHOICES.filter((choice) => !named.has(choice.catalogue) && keep(choice))]);
  return groups.filter(([, choices]) => choices.length);
}

export const WHEN_CHOICES = {
  binary: [['pressed', 'is pressed'], ['held', 'is held']],
  number: [
    ['above', 'goes above'], ['below', 'goes below'],
    ['while-above', 'is above'], ['while-below', 'is below'],
    ['while-between', 'is between'], ['while-outside', 'is not between'],
    ['between', 'steers between'],
  ],
  event: [['happens', 'happens']],
};

/**
 * Which pin a sentence is offered: the first sentence gets P0, the second
 * P1, and so on. Twelve pin entries across three sentences was most of the
 * dropdown and all of its confusion — the clip goes on P0 unless there are
 * two controls, in which case the second goes on P1, and that is the whole
 * rule.
 */
export function offersPin(choice, slot) {
  if (!choice.pin) return true;
  return choice.pin === `p${Math.min(slot, 2)}`;
}

// What the sentences leave out, to keep the list short: the board's own
// buttons and logo, which are not part of a controller you build, and a pin
// read as a voltage, which needs a drawn resistor to mean anything. Still in
// the catalogue for the Sensing page and for code written by hand — but never
// in a Controls menu, not even for a saved sentence that used one: that
// sentence goes back to its starter instead (see `sentencesFor`).
const NOT_OFFERED = new Set(['btna', 'btnb', 'logo']);
export function offered(choice, slot) {
  if (NOT_OFFERED.has(choice.catalogue) || choice.mode === 'analog') return false;
  return offersPin(choice, slot);
}

/** The whens that take a low and a high rather than one threshold. */
export const usesRange = (when) => when === 'between' || when === 'while-between' || when === 'while-outside';

/** The kind of control a `when` can drive. */
export function actionKind(when) {
  if (when === 'held' || when === 'while-above' || when === 'while-below'
    || when === 'while-between' || when === 'while-outside') return 'hold';
  if (when === 'between') return 'level';
  return 'press';
}

export const inputChoice = (id) => INPUT_CHOICES.find((choice) => choice.id === id) ?? null;

/** The `when` choices for an input family that drive a control of this kind. */
export function whenChoicesFor(family, kind) {
  return (WHEN_CHOICES[family] ?? []).filter(([when]) => actionKind(when) === kind);
}

/** Whether an input can say anything at all about a control of this kind. */
export const canDrive = (choice, kind) => whenChoicesFor(choice.family, kind).length > 0;

/** The controls a sentence with this `when` may end with, for the scheme's targets. */
export function controlChoices(targets, when) {
  const kind = actionKind(when);
  return controlsFor(targets).filter((control) => control.kind === kind);
}

/**
 * A rule with everything checked, or null. A rule whose control is not in
 * this scheme is dropped, not kept: the sentence it made would do nothing.
 */
export function normalizeRule(rule, targets) {
  if (!rule || typeof rule !== 'object') return null;
  const choice = inputChoice(rule.input);
  if (!choice) return null;
  const whens = WHEN_CHOICES[choice.family].map(([id]) => id);
  if (!whens.includes(rule.when)) return null;
  if (!controlChoices(targets, rule.when).some((control) => control.name === rule.control)) return null;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const info = channelInfo(choice.catalogue);
  const span = { min: info.min ?? 0, max: info.max ?? 1 };
  const normalized = { id: String(rule.id ?? ''), input: choice.id, when: rule.when, control: rule.control };
  if (choice.family === 'number') {
    if (usesRange(rule.when)) {
      normalized.low = num(rule.low, span.min);
      normalized.high = num(rule.high, span.max);
    } else {
      normalized.threshold = num(rule.threshold, (span.min + span.max) / 2);
    }
  }
  return normalized;
}

// --- The sentences a scheme needs ------------------------------------------------

// Where a sentence starts before anybody has touched it: something that works
// with no wiring at all, so a fresh controller flies from the first download.
// A touch pad on the sentence's own pin (P0, or P1 for the second control):
// one foil and one clip, the simplest thing that is also real wiring.
function starter(control, index) {
  if (control.kind === 'press') return { input: `p${Math.min(index, 2)}:touch`, when: 'pressed' };
  if (control.kind === 'hold') return { input: `p${Math.min(index, 2)}:touch`, when: 'held' };
  return { input: 'pitch', when: 'between', low: -40, high: 40 };
}

/**
 * One sentence per control the scheme steers with, in the scheme's order.
 *
 * The controls are fixed — a scheme needs exactly these — and only how each
 * is triggered is chosen. A saved sentence for a control is kept when it
 * still makes sense; otherwise the control gets a starter that needs no
 * wiring. Each sentence's id is the control's own "node.port".
 */
export function sentencesFor(game, stored = []) {
  if (!game) return [];
  const controls = controlsFor(game.targets);
  const keys = (game.steering ?? []).flatMap((control) => control.keys);
  return keys.map((key, index) => {
    const control = controls.find((c) => `${c.node}.${c.port}` === key);
    if (!control) return null;
    const saved = stored.find((rule) => rule?.control === control.name && actionKind(rule.when) === control.kind);
    // A saved sentence on something the menus no longer offer — a button, an
    // analog pin, the wrong pin for its place — is not kept: it would be the
    // one entry in the list nobody could pick again.
    const allowed = saved && inputChoice(saved.input) && offered(inputChoice(saved.input), index);
    const rule = (allowed ? normalizeRule(saved, game.targets) : null)
      ?? normalizeRule({ ...starter(control, index), control: control.name }, game.targets);
    return rule ? { ...rule, id: key } : null;
  }).filter(Boolean);
}

// --- The program ----------------------------------------------------------------

const call = (control) => (control === 'advance' ? 'gameStart()' : `gamePress("${control}")`);
const hold = (control, on) => `gameHold("${control}", ${on ? 'true' : 'false'})`;

// How far past a threshold a reading has to come back before it may cross
// again: three percent of the input's range, so a reading sitting on the line
// does not fire on every wobble.
function hysteresis(channel) {
  const info = channelInfo(channel);
  const span = (info.max ?? 1) - (info.min ?? 0);
  return Math.max(1, Math.round(span * 0.03));
}

function numberRuleLines(rule, name, now, channel) {
  const lines = [];
  if (rule.when === 'above' || rule.when === 'below') {
    const past = rule.when === 'above' ? `${now} > ${rule.threshold}` : `${now} < ${rule.threshold}`;
    const back = rule.when === 'above'
      ? `${now} < ${rule.threshold - hysteresis(channel)}`
      : `${now} > ${rule.threshold + hysteresis(channel)}`;
    lines.push(
      `if (${past}) {`,
      `    if (${name}Past == 0) {`,
      `        ${name}Past = 1`,
      `        ${call(rule.control)}`,
      `    }`,
      `} else if (${back}) {`,
      `    ${name}Past = 0`,
      `}`,
    );
  } else if (rule.when === 'while-above' || rule.when === 'while-below') {
    const past = rule.when === 'while-above' ? `${now} > ${rule.threshold}` : `${now} < ${rule.threshold}`;
    const back = rule.when === 'while-above'
      ? `${now} < ${rule.threshold - hysteresis(channel)}`
      : `${now} > ${rule.threshold + hysteresis(channel)}`;
    lines.push(
      `if (${past} && ${name}On == 0) {`,
      `    ${name}On = 1`,
      `    ${hold(rule.control, true)}`,
      `} else if (${back} && ${name}On == 1) {`,
      `    ${name}On = 0`,
      `    ${hold(rule.control, false)}`,
      `}`,
    );
  } else if (rule.when === 'while-between' || rule.when === 'while-outside') {
    // Held while the reading is inside the band (or outside it), let go once
    // it has come back out (or in) by the hysteresis, so a reading sitting on
    // either edge does not flicker the control.
    const h = hysteresis(channel);
    const inside = `${now} >= ${rule.low} && ${now} <= ${rule.high}`;
    const outside = `${now} < ${rule.low} || ${now} > ${rule.high}`;
    const past = rule.when === 'while-between' ? inside : outside;
    const back = rule.when === 'while-between'
      ? `${now} < ${rule.low - h} || ${now} > ${rule.high + h}`
      : `${now} >= ${rule.low + h} && ${now} <= ${rule.high - h}`;
    lines.push(
      `if ((${past}) && ${name}On == 0) {`,
      `    ${name}On = 1`,
      `    ${hold(rule.control, true)}`,
      `} else if ((${back}) && ${name}On == 1) {`,
      `    ${name}On = 0`,
      `    ${hold(rule.control, false)}`,
      `}`,
    );
  } else if (rule.when === 'between') {
    const span = rule.high - rule.low || 1;
    lines.push(
      `${name}Level = (${now} - ${rule.low}) / ${span}`,
      `${name}Level = Math.min(1, Math.max(0, ${name}Level))`,
      `if (Math.abs(${name}Level - ${name}Last) > 0.02) {`,
      `    ${name}Last = ${name}Level`,
      `    gameSet("${rule.control}", ${name}Level)`,
      `}`,
    );
  }
  return lines;
}

function numberRuleState(rule, name) {
  if (rule.when === 'above' || rule.when === 'below') return [`let ${name}Past = 0`];
  if (actionKind(rule.when) === 'hold') return [`let ${name}On = 0`];
  return [`let ${name}Level = 0`, `let ${name}Last = -1`];
}

/**
 * The parts of the program, one per input the sentences use, each the
 * catalogue's variant with the sentences' lines folded into its own handler,
 * scan or loop. Rules that fail `normalizeRule` are left out.
 */
export function rulesParts(rules, targets) {
  const valid = rules.map((rule) => normalizeRule(rule, targets)).filter(Boolean);
  // One mode per pin: the first sentence to use a pin decides how it is read.
  const pinMode = new Map();
  const byInput = new Map();
  valid.forEach((rule, index) => {
    const choice = inputChoice(rule.input);
    if (choice.pin) {
      if (!pinMode.has(choice.pin)) pinMode.set(choice.pin, choice.mode);
      if (pinMode.get(choice.pin) !== choice.mode) return;
    }
    if (!byInput.has(choice.id)) byInput.set(choice.id, []);
    byInput.get(choice.id).push({ rule, name: `r${index + 1}` });
  });

  const parts = [];
  for (const [inputId, entries] of byInput) {
    const choice = inputChoice(inputId);
    const variant = variantFor(choice.catalogue, choice.mode);
    const channel = variant.channels[0];
    if (choice.family === 'event') {
      const body = [`send("${channel}:1")`, ...entries.map(({ rule }) => call(rule.control))];
      parts.push({ ...variant, handlers: handler(variant.event, body) });
    } else if (choice.family === 'binary') {
      const down = entries.map(({ rule }) => (rule.when === 'held' ? hold(rule.control, true) : call(rule.control)));
      const up = entries.filter(({ rule }) => rule.when === 'held').map(({ rule }) => hold(rule.control, false));
      if (variant.events) {
        parts.push({
          ...variant,
          handlers: [
            ...handler(variant.events.down, [`send("${channel}:1")`, ...down]),
            ...handler(variant.events.up, [`send("${channel}:0")`, ...up]),
          ],
        });
      } else {
        parts.push({ ...variant, scan: switchScan(channel, variant.pin, { onClose: down, onOpen: up }) });
      }
    } else {
      // The catalogue's own loop reads the value into `<channel>Now` and sends
      // it when it has changed; the sentences read the same variable after.
      const now = `${channel}Now`;
      parts.push({
        ...variant,
        state: [...variant.state, ...entries.flatMap(({ rule, name }) => numberRuleState(rule, name))],
        loop: [
          ...variant.loop,
          ...entries.flatMap(({ rule, name }) => numberRuleLines(rule, name, now, channel)),
        ],
      });
    }
  }
  return parts;
}

/** The whole program for a list of sentences, with hand-written lines after. */
export function rulesCode(rules, targets, { extra = [] } = {}) {
  return assemble(rulesParts(rules, targets), { extra });
}

/**
 * The event handlers the program owns, by the catalogue input that owns each,
 * for telling an LLM not to write a second one.
 */
export function ownedHandlers(rules, targets) {
  return rulesParts(rules, targets)
    .filter((part) => part.events || part.event)
    .map((part) => ({ channel: part.channels[0], handler: part.event ?? part.events.down }));
}
