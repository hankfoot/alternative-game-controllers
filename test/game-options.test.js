import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameOptions } from '../js/game-options.js';
import { findGame } from '../js/games/index.js';
import { memoryStorage } from './helpers/memory-storage.js';

function fakeHost(gameId = 'flappy') {
  const published = [];
  let game = findGame(gameId);
  const listeners = new Set();
  return {
    published,
    actions: { setControlOptions: (node, port, options) => published.push([`${node}.${port}`, options]) },
    activeGame: () => game,
    select: (id) => { game = findGame(id); listeners.forEach((fn) => fn(game)); },
    onGameChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const KEY = 'game-controller-workshop:controls:v1';

test('at boot every option is handed to the game, saved choice or declared default', () => {
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify({ flappy: { 'flap.trigger': { lift: 'hard' } } }));
  const host = fakeHost();
  const options = createGameOptions({ gameHost: host, storage });
  const flap = host.published.find(([port]) => port === 'flap.trigger')[1];
  assert.equal(flap.lift, 'hard', 'the saved choice');
  assert.equal(flap.gravity, findGame('flappy').targets[0].ports[0].options[1].value, 'the declared default');
  assert.ok(host.published.some(([port]) => port === 'speed.pace'), 'the course too');
  assert.deepEqual(options.get('flap', 'trigger'), flap);
});

test('a choice is saved per game, published at once, and a bad value falls back', () => {
  const storage = memoryStorage();
  const host = fakeHost();
  const options = createGameOptions({ gameHost: host, storage });
  host.published.length = 0;
  options.set('flap', 'trigger', 'lift', 'soft');
  assert.deepEqual(host.published.at(-1)[0], 'flap.trigger');
  assert.equal(host.published.at(-1)[1].lift, 'soft');
  assert.equal(JSON.parse(storage.getItem(KEY)).flappy['flap.trigger'].lift, 'soft');
  options.set('flap', 'trigger', 'lift', 'enormous');
  assert.equal(options.get('flap', 'trigger').lift, findGame('flappy').targets[0].ports[0].options[0].value);
});

// A new scheme is a fresh engine with nothing set, so everything saved for
// it has to be handed over again.
test('switching scheme loads that scheme\'s choices and publishes them', () => {
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify({ jetpack: { 'lift.thrust': { lift: 'hard' } } }));
  const host = fakeHost('flappy');
  const options = createGameOptions({ gameHost: host, storage });
  let told = 0;
  options.subscribe(() => { told += 1; });
  host.published.length = 0;
  host.select('jetpack');
  assert.equal(options.gameId, 'jetpack');
  assert.equal(host.published.find(([port]) => port === 'lift.thrust')[1].lift, 'hard');
  assert.equal(told, 1);
});

test('a bundle\'s choices replace what was saved, for every game', () => {
  const storage = memoryStorage();
  const host = fakeHost();
  const options = createGameOptions({ gameHost: host, storage });
  options.set('flap', 'trigger', 'lift', 'soft');
  options.importAll({ flappy: { 'flap.trigger': { lift: 'hard' } }, jetpack: {} });
  assert.equal(options.get('flap', 'trigger').lift, 'hard');
  assert.deepEqual(Object.keys(options.exportAll()), ['flappy', 'jetpack']);
  assert.doesNotThrow(() => createGameOptions({ gameHost: fakeHost(), storage: memoryStorage({ failOn: () => true }) }).set('flap', 'trigger', 'lift', 'soft'));
});
