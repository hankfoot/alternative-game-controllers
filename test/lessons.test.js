import assert from 'node:assert/strict';
import test from 'node:test';

import { INPUTS } from '../js/builder.js';
import { LESSONS, SECTIONS, lessonChannels, lessonCode } from '../js/lessons.js';

const byId = (id) => LESSONS.find((lesson) => lesson.id === id);

// Each lesson's program sends its own channels and nothing else: the point of
// the screen is to see one thing arrive, and a stray reading from another
// lesson in the live rows would be the wrong thing to learn from.
test('each lesson streams exactly its own channels', () => {
  const all = new Set(LESSONS.flatMap((lesson) => lessonChannels(lesson).map((c) => c.channel)));
  for (const lesson of LESSONS) {
    const code = lessonCode(lesson);
    const mine = lessonChannels(lesson).map((c) => c.channel);
    for (const channel of all) {
      const sends = code.includes(`send("${channel}:`);
      assert.equal(sends, mine.includes(channel), `${lesson.id} ${sends ? 'sends' : 'does not send'} ${channel}`);
    }
  }
});

test('touch walks through three ways, motion through three examples, ambient is one', () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), ['touch', 'motion', 'ambient']);
  assert.deepEqual(SECTIONS[0].lessons.map((l) => l.id), ['switch', 'resistive', 'capacitive']);
  assert.deepEqual(SECTIONS[1].lessons.map((l) => l.id), ['tilt', 'acceleration', 'gestures', 'compass']);
  assert.deepEqual(SECTIONS[2].lessons.map((l) => l.id), ['ambient']);
});

test('every lesson says what to do, and leaves room for a photo', () => {
  for (const lesson of LESSONS) {
    assert.ok(lesson.setup && lesson.interact, `${lesson.id} says how to set it up and what to do with it`);
    assert.match(lesson.image.src, /^assets\/lesson-/);
    assert.ok(lesson.image.alt);
  }
  assert.equal(new Set(LESSONS.map((l) => l.image.src)).size, LESSONS.length, 'a photo of its own each');
});

// The lessons are made by the same assembler as the controller, so the fixes
// that cost a workshop are in every snippet.
test('the three touch lessons are wired the three different ways', () => {
  const sw = lessonCode(byId('switch'));
  assert.ok(sw.includes('pins.setPull(DigitalPin.P0, PinPullMode.PullDown)'));
  assert.ok(sw.includes('loops.everyInterval(20, function () {'), 'scanned, not edge-watched');
  assert.ok(!sw.includes('touchSetMode'));

  const resistive = lessonCode(byId('resistive'));
  assert.ok(resistive.includes('pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Resistive)'));
  assert.ok(resistive.includes('EventBusSource.MICROBIT_ID_IO_P0, EventBusValue.MICROBIT_BUTTON_EVT_DOWN'));
  assert.ok(!resistive.includes('Capacitive'), 'nothing capacitive about it');
  assert.ok(!resistive.includes('Button.AB'), 'and nothing to recalibrate');

  const capacitive = lessonCode(byId('capacitive'));
  assert.ok(capacitive.includes('\npins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)\n'), 'calibrated at startup');
  assert.ok(capacitive.includes('input.onButtonPressed(Button.AB'), 'with A+B to relearn');
});

test('motion and ambient examples need no pins', () => {
  for (const id of ['tilt', 'acceleration', 'gestures', 'compass', 'ambient']) {
    const code = lessonCode(byId(id));
    assert.ok(!code.includes('DigitalPin') && !code.includes('TouchTarget'), `${id} touches no pin`);
  }
  assert.deepEqual(lessonChannels(byId('tilt')), [{ channel: 'pitch', kind: 'number' }, { channel: 'roll', kind: 'number' }]);
  assert.deepEqual(lessonChannels(byId('ambient')).map((c) => `${c.channel}:${c.kind}`),
    ['light:number', 'mic:number', 'loud:event', 'quiet:event', 'temp:number'], 'one program reads all five');
  assert.ok(lessonCode(byId('compass')).includes('let calibrated = input.compassHeading()'), 'calibrates the compass at startup');
});

// Gestures cost the radio nothing between happenings, so the example shows
// every one the board knows: the point is to find out what each means in
// your hand, and a tile per gesture is how.
test('the gestures example shows every gesture there is', () => {
  const gestures = INPUTS.filter((input) => input.kind === 'event' && !['loud', 'quiet'].includes(input.id)).map((input) => input.id);
  const lesson = LESSONS.find((l) => l.id === 'gestures');
  assert.deepEqual(lesson.inputs.map((input) => input.id), gestures);
  assert.ok(gestures.length >= 10, `${gestures.length} gestures`);
  assert.ok(lesson.grid, 'laid out as tiles');
  for (const id of gestures) assert.ok(lessonCode(lesson).includes(`send("${id}:1")`), `${id} reported`);
});

test('acceleration is four live numbers, and quiet sits with the ambient senses', () => {
  const accel = LESSONS.find((l) => l.id === 'acceleration');
  assert.deepEqual(accel.inputs.map((i) => i.id), ['accel', 'accelx', 'accely', 'accelz']);
  const code = lessonCode(accel);
  for (const dim of ['Strength', 'X', 'Y', 'Z']) assert.ok(code.includes(`input.acceleration(Dimension.${dim})`), dim);
  assert.ok(code.includes('send("accel:" + accelNow)'));

  const ambient = LESSONS.find((l) => l.id === 'ambient');
  assert.ok(ambient.inputs.some((i) => i.id === 'quiet'));
  assert.ok(lessonCode(ambient).includes('input.onSound(DetectedSound.Quiet, function () {'));
  assert.ok(lessonCode(ambient).includes('send("quiet:1")'));
});
