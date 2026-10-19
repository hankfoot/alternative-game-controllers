import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrompt, describeInputs } from '../js/code-prompt.js';
import { controlsFor } from '../js/game-facade.js';
import { createSignalStore } from '../js/signal-store.js';
import { findGame } from '../js/games/index.js';

function inputsFor(planned) {
  const store = createSignalStore({ subscribeInput: () => () => {}, now: () => 0 });
  store.setPlannedChannels(planned);
  return describeInputs(store.all());
}

const game = findGame('brickbreaker');
const controls = controlsFor(game.targets);

// The whole point of generating the text is that the names in it are the
// names that work. So every control, and every input already taken, is in it.
test('the prompt names every control of the picked scheme, with the helper that drives it', () => {
  const text = buildPrompt({ inputs: [], controls, schemeName: game.label, schemeTagline: game.tagline });
  assert.match(text, /\(scheme: Breaker\)/);
  assert.match(text, /- `paddle` \(level\): .* → `gameSet\("paddle", 0\.5\)`/);
  assert.match(text, /- `shift` \(hold\): .* → `gameHold\("shift", true\)`/);
  assert.match(text, /- `shift` \(level\): .* → `gameSet\("shift", 0\.5\)`/);
  assert.match(text, /- `advance` \(press\): starts a round.*`gameStart\(\)`/);
  assert.ok(text.includes(game.tagline));
});

test('the prompt says which inputs the program already reads, and how a pin is set up', () => {
  const inputs = inputsFor([{ channel: 'p0', kind: 'binary', mode: 'Switch', form: 'switch' }, 'pitch', 'loud']);
  const text = buildPrompt({ inputs, controls });
  assert.match(text, /- `p0`: Pin 0 as a Switch/);
  assert.match(text, /- `pitch`: Pitch\n/);
  assert.match(text, /- `loud`: Loud sound\n/);
  assert.match(text, /do not change the mode or pull of a pin listed above/);
  assert.match(buildPrompt({ inputs: inputsFor([]), controls }), /Nothing yet\. You may set up any input/);
});

// The sentence they typed is the whole point of the copy; it goes last, after
// every rule the answer has to follow.
test('what they asked for closes the prompt, after the rules', () => {
  const text = buildPrompt({ inputs: [], controls, request: '  flap every third clap ' });
  const ask = text.indexOf('## What they want\n\nflap every third clap\n');
  assert.ok(ask > 0);
  assert.ok(ask > text.indexOf('## Writing MakeCode'), 'after the rules');
  assert.ok(ask > text.indexOf('## Example 2'), 'and after the examples');
  assert.match(text.slice(ask), /Write the code for that/);
  assert.match(buildPrompt({ inputs: [], controls }), /\(They will describe it in the next message\.\)/);
});

test('the four helpers are documented, and the examples use them', () => {
  const text = buildPrompt({ inputs: [], controls });
  for (const helper of ['gamePress("flap")', 'gameHold("thrust", true)', 'gameSet("paddle", 0.5)', 'gameStart()']) {
    assert.ok(text.includes(helper), `documents ${helper}`);
  }
  assert.match(text, /input\.onSound\(DetectedSound\.Loud, function \(\) \{\n    claps \+= 1/);
  assert.match(text, /gameSet\("paddle", height\)/);
  assert.match(text, /input\.onButtonPressed` fires when the button is \*released\*/);
  assert.ok(!/\bconst\b/.test(text.replace(/No classes, arrow functions, ternaries, `const`/, '')),
    'the examples are block-shaped MakeCode: no const');
  assert.ok(!text.includes('=>'), 'and no arrow functions');
});

// A `null` or `undefined` in the text would be read by an LLM as a fact.
test('nothing missing leaks into the text as a word', () => {
  const inputs = inputsFor(['p0', 'heading', 'shake']);
  const text = buildPrompt({ inputs, controls: controlsFor(findGame('flappy').targets) });
  for (const leak of ['undefined', 'null', 'NaN', '[object']) {
    assert.ok(!text.includes(leak), `no "${leak}" in the prompt`);
  }
});
