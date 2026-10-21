import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INPUT_CHOICES, WHEN_CHOICES, actionKind, canDrive, controlChoices, groupedInputChoices, inputChoice, normalizeRule,
  offered, offersPin, ownedHandlers, usesRange, rulesCode, rulesParts, sentencesFor, whenChoicesFor,
} from '../js/controls-codegen.js';
import { streamLoad } from '../js/builder.js';
import { findGame } from '../js/games/index.js';
import { loadAllRules, loadRules, saveRules } from '../js/rules-store.js';
import { memoryStorage } from './helpers/memory-storage.js';

const flappy = findGame('flappy').targets;
const jetpack = findGame('jetpack').targets;
const breaker = findGame('brickbreaker').targets;
const count = (text, needle) => text.split(needle).length - 1;

test('every input appears once, pins once per way of reading them', () => {
  const ids = INPUT_CHOICES.map((c) => c.id);
  assert.ok(ids.includes('btna') && ids.includes('light') && ids.includes('shake') && ids.includes('loud'));
  assert.ok(ids.includes('p0:touch') && ids.includes('p0:switch') && ids.includes('p0:analog'));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Object.keys(WHEN_CHOICES), ['binary', 'number', 'event']);
});

test('a when decides which kind of control may follow', () => {
  assert.deepEqual(controlChoices(flappy, 'pressed').map((c) => c.name), ['flap', 'advance']);
  assert.deepEqual(controlChoices(jetpack, 'held').map((c) => c.name), ['thrust', 'shift']);
  assert.deepEqual(controlChoices(breaker, 'between').map((c) => c.name), ['paddle', 'shift']);
  assert.equal(actionKind('above'), 'press');
  assert.equal(actionKind('while-below'), 'hold');
});

test('a rule is checked against the scheme, and its numbers filled in', () => {
  assert.equal(normalizeRule({ input: 'btna', when: 'pressed', control: 'thrust' }, flappy), null, 'not this scheme\'s control');
  assert.equal(normalizeRule({ input: 'btna', when: 'held', control: 'flap' }, flappy), null, 'wrong kind for a hold');
  assert.equal(normalizeRule({ input: 'nothing', when: 'pressed', control: 'flap' }, flappy), null);
  assert.deepEqual(normalizeRule({ id: 'a', input: 'light', when: 'above', control: 'flap' }, flappy),
    { id: 'a', input: 'light', when: 'above', control: 'flap', threshold: 127.5 });
  assert.deepEqual(normalizeRule({ input: 'pitch', when: 'between', control: 'paddle', low: '-40', high: 30 }, breaker),
    { id: '', input: 'pitch', when: 'between', control: 'paddle', low: -40, high: 30 });
});

// Blocks allows one handler per event, so every sentence on a button goes into
// the one DOWN handler the report already lives in.
test('two sentences on one button share its handler, after the report', () => {
  const program = rulesCode([
    { input: 'btna', when: 'pressed', control: 'flap' },
    { input: 'btna', when: 'pressed', control: 'advance' },
    { input: 'btna', when: 'held', control: 'shift' },
  ], flappy);
  assert.equal(count(program, 'EventBusValue.MICROBIT_BUTTON_EVT_DOWN'), 1);
  assert.equal(count(program, 'EventBusValue.MICROBIT_BUTTON_EVT_UP'), 1);
  const down = program.slice(program.indexOf('MICROBIT_BUTTON_EVT_DOWN'), program.indexOf('MICROBIT_BUTTON_EVT_UP'));
  assert.ok(down.indexOf('send("btna:1")') < down.indexOf('gamePress("flap")'));
  assert.ok(down.includes('gameStart()'), 'advance is the safe start');
  assert.ok(down.includes('gameHold("shift", true)'));
  const up = program.slice(program.indexOf('MICROBIT_BUTTON_EVT_UP'));
  assert.ok(up.includes('gameHold("shift", false)'), 'a hold is let go on UP');
});

test('a switch sentence goes inside the scan, and a touch pad keeps its calibration', () => {
  const program = rulesCode([
    { input: 'p1:switch', when: 'pressed', control: 'flap' },
    { input: 'p0:touch', when: 'held', control: 'shift' },
  ], flappy);
  assert.ok(program.includes('pins.setPull(DigitalPin.P1, PinPullMode.PullDown)'));
  const scan = program.slice(program.indexOf('loops.everyInterval(20'));
  assert.ok(scan.indexOf('send("p1:1")') < scan.indexOf('gamePress("flap")'));
  assert.ok(program.includes('pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)'));
  assert.ok(program.includes('EventBusSource.MICROBIT_ID_IO_P0'));
});

test('a pin is read one way: a second mode for the same pin is dropped', () => {
  const parts = rulesParts([
    { input: 'p0:touch', when: 'pressed', control: 'flap' },
    { input: 'p0:switch', when: 'pressed', control: 'advance' },
  ], flappy);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].form, 'pad');
});

