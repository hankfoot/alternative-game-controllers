// Game commands coming up the wire from the board.
//
// The patch bay maps one reading to one port. It cannot count ("flap every
// third clap"), combine two readings, take a rate of change or apply a curve,
// and at the workshop those were exactly the controllers people wanted. Those
// need code — and the code runs on the micro:bit, in MakeCode, where an LLM can
// write it and the board's own compiler checks it. Nothing pasted into this
// page is ever executed: the browser only reads lines.
//
// The lines are the game's API. The generated program carries four helpers
// (see js/builder.js) that write them:
//
//   game:press:<control>          gamePress("flap")
//   game:hold:<control>:<0|1>     gameHold("thrust", true)
//   game:set:<control>:<0..1>     gameSet("paddle", 0.5)
//   game:start                    gameStart()
//
// Control names are the friendly ones from js/game-facade.js, so the same
// words appear in the instructions, in the code, and on the wire.

import { onCommand, onStatus } from './bus.js';
import { createGameFacade } from './game-facade.js';

// How many commands the log remembers. Enough to see what the board has been
// saying; the last line is the one that matters.
const KEEP = 50;

export function createCommandBridge({
  gameHost,
  subscribeCommand = onCommand,
  subscribeStatus = onStatus,
  now = () => globalThis.performance?.now() ?? Date.now(),
  keep = KEEP,
}) {
  const listeners = new Set();
  const recent = [];
  // Whether the board has sent a command since it connected. Tells the Game
  // screen's wiring check to stand down: the board is steering itself.
  let driven = false;

  function emit(event) {
    listeners.forEach((listener) => listener(event));
  }

  function remember(entry) {
    recent.push(entry);
    if (recent.length > keep) recent.splice(0, recent.length - keep);
    emit({ type: 'command', ...entry });
  }

  const game = createGameFacade({
    gameHost,
    now,
    log: (level, text) => remember({ level, text, at: now() }),
  });

  function apply(command) {
    let ok = false;
    if (command.verb === 'press') ok = game.press(command.control);
    else if (command.verb === 'hold') ok = game.hold(command.control, command.value > 0);
    else if (command.verb === 'set') ok = game.set(command.control, command.value);
    else if (command.verb === 'start') ok = game.start();
    const wasDriven = driven;
    driven = true;
    remember({ level: ok ? 'info' : 'warn', text: command.raw, at: now() });
    if (!wasDriven) emit({ type: 'driven', driven: true });
  }

  const unsubscribeCommand = subscribeCommand(apply);
  const unsubscribeStatus = subscribeStatus((status) => {
    if (status.state === 'connected') return;
    // The board is gone; whatever it was holding, it is not holding now.
    game.release();
    if (driven) {
      driven = false;
      emit({ type: 'driven', driven: false });
    }
  });

  return {
    /** The facade the commands go through — the same one the console gets. */
    game,
    driven: () => driven,
    recent: () => [...recent],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      unsubscribeCommand();
      unsubscribeStatus();
      listeners.clear();
    },
  };
}
