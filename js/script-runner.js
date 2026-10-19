// Runs a script somebody pasted — usually one an LLM wrote — against the same
// inputs and game the patch bay drives.
//
// The patch bay can map one reading to one port. It cannot combine two
// readings, keep a count ("every third clap"), take a rate of change, or apply
// a curve, and at the workshop those were exactly the controllers people
// wanted: the height of an office chair, read off a hinged arm, steering the
// craft. Those need code, and the cheapest place to run code is right here in
// the page, where the readings already are and the game is one call away. No
// reflashing, and a mistake shows up in a log instead of as a board that has
// gone quiet.
//
// Two things are handed to the script, and the same two sit on `window` for
// anyone who would rather poke at them from the console:
//
//   inputs — the readings: `on`, `onPress`, `value`, `list`, and `publish`,
//            which puts a reading the script invented onto the bus so it shows
//            up on the patch bay like any other.
//   game   — the controls of whichever scheme is picked, by friendly name:
//            `press`, `hold`, `set`, `start`, `phase`, `controls`.
//
// Everything a script takes out — subscriptions, timers, held controls,
// published channels — is tracked here, so Stop puts all of it back. Nothing
// in this file touches the DOM; js/script-ui.js is the part that does.

import { onInput, emitInput as emitOnBus } from './bus.js';

// Ports are named for the wiring board, where "flap · Trigger" reads fine as a
// card with a jack on it. In a line of code `press('flap')` has to carry the
// whole meaning alone, so a port whose own id only says what *type* of jack it
// is takes its card's name instead: flap.trigger is `flap`, paddle.y is
// `paddle`, shift.hold and shift.level are both `shift` (told apart by which
// verb is used), while slide.up stays `up` and ui.advance stays `advance`.
const GENERIC_PORT_IDS = ['trigger', 'y', 'hold', 'level'];

// What `press` means on a trigger: the port types are the wiring board's
// words, and these are the script's.
const KIND_OF_TYPE = { trigger: 'press', hold: 'hold', level: 'level' };

const ALIASES = { start: 'advance' };

/** The controls of a scheme, as a script sees them. Pure. */
export function controlsFor(targets = []) {
  const controls = [];
  for (const target of targets) {
    for (const port of target.ports ?? []) {
      controls.push({
        name: GENERIC_PORT_IDS.includes(port.id) ? target.id : port.id,
        node: target.id,
        port: port.id,
        kind: KIND_OF_TYPE[port.type] ?? port.type,
        description: target.description ?? '',
        pace: port.pace ?? 0,
        defaultValue: port.defaultValue ?? 0,
      });
    }
  }
  return controls;
}

// How a control is called, for the message that says you called it wrong.
const usage = (control) => ({
  press: `game.press('${control.name}')`,
  hold: `game.hold('${control.name}', true)`,
  level: `game.set('${control.name}', 0.5)`,
}[control.kind]);

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

// What the script is handed, by name and in this order. Async, so a script can
// `await` at the top level — "wait a second, then start" is a natural thing to
// write and should just work.
const PARAMS = ['inputs', 'game', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'console'];
const defaultCompile = (source) => new AsyncFunction(...PARAMS, source);

// The Function constructor puts the body two lines down, behind a generated
// header, so a stack trace's line is two more than the one the person is
// looking at. Best effort: only V8 writes `<anonymous>:line:col`.
const HEADER_LINES = 2;

/** The line of the script an error was thrown from, or null if unknowable. */
export function lineOf(error) {
  const match = /<anonymous>:(\d+):\d+/.exec(error?.stack ?? '');
  if (!match) return null;
  const line = Number(match[1]) - HEADER_LINES;
  return line > 0 ? line : null;
}

// A channel name goes onto the wire as `name:value`, so it cannot carry the
// separator, and a space would split it from the number on the way back in.
const CHANNEL_NAME = /^[a-z0-9_-]+$/;

// How deep `publish` may be called from inside a listener that `publish`
// itself woke. A script that republishes every reading it hears, including the
// one it just published, would otherwise recurse until the stack went.
const PUBLISH_DEPTH = 8;

