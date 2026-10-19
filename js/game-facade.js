// The game's controls by friendly name: press, hold, set, start.
//
// The wiring board addresses a port as a node and a jack — flap.trigger,
// lift.thrust, paddle.y — which reads fine on a card with a cable plugged into
// it. A line of code, or a command coming up the wire from the board, has to
// carry the whole meaning alone, so this layer names each port for what it
// does: `flap`, `thrust`, `up`, `down`, `paddle`, `shift`, `advance`. Names
// are resolved when called, against whichever scheme is picked right then, so
// switching scheme mid-game just makes the old names unknown — which is
// reported, not thrown.
//
// Two things drive the game through here: commands the board sends (see
// js/game-commands.js), and anyone with the console open (`workshop.game`).

// A port whose own id only says what *type* of jack it is takes its card's
// name instead: flap.trigger is `flap`, paddle.y is `paddle`, shift.hold and
// shift.level are both `shift` (told apart by the verb), while slide.up stays
// `up` and ui.advance stays `advance`.
const GENERIC_PORT_IDS = ['trigger', 'y', 'hold', 'level'];

// The port types are the wiring board's words; these are the controls'.
const KIND_OF_TYPE = { trigger: 'press', hold: 'hold', level: 'level' };

const ALIASES = { start: 'advance' };

/** The controls of a scheme, by name. Pure. */
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
export const usage = (control) => ({
  press: `gamePress("${control.name}")`,
  hold: `gameHold("${control.name}", true)`,
  level: `gameSet("${control.name}", 0.5)`,
}[control.kind]);

export function createGameFacade({
  gameHost,
  now = () => globalThis.performance?.now() ?? Date.now(),
  log = () => {},
}) {
  const held = new Map(); // "node.port" → control
  const levels = new Map(); // "node.port" → control
  const lastFired = new Map(); // "node.port" → time

  const keyOf = (control) => `${control.node}.${control.port}`;
  const actions = () => gameHost.actions;
  const controls = () => controlsFor(gameHost.activeGame()?.targets);

  function resolve(name, kind) {
    const all = controls();
    const wanted = String(name ?? '').trim().toLowerCase();
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
    /** Fires a press control, e.g. `press('flap')`. True if it fired. */
    press(name) {
      const control = resolve(name, 'press');
      if (!control) return false;
      // The wiring engine paces a port on a wire's behalf; here the port is
      // called directly, so the pacing has to be kept or `advance` would
      // restart the round on every reading.
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
        log('error', `gameSet("${name}") needs a number from 0 to 1, got ${String(value)}.`);
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
    /**
     * Lets go of everything held and rests every level. For the board going
     * away: a craft that keeps climbing after the controller walked out of
     * range is the one outcome that would feel broken.
     */
    release() {
      for (const control of held.values()) actions().setValue(control.node, control.port, 0);
      held.clear();
      for (const control of levels.values()) actions().setValue(control.node, control.port, control.defaultValue);
      levels.clear();
      lastFired.clear();
    },
  };

  // A new scheme is a new engine, with every port back at rest, so what was
  // held of the old one is simply forgotten rather than released into it.
  gameHost.onGameChange?.(() => {
    held.clear();
    levels.clear();
    lastFired.clear();
  });

  return game;
}
