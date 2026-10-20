import assert from 'node:assert/strict';
import test from 'node:test';

import { LESSONS, lessonChannels, lessonCode } from '../js/lessons.js';

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

test('every lesson says where the clips go, and leaves room for a photo', () => {
  for (const lesson of LESSONS) {
    assert.ok(lesson.steps.length >= 3, `${lesson.id} has steps`);
    assert.match(lesson.image.src, /^assets\/lesson-/);
    assert.ok(lesson.image.alt);
  }
});

test('the four lessons cover touch, switch, analog and events', () => {
  assert.deepEqual(LESSONS.map((lesson) => lesson.id), ['touch', 'switch', 'analog', 'events']);
  assert.deepEqual(lessonChannels(byId('analog')), [
    { channel: 'pitch', kind: 'number' }, { channel: 'light', kind: 'number' }, { channel: 'p2', kind: 'number' },
  ]);
  assert.deepEqual(lessonChannels(byId('events')).map((c) => c.kind), ['event', 'event']);
});

// The lessons are made by the same assembler as the controller, so the fixes
// that cost a workshop are in every snippet.
test('the touch and switch lessons carry the pin fixes', () => {
  const touch = lessonCode(byId('touch'));
  assert.ok(touch.includes('pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)'));
  assert.ok(touch.indexOf('\ncountdown()\n') < touch.lastIndexOf('pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)'),
    'calibrated after the startup countdown');
  const sw = lessonCode(byId('switch'));
  assert.ok(sw.includes('pins.setPull(DigitalPin.P1, PinPullMode.PullDown)'));
  assert.ok(sw.includes('loops.everyInterval(20, function () {'), 'scanned, not edge-watched');
  assert.ok(!sw.includes('setEvents'));
});

test('the analog lesson reads a voltage off a pin', () => {
  const code = lessonCode(byId('analog'));
  assert.ok(code.includes('send("p2:" + pins.analogReadPin(AnalogPin.P2))'));
  assert.ok(code.includes('send("pitch:" + input.rotation(Rotation.Pitch))'));
  assert.ok(!code.includes('setPull'), 'an analog pin is not pulled');
});
