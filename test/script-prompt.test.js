import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrompt, describeInputs } from '../js/script-prompt.js';
import { controlsFor } from '../js/script-runner.js';
import { createSignalStore } from '../js/signal-store.js';
import { findGame } from '../js/games/index.js';

function inputsFor(planned, live = []) {
  const listeners = new Set();
  const store = createSignalStore({ subscribeInput: (fn) => { listeners.add(fn); return () => {}; }, now: () => 0 });
  store.setPlannedChannels(planned);
  for (const msg of live) listeners.forEach((fn) => fn(msg));
  return describeInputs(store.all());
}

const game = findGame('brickbreaker');
const controls = controlsFor(game.targets);

// The whole point of generating the text is that the names in it are the
// names that work. So every channel and every control has to be in there.
test('the prompt names every input the person has, with its range and unit', () => {
  const inputs = inputsFor(['pitch', 'btna', 'loud'], [{ channel: 'mystery', value: 37 }]);
  const text = buildPrompt({ inputs, controls, schemeName: game.label, schemeTagline: game.tagline });
  assert.match(text, /- `pitch` \(number, -90 to 90 °\): Tipped forward or back/);
  assert.match(text, /- `btna` \(on\/off, 0 or 1\):/);
  assert.match(text, /- `loud` \(event, 1\):/);
  assert.match(text, /- `mystery` \(number, 0 to 37\):/, 'a channel the board invented is listed too');
  assert.match(text, /Arrives about ten times a second\./);
  assert.match(text, /1 when pressed or closed, 0 when released/);
});

test('the prompt names every control of the picked scheme, with the call that drives it', () => {
  const text = buildPrompt({ inputs: [], controls, schemeName: game.label, schemeTagline: game.tagline });
  assert.match(text, /\(scheme: Breaker\)/);
  assert.match(text, /- `paddle` \(level\): .* → `game\.set\('paddle', 0\.5\)`/);
  assert.match(text, /- `shift` \(hold\): .* → `game\.hold\('shift', true\)`/);
  assert.match(text, /- `shift` \(level\): .* → `game\.set\('shift', 0\.5\)`/);
  assert.match(text, /- `advance` \(press\): starts a round.*`game\.start\(\)`/);
  assert.ok(text.includes(game.tagline));
});

test('with nothing enabled the prompt says so instead of listing nothing', () => {
  const text = buildPrompt({ inputs: inputsFor([]), controls });
  assert.match(text, /No inputs are enabled yet/);
});

test('both worked examples are there, and the API block covers every call', () => {
  const text = buildPrompt({ inputs: inputsFor(['loud']), controls });
  assert.match(text, /inputs\.onPress\('loud'/);
  assert.match(text, /game\.press\('flap'\)/);
  assert.match(text, /inputs\.on\('pitch'/);
  assert.match(text, /game\.set\('paddle', height\)/);
  assert.match(text, /inputs\.publish\('height'/);
  for (const call of ['inputs.on(', 'inputs.onPress(', 'inputs.value(', 'inputs.list(', 'inputs.publish(',
    'game.press(', 'game.hold(', 'game.set(', 'game.start(', 'game.phase(', 'game.controls(']) {
    assert.ok(text.includes(call), `documents ${call}`);
  }
  assert.match(text, /send\("name:" \+ number\)/, 'and the on-the-board route');
});

// A `null` or `undefined` in the text would be read by an LLM as a fact.
test('nothing missing leaks into the text as a word', () => {
  const inputs = inputsFor(['p0', 'heading', 'shake'], [{ channel: 'odd', value: 0 }]);
  const text = buildPrompt({ inputs, controls: controlsFor(findGame('flappy').targets) });
  // The fixed API reference legitimately says "undefined"; the generated part
  // is everything before it.
  const generated = text.slice(0, text.indexOf('## The API'));
  assert.ok(generated.length > 200);
  for (const leak of ['undefined', 'null', 'NaN', '[object']) {
    assert.ok(!generated.includes(leak), `no "${leak}" in the prompt`);
  }
});
