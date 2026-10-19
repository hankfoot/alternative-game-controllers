import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandBridge } from '../js/game-commands.js';
import { parseCommand } from '../js/line-protocol.js';
import { findGame } from '../js/games/index.js';

function fakeHost(gameId = 'flappy') {
  const calls = [];
  const game = findGame(gameId);
  return {
    calls,
    actions: {
      fire: (node, port) => calls.push(['fire', node, port]),
      setValue: (node, port, value) => calls.push(['set', node, port, value]),
    },
    activeGame: () => game,
    phase: () => 'ready',
    onGameChange: () => () => {},
  };
}

// A bus of two channels: the bridge subscribes, the test sends.
function setup(gameId) {
  const commandListeners = new Set();
  const statusListeners = new Set();
  const host = fakeHost(gameId);
  const events = [];
  let clock = 0;
  const bridge = createCommandBridge({
    gameHost: host,
    subscribeCommand: (fn) => { commandListeners.add(fn); return () => commandListeners.delete(fn); },
    subscribeStatus: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    now: () => clock,
    keep: 3,
  });
  bridge.subscribe((event) => events.push(event));
  return {
    host, bridge, events,
    send: (line) => commandListeners.forEach((fn) => fn(parseCommand(line))),
    status: (state) => statusListeners.forEach((fn) => fn({ state })),
  };
}

test('each command line drives the game, and is remembered', () => {
  const { host, bridge, send } = setup('brickbreaker');
  send('game:set:paddle:0.25');
  send('game:hold:shift:1');
  send('game:hold:shift:0');
  send('game:start');
  assert.deepEqual(host.calls, [
    ['set', 'paddle', 'y', 0.25],
    ['set', 'shift', 'hold', 1],
    ['set', 'shift', 'hold', 0],
    ['fire', 'ui', 'advance'],
  ]);
  assert.deepEqual(bridge.recent().map((entry) => [entry.level, entry.text]), [
    ['info', 'game:hold:shift:1'],
    ['info', 'game:hold:shift:0'],
    ['info', 'game:start'],
  ], 'the last few, newest last');
});

test('a command the game cannot take is logged as a warning, with the facade\'s explanation first', () => {
  const { host, bridge, send } = setup('jetpack');
  send('game:press:flap');
  assert.deepEqual(host.calls, []);
  const [why, line] = bridge.recent();
  assert.equal(why.level, 'error');
  assert.match(why.text, /Unknown control "flap"/);
  assert.deepEqual([line.level, line.text], ['warn', 'game:press:flap']);
});

// The Game screen's wiring check asks this, to stand down while the board is
// steering itself.
test('the first command marks the board as driving, and losing the board unmarks it', () => {
  const { bridge, events, send, status } = setup();
  assert.equal(bridge.driven(), false);
  send('game:press:flap');
  send('game:press:flap');
  assert.equal(bridge.driven(), true);
  assert.equal(events.filter((e) => e.type === 'driven').length, 1, 'said once, not per command');
  status('connected');
  assert.equal(bridge.driven(), true, 'a connected status is not a loss');
  status('connecting');
  assert.equal(bridge.driven(), false);
  assert.deepEqual(events.filter((e) => e.type === 'driven').map((e) => e.driven), [true, false]);
});

test('losing the board lets go of everything it was holding', () => {
  const { host, send, status } = setup('jetpack');
  send('game:hold:thrust:1');
  host.calls.length = 0;
  status('disconnected');
  assert.deepEqual(host.calls, [['set', 'lift', 'thrust', 0]]);
});