test('a crossing fires once, with room to come back, and streams the reading', () => {
  const program = rulesCode([{ input: 'light', when: 'below', control: 'flap', threshold: 100 }], flappy);
  assert.ok(program.includes('lightNow = input.lightLevel()'));
  assert.equal(count(program, 'send("light:" + lightNow)'), 1, 'streamed once for tuning');
  assert.ok(program.includes('if (lightNow < 100) {'));
  assert.ok(program.includes('if (r1Past == 0) {'));
  assert.ok(program.includes('} else if (lightNow > 108) {'), 'three percent of 0–255 past the line');
  assert.ok(program.includes('let r1Past = 0'));
});

test('a while sentence holds and lets go, both paths present', () => {
  const program = rulesCode([{ input: 'light', when: 'while-below', control: 'thrust', threshold: 100 }], jetpack);
  assert.ok(program.includes('if (lightNow < 100 && r1On == 0) {'));
  assert.ok(program.includes('gameHold("thrust", true)'));
  assert.ok(program.includes('} else if (lightNow > 108 && r1On == 1) {'));
  assert.ok(program.includes('gameHold("thrust", false)'));
});

test('a steer maps the range to 0..1 and only speaks when it has moved', () => {
  const program = rulesCode([{ input: 'pitch', when: 'between', control: 'paddle', low: -40, high: 30 }], breaker);
  assert.ok(program.includes('r1Level = (pitchNow - -40) / 70'));
  assert.ok(program.includes('r1Level = Math.min(1, Math.max(0, r1Level))'));
  assert.ok(program.includes('if (Math.abs(r1Level - r1Last) > 0.02) {'));
  assert.ok(program.includes('gameSet("paddle", r1Level)'));
});

test('two sentences on one reading read it once', () => {
  const program = rulesCode([
    { input: 'light', when: 'above', control: 'flap', threshold: 200 },
    { input: 'light', when: 'while-below', control: 'shift', threshold: 50 },
  ], flappy);
  assert.equal(count(program, 'lightNow = input.lightLevel()'), 1);
  assert.equal(count(program, 'send("light:" + lightNow)'), 1);
  assert.ok(program.includes('r1Past') && program.includes('r2On'));
});

test('events fire once each, and an analog pin reads a voltage', () => {
  const program = rulesCode([
    { input: 'loud', when: 'happens', control: 'flap' },
    { input: 'shake', when: 'happens', control: 'advance' },
    { input: 'p2:analog', when: 'above', control: 'flap', threshold: 600 },
  ], flappy);
  assert.equal(count(program, 'input.onSound(DetectedSound.Loud, function () {'), 1);
  assert.ok(program.includes('send("loud:1")\n    gamePress("flap")'));
  assert.ok(program.includes('p2Now = pins.analogReadPin(AnalogPin.P2)'));
  assert.ok(program.includes('} else if (p2Now < 569) {'));
  assert.deepEqual(ownedHandlers([{ input: 'loud', when: 'happens', control: 'flap' }], flappy),
    [{ channel: 'loud', handler: 'input.onSound(DetectedSound.Loud, function () {' }]);
});

test('the program stays block-shaped, and the load is counted', () => {
  const rules = [
    { input: 'btna', when: 'pressed', control: 'flap' },
    { input: 'light', when: 'above', control: 'flap', threshold: 200 },
    { input: 'pitch', when: 'while-above', control: 'shift', threshold: 20 },
    { input: 'shake', when: 'happens', control: 'advance' },
  ];
  const program = rulesCode(rules, flappy, { extra: ['// mine'] });
  assert.ok(!program.includes('=>') && !program.includes('?') && !/\bconst\b/.test(program));
  assert.ok(program.endsWith('// mine'));
  const load = streamLoad(rulesParts(rules, flappy));
  assert.deepEqual({ streamed: load.streamed, pressed: load.pressed }, { streamed: 2, pressed: 1 });
});

test('sentences are kept per scheme and come back whole', () => {
  const storage = memoryStorage();
  saveRules(storage, 'flappy', [{ id: 'a', input: 'light', when: 'above', control: 'flap', threshold: '200', junk: 1 }]);
  saveRules(storage, 'jetpack', [{ id: 'b', input: 'btna', when: 'held', control: 'thrust' }, 'not a rule']);
  assert.deepEqual(loadRules(storage, 'flappy'), [{ id: 'a', input: 'light', when: 'above', control: 'flap', threshold: 200 }]);
  assert.deepEqual(loadRules(storage, 'jetpack'), [{ id: 'b', input: 'btna', when: 'held', control: 'thrust' }]);
  assert.deepEqual(Object.keys(loadAllRules(storage)), ['flappy', 'jetpack']);
  assert.deepEqual(loadRules(storage, 'spaceship'), []);
});

// --- The sentences a scheme needs ------------------------------------------------

