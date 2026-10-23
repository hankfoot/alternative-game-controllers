import test from 'node:test';
import assert from 'node:assert/strict';

import { matchImport, planImport } from '../js/theme/import-match.js';
import { SLOTS } from '../js/theme/defaults.js';
import { SOUND_EVENTS } from '../js/theme/audio.js';

test('the names the prompts ask for land exactly where they say', () => {
  for (const slot of SLOTS) {
    assert.deepEqual(matchImport(`${slot.id}.png`), { kind: 'sprite', slot: slot.id });
  }
  for (const [event] of SOUND_EVENTS) {
    assert.deepEqual(matchImport(`${event}.mp3`), { kind: 'sound', event });
  }
  assert.deepEqual(matchImport('music.mp3'), { kind: 'sound', event: 'music' });
});

test('names a person or a tool might use land in the right place too', () => {
  const cases = {
    'Far background.png': 'far',
    'pillar_1.png': 'obstacle',
    'The Sky.jpg': 'backdrop',
    'game/FloatingBlock.webp': 'block',
    'tree.png': 'near',
    'cloud-02.png': 'decor',
    'You.png': 'player',
  };
  for (const [name, slot] of Object.entries(cases)) {
    assert.equal(matchImport(name)?.slot, slot, name);
  }
  assert.equal(matchImport('explosion.wav')?.event, 'crash');
  assert.equal(matchImport('background music loop.ogg')?.event, 'music');
});

test('a name that says nothing is reported, not guessed at', () => {
  assert.equal(matchImport('image (3).png'), null);
  assert.equal(matchImport('notes.txt'), null);
  assert.equal(matchImport('player.txt'), null, 'a text file is not a drawing, whatever it is called');
});

test('one file per slot: a second is set aside and named', () => {
  const plan = planImport([
    { name: 'player.png' },
    { name: 'hero.png' },
    { name: 'crash.mp3' },
    { name: 'image (3).png' },
  ]);
  assert.deepEqual(plan.placed.map(({ file }) => file.name), ['player.png', 'crash.mp3']);
  assert.deepEqual(plan.doubled, ['hero.png']);
  assert.deepEqual(plan.unknown, ['image (3).png']);
});
