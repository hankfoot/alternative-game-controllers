import assert from 'node:assert/strict';
import test from 'node:test';

import { createScriptRunner, controlsFor, lineOf } from '../js/script-runner.js';
import { createSignalStore } from '../js/signal-store.js';
import { GAMES, findGame } from '../js/games/index.js';

// --- Stand-ins ----------------------------------------------------------------

// A bus of one: the store and the script subscribe, the test emits.
function fakeBus() {
  const listeners = new Set();
  return {
    subscribeInput: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: (msg) => [...listeners].forEach((fn) => fn(msg)),
    count: () => listeners.size,
  };
}

// Timers that only move when told to.
function fakeTimers() {
  let clock = 0;
  let seq = 0;
  const queue = [];
  const schedule = (fn, ms, repeat) => {
    const every = Math.max(0, Number(ms) || 0);
    const entry = { id: ++seq, at: clock + every, fn, repeat: repeat ? Math.max(1, every) : 0 };
    queue.push(entry);
    return entry.id;
  };
  const cancel = (id) => {
    const index = queue.findIndex((entry) => entry.id === id);
    if (index >= 0) queue.splice(index, 1);
  };
  return {
    setTimeout: (fn, ms) => schedule(fn, ms, false),
    setInterval: (fn, ms) => schedule(fn, ms, true),
    clearTimeout: cancel,
    clearInterval: cancel,
    now: () => clock,
    pending: () => queue.length,
    async tick(ms) {
      const until = clock + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > until) break;
        clock = next.at;
        if (next.repeat) next.at += next.repeat;
        else queue.shift();
        next.fn();
        await Promise.resolve();
      }
      clock = until;
      await Promise.resolve();
    },
  };
}

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

function setup({ gameId = 'flappy' } = {}) {
  const bus = fakeBus();
  const timers = fakeTimers();
  const store = createSignalStore({ subscribeInput: bus.subscribeInput, now: timers.now });
  const host = fakeHost(gameId);
  const logs = [];
  const statuses = [];
  const runner = createScriptRunner({
    signalStore: store,
    gameHost: host,
    subscribeInput: bus.subscribeInput,
    emitInput: bus.emit,
    timers,
    now: timers.now,
  });
  runner.subscribe((event) => {
    if (event.type === 'log') logs.push(event);
    if (event.type === 'status') statuses.push(event.status);
  });
  const errors = () => logs.filter((entry) => entry.level === 'error').map((entry) => entry.text);
  const said = () => logs.filter((entry) => entry.level === 'info').map((entry) => entry.text);
  return { bus, timers, store, host, runner, logs, statuses, errors, said };
}

// --- Naming -------------------------------------------------------------------

// A port is named for a card on the wiring board; in a line of code the name
// has to carry the meaning alone, so a jack called only by its type takes the
// card's name instead. Checked against every real scheme, since the names are
// what the instructions will tell an LLM to use.
test('every scheme\'s ports get names a script can say', () => {
  const names = (id) => controlsFor(findGame(id).targets).map((c) => `${c.name}:${c.kind}`);
  assert.deepEqual(names('flappy'), ['flap:press', 'shift:hold', 'shift:level', 'advance:press']);
  assert.deepEqual(names('jetpack'), ['thrust:hold', 'shift:hold', 'shift:level', 'advance:press']);
  assert.deepEqual(names('spaceship'), ['up:hold', 'down:hold', 'shift:hold', 'shift:level', 'advance:press']);
  assert.deepEqual(names('brickbreaker'), ['paddle:level', 'shift:hold', 'shift:level', 'advance:press']);
  for (const game of GAMES) {
    for (const control of controlsFor(game.targets)) assert.ok(control.description, `${control.name} says what it does`);
  }
});

// --- Driving the game ----------------------------------------------------------

