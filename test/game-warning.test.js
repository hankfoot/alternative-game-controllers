import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnose } from '../js/game-warning.js';
import { GAMES, findGame } from '../js/games/index.js';

const check = (id, rules) => diagnose({ steering: findGame(id).steering, targets: findGame(id).targets, rules });
const press = (control) => ({ input: 'btna', when: 'pressed', control });
const hold = (control) => ({ input: 'btna', when: 'held', control });

test('no sentences at all is the first thing worth saying', () => {
  const found = check('flappy', []);
  assert.equal(found.reason, 'no-rules');
  assert.equal(found.level, 'empty');
});

test('sentences that steer nothing name what has to be steered', () => {
  const found = check('jetpack', [hold('shift')]);
  assert.equal(found.reason, 'nothing-steered');
  assert.deepEqual(found.controls.map((control) => control.label), ['Thrust']);
});

// The case the whole check exists for: Invaders looks done and flies one way.
test('half of a two-way scheme is called out ahead of anything else', () => {
  const found = check('spaceship', [hold('up')]);
  assert.equal(found.reason, 'half-steered');
  assert.equal(found.control.label, 'Move');
  assert.equal(found.control.done, 1);
  assert.equal(found.control.total, 2);
});

// A press on a hold control is not a sentence the generator would keep, and
// it must not count here either.
test('a sentence of the wrong kind for its control does not count as steering', () => {
  const found = check('jetpack', [press('thrust')]);
  assert.equal(found.reason, 'nothing-steered');
});

test('a finished controller says nothing at all, in every scheme', () => {
  assert.equal(check('spaceship', [hold('up'), hold('down')]), null);
  assert.equal(check('brickbreaker', [{ input: 'pitch', when: 'between', control: 'paddle', low: 0, high: 1 }]), null);
  for (const game of GAMES) {
    const rules = game.steering.flatMap((control) => control.keys.map((key) => {
      const [node, port] = key.split('.');
      const target = game.targets.find((t) => t.id === node);
      const type = target.ports.find((p) => p.id === port).type;
      const name = ['trigger', 'y', 'hold', 'level'].includes(port) ? node : port;
      return { input: type === 'level' ? 'pitch' : 'btna', when: { trigger: 'pressed', hold: 'held', level: 'between' }[type], control: name, low: 0, high: 1 };
    }));
    assert.equal(check(game.id, rules), null, `${game.id} still complains about a finished controller`);
  }
});