// A scheme needs exactly the controls it steers with, already filled in with
// a touch pad on its own pin, so one foil and one clip gets a controller flying.
test('each scheme comes with its sentences, one per control, ready to fly', () => {
  const ids = (id) => sentencesFor(findGame(id)).map((r) => `${r.control}:${r.input}:${r.when}`);
  assert.deepEqual(ids('flappy'), ['flap:p0:touch:pressed']);
  assert.deepEqual(ids('jetpack'), ['thrust:p0:touch:held']);
  assert.deepEqual(ids('spaceship'), ['up:p0:touch:held', 'down:p1:touch:held']);
  assert.deepEqual(ids('brickbreaker'), ['paddle:pitch:between']);
  for (const id of ['flappy', 'jetpack', 'spaceship', 'brickbreaker']) {
    const game = findGame(id);
    const rules = sentencesFor(game);
    assert.ok(rulesCode(rules, game.targets).includes('game'), `${id} makes a program`);
  }
});

test('a saved sentence is kept when it fits, and a stray one is not added', () => {
  const game = findGame('spaceship');
  const rules = sentencesFor(game, [
    { input: 'p0:touch', when: 'held', control: 'down' },
    { input: 'loud', when: 'happens', control: 'advance' },
    { input: 'light', when: 'pressed', control: 'up' },
  ]);
  assert.deepEqual(rules.map((r) => `${r.id}=${r.control}:${r.input}`), ['slide.up=up:p0:touch', 'slide.down=down:p0:touch']);
});

test('the input list comes in groups, holding only what can drive the control', () => {
  const groups = groupedInputChoices();
  assert.deepEqual(groups.map(([label]) => label),
    ['Buttons & touch', 'Pins — crocodile clips', 'Tilt & direction', 'Gestures', 'Sound, light & heat']);
  assert.equal(groups.flatMap(([, c]) => c).length, INPUT_CHOICES.length, 'every input is in a group');
  const forLevel = groupedInputChoices((choice) => canDrive(choice, 'level'));
  assert.ok(!forLevel.some(([label]) => label === 'Gestures' || label === 'Buttons & touch'), 'a steer needs a number');
  assert.ok(forLevel.flatMap(([, c]) => c).every((c) => c.family === 'number'));
  assert.deepEqual(whenChoicesFor('binary', 'hold').map(([id]) => id), ['held']);
  assert.deepEqual(whenChoicesFor('number', 'press').map(([id]) => id), ['above', 'below']);
  assert.deepEqual(whenChoicesFor('number', 'hold').map(([id]) => id), ['while-above', 'while-below', 'while-between', 'while-outside']);
});

// One pin per sentence: the clip goes on P0, and a second control's clip on
// P1. Three pins times four modes in every dropdown was the confusing part.
test('a sentence is offered one pin, by its place in the list', () => {
  const p0 = inputChoice('p0:touch');
  const p1 = inputChoice('p1:switch');
  const p2 = inputChoice('p2:analog');
  assert.ok(offersPin(p0, 0) && !offersPin(p1, 0) && !offersPin(p2, 0));
  assert.ok(!offersPin(p0, 1) && offersPin(p1, 1));
  assert.ok(offersPin(inputChoice('btna'), 0) && offersPin(inputChoice('pitch'), 1), 'nothing else is held back');
  assert.ok(offersPin(p2, 0, 'p2:analog'), 'a saved build keeps the pin it already reads');
});

// Shorter still: the sentences leave out the board's own buttons and logo,
// and a pin read as a voltage. The catalogue keeps them for Sensing and for
// code written by hand.
test('the sentences do not offer the buttons, the logo, or an analog pin', () => {
  for (const id of ['btna', 'btnb', 'logo', 'p0:analog']) assert.ok(!offered(inputChoice(id), 0), `${id} is off the list`);
  for (const id of ['p0:touch', 'p0:switch', 'pitch', 'shake', 'loud']) assert.ok(offered(inputChoice(id), 0), `${id} is on it`);
  assert.ok(offered(inputChoice('btna'), 0, 'btna'), 'but a saved sentence keeps its button');
});

// A band rather than a line: held while the reading is inside it, or while
// it is outside it, with the same hysteresis either way.
test('is between and is not between hold inside or outside a band', () => {
  assert.ok(usesRange('while-between') && usesRange('while-outside') && usesRange('between') && !usesRange('while-above'));
  const inside = rulesCode([{ input: 'light', when: 'while-between', control: 'thrust', low: 50, high: 150 }], jetpack);
  assert.ok(inside.includes('if ((lightNow >= 50 && lightNow <= 150) && r1On == 0) {'));
  assert.ok(inside.includes('gameHold("thrust", true)'));
  assert.ok(inside.includes('} else if ((lightNow < 42 || lightNow > 158) && r1On == 1) {'), 'eight past either edge');
  assert.ok(inside.includes('gameHold("thrust", false)'));
  assert.ok(inside.includes('let r1On = 0'));

  const outside = rulesCode([{ input: 'light', when: 'while-outside', control: 'thrust', low: 50, high: 150 }], jetpack);
  assert.ok(outside.includes('if ((lightNow < 50 || lightNow > 150) && r1On == 0) {'));
  assert.ok(outside.includes('} else if ((lightNow >= 58 && lightNow <= 142) && r1On == 1) {'));

  const rule = normalizeRule({ input: 'light', when: 'while-between', control: 'thrust' }, jetpack);
  assert.deepEqual([rule.low, rule.high], [0, 255], 'a fresh band is the whole range');
});