test('press, hold and set reach the game through its actions', () => {
  const { runner, host } = setup({ gameId: 'brickbreaker' });
  const { game } = runner.api();
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

// The engine paces `advance` on a wire's behalf; a script reaches the port
// directly, so the pacing has to be kept here or a noisy input would restart
// the round many times a second.
test('a paced control fires at most once per its pace', async () => {
  const { runner, host, timers } = setup();
  const { game } = runner.api();
  assert.equal(game.press('advance'), true);
  assert.equal(game.press('advance'), false);
  await timers.tick(1000);
  assert.equal(game.press('advance'), true);
  assert.equal(host.calls.filter(([what]) => what === 'fire').length, 2);
});

test('start() is press(advance) except mid-round, where advance would restart it', () => {
  const { runner, host } = setup();
  const { game } = runner.api();
  host.setPhase('playing');
  assert.equal(game.start(), false);
  assert.deepEqual(host.calls, []);
  host.setPhase('over');
  assert.equal(game.start(), true);
  assert.deepEqual(host.calls, [['fire', 'ui', 'advance']]);
  assert.equal(game.phase(), 'over');
});

test('a wrong name, or the wrong verb for a right one, is explained with the names that work', () => {
  const { runner, host, errors } = setup({ gameId: 'jetpack' });
  const { game } = runner.api();
  assert.equal(game.press('jump'), false);
  assert.match(errors()[0], /Unknown control "jump"/);
  assert.match(errors()[0], /thrust \(hold\)/);
  assert.match(errors()[0], /advance \(press\)/);

  assert.equal(game.press('thrust'), false);
  assert.match(errors()[1], /"thrust" is a hold control — use game\.hold\('thrust', true\)/);

  assert.equal(game.press('shift'), false);
  assert.match(errors()[2], /use game\.hold\('shift', true\) or game\.set\('shift', 0\.5\)/);

  assert.equal(game.set('shift', 'high'), false);
  assert.match(errors()[3], /needs a number from 0 to 1/);
  assert.deepEqual(host.calls, [], 'and nothing reached the game');
});

test('names are looked up when called, so switching scheme mid-run only makes the old ones unknown', () => {
  const { runner, host, errors } = setup();
  const { game } = runner.api();
  assert.equal(game.press('flap'), true);
  host.select('jetpack');
  assert.equal(game.press('flap'), false);
  assert.match(errors()[0], /Unknown control "flap"/);
  assert.deepEqual(game.controls().map((c) => c.name), ['thrust', 'shift', 'shift', 'advance']);
});

// --- Hearing the inputs ---------------------------------------------------------

test('on hears a channel, or every channel, with what the store knows about it', () => {
  const { runner, bus } = setup();
  const { inputs } = runner.api();
  const heard = [];
  inputs.on('pitch', (value, info) => heard.push(['pitch', value, info.kind, info.min, info.max]));
  inputs.on('*', (value, info) => heard.push(['*', info.channel, value]));
  bus.emit({ channel: 'pitch', value: -12 });
  bus.emit({ channel: 'btna', value: 1 });
  assert.deepEqual(heard, [
    ['pitch', -12, 'number', -90, 90],
    ['*', 'pitch', -12],
    ['*', 'btna', 1],
  ]);
  assert.equal(inputs.value('pitch'), -12);
  assert.equal(inputs.value('nothing'), undefined);
  assert.deepEqual(inputs.list().map((s) => s.channel), ['pitch', 'btna']);
});

// A button sends a 1 going down and a 0 coming up, and nothing in between; a
// clap sends a 1 the once. "Press" has to mean the same moment for both.
test('onPress fires once per press of an on/off input and once per event', () => {
  const { runner, bus } = setup();
  const { inputs } = runner.api();
  let presses = 0;
  let claps = 0;
  inputs.onPress('btna', () => { presses += 1; });
  inputs.onPress('loud', () => { claps += 1; });
  for (const value of [0, 1, 1, 0, 1]) bus.emit({ channel: 'btna', value });
  for (let i = 0; i < 3; i += 1) bus.emit({ channel: 'loud', value: 1 });
  assert.equal(presses, 2);
  assert.equal(claps, 3);
});

// The script's own channel has to exist, with the kind the script said, before
// its first reading lands; otherwise the store files it under whatever that
// one number looks like.
test('publish declares the channel before the first reading goes out', () => {
  const { runner, bus, store } = setup();
  const { inputs } = runner.api();
  const seen = [];
  bus.subscribeInput((msg) => seen.push({ ...msg, kindThen: store.get(msg.channel)?.kind ?? null }));
  assert.equal(inputs.publish('height', 1, { kind: 'number' }), true);
  assert.equal(seen[0].kindThen, 'number');
  assert.deepEqual(seen[0], { channel: 'height', value: 1, raw: 'height:1', kindThen: 'number' });
  assert.ok(inputs.list().some((s) => s.channel === 'height' && s.kind === 'number'));

  assert.equal(inputs.publish('bad name', 1), false);
  assert.equal(inputs.publish('h:1', 1), false);
  assert.equal(inputs.publish('height', 'tall'), false);
  assert.equal(seen.length, 1);
});

test('a publish that wakes its own listener is cut off rather than left to recurse', () => {
  const { runner, logs } = setup();
  const { inputs } = runner.api();
  let heard = 0;
  inputs.on('echo', () => { heard += 1; inputs.publish('echo', 1); });
  inputs.publish('echo', 1);
  assert.ok(heard < 20, `heard ${heard} times`);
  assert.ok(logs.some((entry) => entry.level === 'warn' && /dropped/.test(entry.text)));
});

// --- Running a script -------------------------------------------------------------

test('a script sees inputs and game, and console.log lands in the log', async () => {
  const { runner, bus, host, said } = setup();
  await runner.run(`
    const EVERY = 3
    let count = 0
    inputs.onPress('loud', () => {
      count += 1
      console.log('clap', count, { every: EVERY })
      if (count % EVERY === 0) game.press('flap')
    })
  `);
  assert.equal(runner.running(), true);
  for (let i = 0; i < 7; i += 1) bus.emit({ channel: 'loud', value: 1 });
  assert.equal(host.calls.filter(([what]) => what === 'fire').length, 2);
  assert.equal(said()[1], 'clap 1 {"every":3}');
});

test('a syntax error is reported with the status, and nothing runs', async () => {
  const { runner, errors, statuses } = setup();
  assert.equal(await runner.run('const x = ;'), false);
  assert.equal(runner.running(), false);
  assert.match(errors()[0], /^Syntax error:/);
  assert.equal(statuses.at(-1), 'error');
});

test('an error inside a listener is logged and the script keeps running', async () => {
  const { runner, bus, errors } = setup();
  await runner.run(`
    inputs.on('pitch', (v) => { if (v > 0) throw new Error('boom') })
  `);
  bus.emit({ channel: 'pitch', value: 5 });
  bus.emit({ channel: 'pitch', value: -5 });
  assert.equal(runner.running(), true);
  assert.equal(errors().length, 1);
  assert.match(errors()[0], /in inputs\.on\('pitch'\): boom/);
});

test('the error\'s line is the line of the script, not of the wrapper', async () => {
  const { runner, errors } = setup();
  await runner.run('inputs.on(\'x\', () => {\n  throw new Error(\'here\')\n})');
  // Trip the listener through the public api rather than the bus, as the
  // failure a person hits would.
  runner.api().inputs.publish('x', 1);
  assert.match(errors()[0], /\(line 2\)$/);
  assert.equal(lineOf(new Error('no stack of that shape')), null);
});

test('a body that rejects stops the script with an error status', async () => {
  const { runner, timers, statuses, errors } = setup();
  const done = runner.run(`
    await new Promise((resolve, reject) => setTimeout(() => reject(new Error('late')), 10))
  `);
  assert.equal(runner.running(), true);
  await timers.tick(10);
  assert.equal(await done, false);
  assert.equal(runner.running(), false);
  assert.equal(statuses.at(-1), 'error');
  assert.match(errors()[0], /late/);
});

test('top-level await works, through the script\'s own timers', async () => {
  const { runner, timers, host } = setup();
  const done = runner.run(`
    await new Promise((resolve) => setTimeout(resolve, 500))
    game.press('flap')
  `);
  await timers.tick(499);
  assert.deepEqual(host.calls, []);
  await timers.tick(1);
  await done;
  assert.deepEqual(host.calls, [['fire', 'flap', 'trigger']]);
  assert.equal(runner.running(), false, 'nothing left listening, so it has finished');
});

// --- Stopping -------------------------------------------------------------------------

test('stop clears timers, listeners, holds, levels and published channels', async () => {
  const { runner, bus, host, timers, store } = setup({ gameId: 'brickbreaker' });
  await runner.run(`
    setInterval(() => inputs.publish('height', 0.5), 100)
    setTimeout(() => game.press('advance'), 5000)
    inputs.on('pitch', (v) => game.set('paddle', 0.9))
    game.hold('shift', true)
  `);
  await timers.tick(100);
  bus.emit({ channel: 'pitch', value: 1 });
  assert.ok(store.get('height')?.published);
  host.calls.length = 0;

  runner.stop();
  assert.equal(runner.running(), false);
  assert.deepEqual(host.calls, [
    ['set', 'shift', 'hold', 0],
    ['set', 'paddle', 'y', 0.5],
  ], 'let go of what it held, and rested the level where the scheme rests it');
  assert.equal(store.get('height')?.published, false, 'no longer the script\'s, though still live');
  assert.equal(timers.pending(), 0);

  host.calls.length = 0;
  await timers.tick(10000);
  bus.emit({ channel: 'pitch', value: 1 });
  assert.deepEqual(host.calls, [], 'and nothing of it is left running');
});

test('running a second script first takes the first one down', async () => {
  const { runner, bus, said } = setup();
  await runner.run("inputs.on('x', () => console.log('first'))");
  await runner.run("inputs.on('x', () => console.log('second'))");
  bus.emit({ channel: 'x', value: 1 });
  assert.deepEqual(said().filter((text) => /first|second/.test(text)), ['second']);
});

// A body that is still awaiting something the runner does not track — a fetch,
// a promise handed in from outside — can finish long after the script it
// belonged to was replaced. Its failure is not the new script's failure.
test('a script that fails after being replaced cannot speak for the one that replaced it', async () => {
  const { bus, timers, store, host } = setup();
  let fail = null;
  const bodies = {
    stale: async () => {
      await new Promise((resolve, reject) => { fail = reject; });
    },
    fresh: async (inputs) => { inputs.on('x', () => {}); },
  };
  const statuses = [];
  const runner = createScriptRunner({
    signalStore: store, gameHost: host, subscribeInput: bus.subscribeInput, emitInput: bus.emit,
    timers, now: timers.now, compile: (source) => bodies[source],
  });
  runner.subscribe((event) => { if (event.type === 'status') statuses.push(event.status); });

  const first = runner.run('stale');
  await runner.run('fresh');
  fail(new Error('stale'));
  assert.equal(await first, false);
  assert.equal(runner.running(), true, 'the second script is unaffected');
  assert.equal(statuses.at(-1), 'running');
});
