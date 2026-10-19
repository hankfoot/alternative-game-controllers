import assert from 'node:assert/strict';
import test from 'node:test';

import { controlsFor, createGameFacade } from '../js/game-facade.js';
import { GAMES, findGame } from '../js/games/index.js';

// The game host, recording every call the facade makes.
function fakeHost(gameId = 'flappy') {
  const calls = [];
  let game = findGame(gameId);
  let phase = 'ready';
  const listeners = new Set();
  return {
    calls,
    actions: {
      fire: (node, port) => calls.push(['fire', node, port]),
      setValue: (node, port, value) => calls.push(['set', node, port, value]),
    },
    activeGame: () => game,
    phase: () => phase,
    setPhase: (next) => { phase = next; },
    select: (id) => { game = findGame(id); listeners.forEach((fn) => fn(game)); },
    onGameChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function setup(gameId) {
  const host = fakeHost(gameId);
  let clock = 0;
  const errors = [];
  const game = createGameFacade({
    gameHost: host,
    now: () => clock,
    log: (level, text) => { if (level === 'error') errors.push(text); },
  });
  return { host, game, errors, tick: (ms) => { clock += ms; } };
}

// A port is named for a card on the wiring board; in a line of code the name
// has to carry the meaning alone, so a jack called only by its type takes the
// card's name instead. Checked against every real scheme, since the names are
// what the instructions tell an LLM to use.
test('every scheme\'s ports get names code can say', () => {
  const names = (id) => controlsFor(findGame(id).targets).map((c) => `${c.name}:${c.kind}`);
  assert.deepEqual(names('flappy'), ['flap:press', 'shift:hold', 'shift:level', 'advance:press']);
  assert.deepEqual(names('jetpack'), ['thrust:hold', 'shift:hold', 'shift:level', 'advance:press']);
  assert.deepEqual(names('spaceship'), ['up:hold', 'down:hold', 'shift:hold', 'shift:level', 'advance:press']);
  assert.deepEqual(names('brickbreaker'), ['paddle:level', 'shift:hold', 'shift:level', 'advance:press']);
  for (const game of GAMES) {
    for (const control of controlsFor(game.targets)) assert.ok(control.description, `${control.name} says what it does`);
  }
});

test('press, hold and set reach the game through its actions', () => {
  const { game, host } = setup('brickbreaker');
  assert.equal(game.set('paddle', 0.25), true);
  assert.equal(game.set('paddle', 7), true, 'clamped, not refused');
  assert.equal(game.hold('shift', true), true);
  assert.equal(game.hold('shift', false), true);
  assert.equal(game.press('advance'), true);
  assert.deepEqual(host.calls, [
    ['set', 'paddle', 'y', 0.25],
    ['set', 'paddle', 'y', 1],
    ['set', 'shift', 'hold', 1],
    ['set', 'shift', 'hold', 0],
    ['fire', 'ui', 'advance'],
  ]);
});

// The engine paces `advance` on a wire's behalf; a command reaches the port
// directly, so the pacing has to be kept here or a noisy board would restart
// the round many times a second.
test('a paced control fires at most once per its pace', () => {
  const { game, host, tick } = setup();
  assert.equal(game.press('advance'), true);
  assert.equal(game.press('advance'), false);
  tick(1000);
  assert.equal(game.press('advance'), true);
  assert.equal(host.calls.filter(([what]) => what === 'fire').length, 2);
});

test('start() is press(advance) except mid-round, where advance would restart it', () => {
  const { game, host } = setup();
  host.setPhase('playing');
  assert.equal(game.start(), false);
  assert.deepEqual(host.calls, []);
  host.setPhase('over');
  assert.equal(game.start(), true);
  assert.deepEqual(host.calls, [['fire', 'ui', 'advance']]);
  assert.equal(game.phase(), 'over');
});

test('a wrong name, or the wrong verb for a right one, is explained with the names that work', () => {
  const { game, host, errors } = setup('jetpack');
  assert.equal(game.press('jump'), false);
  assert.match(errors[0], /Unknown control "jump"/);
  assert.match(errors[0], /thrust \(hold\)/);
  assert.match(errors[0], /advance \(press\)/);

  assert.equal(game.press('thrust'), false);
  assert.match(errors[1], /"thrust" is a hold control — use gameHold\("thrust", true\)/);

  assert.equal(game.press('shift'), false);
  assert.match(errors[2], /use gameHold\("shift", true\) or gameSet\("shift", 0\.5\)/);

  assert.equal(game.set('shift', 'high'), false);
  assert.match(errors[3], /needs a number from 0 to 1/);
  assert.deepEqual(host.calls, [], 'and nothing reached the game');
});

test('names are looked up when called, so switching scheme only makes the old ones unknown', () => {
  const { game, host, errors } = setup();
  assert.equal(game.press('flap'), true);
  host.select('jetpack');
  assert.equal(game.press('flap'), false);
  assert.match(errors[0], /Unknown control "flap"/);
  assert.deepEqual(game.controls().map((c) => c.name), ['thrust', 'shift', 'shift', 'advance']);
});

// A board that walks out of range mid-climb sends no release.
test('release lets go of what is held and rests every level where the scheme rests it', () => {
  const { game, host } = setup('brickbreaker');
  game.hold('shift', true);
  game.set('paddle', 0.9);
  host.calls.length = 0;
  game.release();
  assert.deepEqual(host.calls, [
    ['set', 'shift', 'hold', 0],
    ['set', 'paddle', 'y', 0.5],
  ]);
  host.calls.length = 0;
  game.release();
  assert.deepEqual(host.calls, [], 'and a second release has nothing left to say');
});