function describe(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createScriptRunner({
  signalStore,
  gameHost,
  subscribeInput = onInput,
  emitInput = emitOnBus,
  timers = {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
  },
  now = () => globalThis.performance?.now() ?? Date.now(),
  compile = defaultCompile,
}) {
  const listeners = new Set();
  let state = { status: 'idle', message: '' };
  let running = false;
  // Bumped by every run and every stop, so a body that finishes — or crashes —
  // after the script it belonged to was stopped cannot speak for the next one.
  let generation = 0;

  // What the current script has taken out.
  const subscriptions = new Set();
  const pending = new Set(); // { id, kind }
  const held = new Map(); // "node.port" → control
  const levels = new Map(); // "node.port" → control
  const published = new Map(); // channel → descriptor
  const lastFired = new Map(); // "node.port" → time
  let publishDepth = 0;

  function emit(event) {
    listeners.forEach((listener) => listener(event));
  }

  function log(level, ...parts) {
    emit({ type: 'log', level, text: parts.map(describe).join(' ') });
  }

  function setStatus(status, message = '') {
    state = { status, message };
    emit({ type: 'status', status, message });
  }

  function report(error, context) {
    const line = lineOf(error);
    log('error', `${context}: ${error?.message ?? describe(error)}${line ? ` (line ${line})` : ''}`);
  }

  // Runs a piece of the script's own code. It is caught here rather than left
  // to the page, because one listener throwing must not take the others with
  // it, and because the person who can fix it is looking at the log, not at the
  // browser console.
  function safely(fn, context) {
    try {
      return fn();
    } catch (error) {
      report(error, `Error ${context}`);
      return undefined;
    }
  }

  const keyOf = (control) => `${control.node}.${control.port}`;
  const actions = () => gameHost.actions;
  const controls = () => controlsFor(gameHost.activeGame()?.targets);

  // Looked up at call time, not when the script starts: switching scheme
  // mid-run then just makes the old names unknown, which the message explains,
  // rather than firing ports that no longer exist.
  function resolve(name, kind) {
    const all = controls();
    const wanted = String(name).trim().toLowerCase();
    const matches = all.filter((control) => control.name === (ALIASES[wanted] ?? wanted));
    if (!matches.length) {
      const have = all.map((control) => `${control.name} (${control.kind})`).join(', ');
      log('error', `Unknown control "${name}". This scheme has: ${have}.`);
      return null;
    }
    const match = matches.find((control) => control.kind === kind);
    if (!match) {
      const kinds = matches.map((control) => control.kind).join(' and ');
      log('error', `"${name}" is a ${kinds} control — use ${matches.map(usage).join(' or ')}.`);
      return null;
    }
    return match;
  }

  const game = {
    /** Fires a trigger control, e.g. `press('flap')`. True if it fired. */
    press(name) {
      const control = resolve(name, 'press');
      if (!control) return false;
      // The engine paces a port on the wire's behalf; a script calls the port
      // directly, so the pacing has to be kept here or `advance` would restart
      // the round on every reading.
      if (control.pace) {
        const last = lastFired.get(keyOf(control));
        if (last != null && now() - last < control.pace) return false;
        lastFired.set(keyOf(control), now());
      }
      actions().fire(control.node, control.port);
      return true;
    },
    /** Holds a control down (`on` true) or lets it go. */
    hold(name, on = true) {
      const control = resolve(name, 'hold');
      if (!control) return false;
      actions().setValue(control.node, control.port, on ? 1 : 0);
      if (on) held.set(keyOf(control), control);
      else held.delete(keyOf(control));
      return true;
    },
    /** Sets a level control to a value from 0 to 1. */
    set(name, value) {
      const control = resolve(name, 'level');
      if (!control) return false;
      const number = Number(value);
      if (!Number.isFinite(number)) {
        log('error', `game.set('${name}') needs a number from 0 to 1, got ${describe(value)}.`);
        return false;
      }
      actions().setValue(control.node, control.port, Math.min(1, Math.max(0, number)));
      levels.set(keyOf(control), control);
      return true;
    },
    /**
     * Starts a round, or retries after a crash. Pressing `advance` mid-round
     * restarts it, which is never what "start" means, so this checks first.
     */
    start() {
      if (game.phase() === 'playing') return false;
      return game.press('advance');
    },
    /** 'ready', 'playing' or 'over'. */
    phase: () => gameHost.phase?.() ?? null,
    /** The controls the picked scheme has, by the names these calls take. */
    controls: () => controls().map(({ name, kind, description }) => ({ name, kind, description })),
  };

  function meta(channel, value) {
    const signal = signalStore.get(channel);
    return {
      channel,
      kind: signal?.kind ?? (value === 0 || value === 1 ? 'binary' : 'number'),
      min: signal?.min ?? 0,
      max: signal?.max ?? 1,
    };
  }

  const inputs = {
    /** Calls `fn(value, info)` on every reading of a channel, or of all with '*'. */
    on(channel, fn) {
      if (typeof fn !== 'function') {
        log('error', `inputs.on('${channel}') needs a function to call.`);
        return () => {};
      }
      const wanted = String(channel).trim().toLowerCase();
      const context = `in inputs.on('${wanted}')`;
      const stop = subscribeInput((message) => {
        if (wanted !== '*' && message.channel !== wanted) return;
        safely(() => fn(message.value, meta(message.channel, message.value)), context);
      });
      const unsubscribe = () => {
        stop();
        subscriptions.delete(unsubscribe);
      };
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    /**
     * Calls `fn` once per press: the moment an on/off input goes from 0 to 1,
     * or every time a one-off event (a clap, a shake) comes in.
     */
    onPress(channel, fn) {
      if (typeof fn !== 'function') {
        log('error', `inputs.onPress('${channel}') needs a function to call.`);
        return () => {};
      }
      const previous = new Map();
      return inputs.on(channel, (value, info) => {
        const was = previous.get(info.channel) ?? 0;
        previous.set(info.channel, value);
        if (value > 0 && (info.kind === 'event' || was <= 0)) fn(value, info);
      });
    },
    /** The latest reading of a channel, or undefined if none has arrived. */
    value(channel) {
      return signalStore.get(String(channel).trim().toLowerCase())?.value ?? undefined;
    },
    /** Every channel known right now. */
    list() {
      return signalStore.all().map(({ channel, kind, min, max, live }) => ({ channel, kind, min, max, live }));
    },
    /**
     * Sends a reading the script worked out — a count, a height — onto the
     * bus, where it becomes an input like any other: it shows up on the patch
     * bay and can be wired from there. Declared to the store before the first
     * value goes out, so it exists with the kind the script said rather than
     * whatever the store would guess from one number.
     */
    publish(channel, value, { kind } = {}) {
      const name = String(channel ?? '').trim().toLowerCase();
      if (!CHANNEL_NAME.test(name)) {
        log('error', `inputs.publish: "${channel}" is not a usable name — letters, digits, - and _ only.`);
        return false;
      }
      const number = Number(value);
      if (!Number.isFinite(number)) {
        log('error', `inputs.publish('${name}') needs a number, got ${describe(value)}.`);
        return false;
      }
      if (publishDepth >= PUBLISH_DEPTH) {
        log('warn', `inputs.publish('${name}') is being called from inside its own listener — dropped.`);
        return false;
      }
      const descriptor = kind ? { channel: name, kind } : { channel: name };
      if (!published.has(name) || published.get(name).kind !== descriptor.kind) {
        published.set(name, descriptor);
        signalStore.setPublishedChannels([...published.values()]);
      }
      publishDepth += 1;
      try {
        emitInput({ channel: name, value: number, raw: `${name}:${number}` });
      } finally {
        publishDepth -= 1;
      }
      return true;
    },
  };

  // The script's timers, so Stop can clear them. Each callback is run through
  // `safely` for the same reason the listeners are.
  function schedule(kind, fn, delay = 0, args = []) {
    if (typeof fn !== 'function') {
      log('error', `${kind === 'interval' ? 'setInterval' : 'setTimeout'} needs a function to call.`);
      return 0;
    }
    const entry = { id: null, kind };
    const context = kind === 'interval' ? 'in a setInterval callback' : 'in a setTimeout callback';
    const tick = () => {
      if (kind === 'timeout') pending.delete(entry);
      safely(() => fn(...args), context);
    };
    entry.id = kind === 'interval' ? timers.setInterval(tick, delay) : timers.setTimeout(tick, delay);
    pending.add(entry);
    return entry.id;
  }
  function cancel(id) {
    for (const entry of pending) {
      if (entry.id !== id) continue;
      pending.delete(entry);
      if (entry.kind === 'interval') timers.clearInterval(id);
      else timers.clearTimeout(id);
    }
  }
  const scriptTimers = {
    setTimeout: (fn, delay, ...args) => schedule('timeout', fn, delay, args),
    setInterval: (fn, delay, ...args) => schedule('interval', fn, delay, args),
    clearTimeout: cancel,
    clearInterval: cancel,
  };

  // `console.log` goes to the panel's log, where the person is looking, rather
  // than to devtools, which they may never have opened.
  const console = {
    log: (...parts) => log('info', ...parts),
    info: (...parts) => log('info', ...parts),
    debug: (...parts) => log('info', ...parts),
    warn: (...parts) => log('warn', ...parts),
    error: (...parts) => log('error', ...parts),
  };

  // A new scheme is a new engine, with every port back at rest, so what was
  // held of the old one is simply forgotten rather than released into it.
  gameHost.onGameChange?.(() => {
    held.clear();
    levels.clear();
    lastFired.clear();
  });

  function stop({ status = 'idle', message = 'Stopped.' } = {}) {
    generation += 1;
    const wasRunning = running;
    running = false;
    for (const entry of pending) {
      if (entry.kind === 'interval') timers.clearInterval(entry.id);
      else timers.clearTimeout(entry.id);
    }
    pending.clear();
    for (const unsubscribe of [...subscriptions]) unsubscribe();
    subscriptions.clear();
    // Let go of everything the script was holding: a craft that keeps climbing
    // after Stop is the one outcome that would make Stop feel broken.
    for (const control of held.values()) actions().setValue(control.node, control.port, 0);
    held.clear();
    for (const control of levels.values()) actions().setValue(control.node, control.port, control.defaultValue);
    levels.clear();
    lastFired.clear();
    if (published.size) {
      published.clear();
      signalStore.setPublishedChannels([]);
    }
    if (wasRunning && status === 'idle') log('info', message);
    setStatus(status, message);
  }

  async function run(source) {
    if (running) stop();
    generation += 1;
    const mine = generation;
    let body;
    try {
      body = compile(String(source ?? ''));
    } catch (error) {
      report(error, 'Syntax error');
      setStatus('error', `Syntax error: ${error.message}`);
      return false;
    }
    running = true;
    setStatus('running', 'Running.');
    log('info', 'Running.');
    try {
      await body(inputs, game, scriptTimers.setTimeout, scriptTimers.setInterval,
        scriptTimers.clearTimeout, scriptTimers.clearInterval, console);
    } catch (error) {
      if (mine !== generation) return false; // stopped, or replaced, while it ran
      report(error, 'The script stopped with an error');
      stop({ status: 'error', message: `Stopped: ${error?.message ?? describe(error)}` });
      return false;
    }
    if (mine !== generation) return true;
    // A script with nothing left listening and no timer pending has finished —
    // not failed, but not running either, and the status should not claim it is.
    if (!subscriptions.size && !pending.size) {
      running = false;
      setStatus('idle', 'Finished. To keep reacting to inputs, listen with inputs.on(…).');
    }
    return true;
  }

  return {
    run,
    stop: () => stop(),
    running: () => running,
    status: () => state,
    /** The same `inputs` and `game` the script gets; this is what goes on window. */
    api: () => ({ inputs, game }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
