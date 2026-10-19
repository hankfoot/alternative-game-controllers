// Shared input bus.
//
// Everything that PRODUCES input (the micro:bit over Bluetooth) calls emitInput().
// Everything that CONSUMES input (visualizer, game) listens with onInput().
// Consumers never care where a message came from.

const bus = new EventTarget();

/**
 * A parsed input message — one reading from one channel.
 * The wire protocol is "<channel>:<number>\n"; channels are raw sensor streams
 * (btna, light, pitch, p0, shake, …) with raw values. See js/channels.js for
 * known-channel metadata; unknown channel names are perfectly valid.
 * @typedef {{ channel: string, value: number, raw?: string }} InputMsg
 */

/** Broadcast an input message to every consumer. @param {InputMsg} msg */
export function emitInput(msg) {
  bus.dispatchEvent(new CustomEvent('input', { detail: msg }));
}

/** Subscribe to input messages. @param {(msg: InputMsg) => void} handler */
export function onInput(handler) {
  const listener = (e) => handler(e.detail);
  bus.addEventListener('input', listener);
  return () => bus.removeEventListener('input', listener);
}

/**
 * A game command from the board — "game:press:flap", "game:hold:thrust:1",
 * "game:set:paddle:0.5", "game:start" — parsed by js/line-protocol.js and
 * acted on by js/game-commands.js. Not an input: nothing is read from it, it
 * is the board telling the game what to do.
 * @typedef {{ verb: 'press'|'hold'|'set'|'start', control?: string, value?: number, raw: string }} CommandMsg
 */

/** @param {CommandMsg} command */
export function emitCommand(command) {
  bus.dispatchEvent(new CustomEvent('command', { detail: command }));
}

/** @param {(command: CommandMsg) => void} handler */
export function onCommand(handler) {
  const listener = (e) => handler(e.detail);
  bus.addEventListener('command', listener);
  return () => bus.removeEventListener('command', listener);
}

// Connection status is broadcast the same way so the UI can react.
/** @typedef {{ state: 'disconnected'|'connecting'|'connected', message?: string }} StatusMsg */

/** @param {StatusMsg} status */
export function emitStatus(status) {
  bus.dispatchEvent(new CustomEvent('status', { detail: status }));
}

/** @param {(status: StatusMsg) => void} handler */
export function onStatus(handler) {
  const listener = (e) => handler(e.detail);
  bus.addEventListener('status', listener);
  return () => bus.removeEventListener('status', listener);
}
