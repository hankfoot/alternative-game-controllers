import assert from 'node:assert/strict';
import test from 'node:test';

import { SCRIPT_LIMIT, clearScript, loadScript, normalizeScript, saveScript } from '../js/script-storage.js';
import { memoryStorage } from './helpers/memory-storage.js';

test('a script round-trips with what it was for and whether it was running', () => {
  const storage = memoryStorage();
  saveScript(storage, { source: 'game.press("flap")', request: 'flap on clap', autoRun: true });
  assert.deepEqual(loadScript(storage), { source: 'game.press("flap")', request: 'flap on clap', autoRun: true });
  saveScript(storage, { source: 'game.press("flap")' });
  assert.deepEqual(loadScript(storage), { source: 'game.press("flap")', request: '', autoRun: false },
    'not running unless said so');
});

// The sentence is typed before there is any script, and losing it on a refresh
// is losing the one thing that was theirs.
test('a request with no script yet is still kept, and cannot be marked to run', () => {
  const storage = memoryStorage();
  saveScript(storage, { request: 'chair height steers', autoRun: true });
  assert.deepEqual(loadScript(storage), { source: '', request: 'chair height steers', autoRun: false });
});

test('nothing worth keeping clears the record', () => {
  const storage = memoryStorage();
  saveScript(storage, { source: 'x', autoRun: true });
  saveScript(storage, { source: '   ', autoRun: true });
  assert.equal(loadScript(storage), null);
  saveScript(storage, { source: 'x' });
  clearScript(storage);
  assert.equal(storage.length, 0);
});

test('a record that is not a script reads as none', () => {
  const storage = memoryStorage();
  storage.setItem('game-controller-workshop:script:v1', '{not json');
  assert.equal(loadScript(storage), null);
  assert.equal(normalizeScript('a string'), null);
  assert.equal(normalizeScript({ source: 42 }), null);
  assert.equal(normalizeScript({ source: 'x'.repeat(SCRIPT_LIMIT + 1) }), null);
  assert.deepEqual(normalizeScript({ source: 'ok', autoRun: 'yes' }), { source: 'ok', request: '', autoRun: false });
});

test('a store that refuses the write does not take the page down', () => {
  const storage = memoryStorage({ failOn: () => true });
  assert.doesNotThrow(() => saveScript(storage, { source: 'x' }));
  assert.equal(loadScript(null), null);
});
