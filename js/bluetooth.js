// Web Bluetooth connection to a micro:bit's UART (Nordic UART Service).
//
// The micro:bit, running one of the MakeCode starters with the Bluetooth UART
// service enabled, sends newline-delimited text. We buffer bytes, split on '\n',
// and parse each line into a protocol message, then push it onto the shared bus.
//
// The link drops. Batteries sag, someone walks their controller out of range,
// someone else stands between the two, the board resets when an alligator clip
// shorts something. None of that is worth a person's attention, so a drop is
// picked back up here rather than reported: the browser is allowed to reconnect
// to a device it has already been given without asking again, and the retries
// below are the difference between "it broke" and a couple of dropped frames.

import { emitStatus, emitInput } from './bus.js';
import { createLineBuffer, parseLine } from './line-protocol.js';
import { createContactSettle } from './contact-settle.js';

// Nordic UART Service UUIDs. The micro:bit transmits on 6e400002; subscribing
// to the Nordic example's opposite characteristic connects but yields no data.
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // micro:bit -> browser (notifications)

// How long to keep trying after an unexpected drop, and how long to wait between
// tries. Front-loaded because most drops are momentary — a board that browns out
// for an instant is usually back before the first wait is over — and stopping
// after four because by then it is something a person has to go and fix.
const RETRY_DELAYS = [400, 1200, 3000, 6000];

// A first connection gets a couple of quick second tries too. A board that has
// just been let go — by a Disconnect, by MakeCode, by a reset — often refuses
// the very next attempt and takes the one after, which is most of why
// reconnecting "didn't always work".
const FIRST_TRY_DELAYS = [500, 1500];

// How long one attempt may take before it counts as failed. `gatt.connect()`
// can otherwise wait forever on a board that is half there, and a page saying
// "Connecting…" with nothing to press is the loop people got stuck in.
const ATTEMPT_TIMEOUT_MS = 8000;

let device = null;
// Whether we have already hooked this device's disconnect event. Chrome hands
// back the same BluetoothDevice object for the same board, so connecting twice
// without this stacks a second identical listener on the same object.
let watching = null;
let retryTimer = null;
let attempt = 0;
// The board a first connection is being made to. Its drops along the way are
// that attempt's business — the quick retries let it go on purpose — and
// must not also start the reconnect loop meant for a link that was up.
let opening = null;
// What the last status said, so a failure with nothing to report — the chooser
// being dismissed, most of all — can put it back rather than inventing one.
let state = { state: 'disconnected' };

// `midStream`, because subscribing does not make the board start a fresh line —
// it is already running, and the first notification can land halfway through one.
// Parsed as though it were whole, that half arrives as a channel that does not
// exist, or worse, one that does with a mangled number. The first partial line is
// dropped instead. This came from the wire, where it showed up as a channel
// called `pitpitch`; nothing about it was specific to the wire.
//
// Contact bounce is taken out on the way in too, so everything downstream — the
// live readout, the meters on the Controls page, and every wire — sees one press
// rather than the dozens of edges a piece of foil actually produces. It belongs
// here rather than in a wire, because a contact bounces because of what it is
// made of, not because of what it is wired to. See js/contact-settle.js.
const settled = createContactSettle({ emit: emitInput });

const lines = createLineBuffer({ midStream: true, onLine: (raw) => parseLine(raw, settled) });

function announce(next) {
  state = next;
  emitStatus(next);
}

/**
 * Plain English for a failed connection.
 *
 * Web Bluetooth's own messages are close to useless at the moment they matter —
 * "Connection failed for unknown reason" is the one people actually see — while
 * the `name` says which of several very different problems it is. In a room of
 * twenty boards, "the board is busy" and "the wrong program is on it" need
 * opposite responses, so the distinction is worth spelling out.
 */
export function describeFailure(err) {
  const name = err?.name || '';
  if (name === 'NotSupportedError') {
    return 'Connected, but this board is not running a program with Bluetooth on it. Re-flash from the Build step.';
  }
  if (name === 'NetworkError') {
    // Overwhelmingly this is the board already being held: the MakeCode editor
    // keeps its own link to a board it has flashed, and the OS will not hand the
    // same board to a second thing. It also covers a board that walked away.
    return 'Could not reach the board. Close the MakeCode editor tab, then press the board’s reset button and try again.';
  }
  if (name === 'SecurityError') {
    return 'The browser blocked the connection. This page has to be served over https or localhost.';
  }
  if (name === 'InvalidStateError') {
    return 'The board is still starting up. Give it a second and try again.';
  }
  return err?.message || 'Could not connect.';
}

/** Is Web Bluetooth available in this browser? */
export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

class Cancelled extends Error {
  constructor() {
    super('Connection cancelled.');
    this.name = 'Cancelled';
  }
}

/** Rejects if `work` takes longer than `ms`. */
function withTimeout(work, ms) {
  let timer = null;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('The board took too long to answer.');
      error.name = 'NetworkError';
      reject(error);
    }, ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Opens the UART stream on an already-chosen device, or gives up after a while. */
function openStream(target) {
  return withTimeout(openStreamNow(target), ATTEMPT_TIMEOUT_MS);
}

async function openStreamNow(target) {
  const server = await target.gatt.connect();
  const service = await server.getPrimaryService(UART_SERVICE);
  const txChar = await service.getCharacteristic(UART_TX);
  await txChar.startNotifications();
  txChar.addEventListener('characteristicvaluechanged', onNotify);
  // Anything left over belongs to a session that has ended; a line cut in half
  // by a drop would otherwise be glued to the first line of the next one. The
  // same goes for a contact that was being held when the board went away — it is
  // not held now, and there is no release coming to say so.
  lines.reset();
  settled.reset();
}

/** Prompt the user to pick a micro:bit and start streaming its input. */
export async function connect() {
  if (!isSupported()) {
    announce({ state: 'disconnected', message: 'Web Bluetooth not supported' });
    throw new Error('Web Bluetooth not supported in this browser.');
  }

  cancelRetry();
  // Kept before the announcement, because `announce` overwrites `state` — so by
  // the time the chooser is dismissed below, `state` is already 'connecting' and
  // restoring it would re-announce the very thing we are trying to back out of.
  // That is what left the button reading "Connecting…", disabled, forever.
  const before = state;
  announce({ state: 'connecting' });

  let chosen = null;
  try {
    chosen = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BBC micro:bit' }],
      optionalServices: [UART_SERVICE],
    });
  } catch (err) {
    // Dismissing the chooser is not a failure and must not report one — doing
    // that while a board is already streaming used to blank a live connection.
    announce(before);
    throw err;
  }

  // Pairing a second board while one is already on: let the first one go rather
  // than leaving the OS holding a link nothing is listening to.
  if (device && device !== chosen && device.gatt?.connected) device.gatt.disconnect();

  device = chosen;
  if (watching !== chosen) {
    chosen.addEventListener('gattserverdisconnected', onDisconnected);
    watching = chosen;
  }

  // From here a Disconnect press cancels: it clears `device`, which every await
  // below checks on its way back.
  try {
    await firstConnect(chosen);
  } catch (err) {
    // The link can be up while the service handshake fails — the board is still
    // booting, or the UART service isn't running in what was flashed. Left half
    // open, the OS keeps holding the connection and the next attempt hangs on it.
    // Let go of before released, so the drop that follows is not mistaken for
    // a link that was up and fell over.
    if (device === chosen) device = null;
    release(chosen);
    if (err instanceof Cancelled) return;
    announce({ state: 'disconnected', message: describeFailure(err) });
    throw err;
  }

  attempt = 0;
  announce({ state: 'connected', message: chosen.name || 'micro:bit' });
}

/** The first attempt and its quick second tries, cancelled by a Disconnect. */
async function firstConnect(chosen) {
  opening = chosen;
  try {
    await tryUntilConnected(chosen);
  } finally {
    opening = null;
  }
}

async function tryUntilConnected(chosen) {
  for (let tries = 0; ; tries += 1) {
    if (device !== chosen) throw new Cancelled();
    try {
      await openStream(chosen);
      if (device !== chosen) throw new Cancelled();
      return;
    } catch (err) {
      if (device !== chosen || err instanceof Cancelled) throw new Cancelled();
      // Wrong program on the board, or a blocked page: trying again won't help.
      if (err?.name === 'NotSupportedError' || err?.name === 'SecurityError') throw err;
      const wait = FIRST_TRY_DELAYS[tries];
      if (wait == null) throw err;
      release(chosen);
      await new Promise((wake) => { retryTimer = setTimeout(wake, wait); });
      retryTimer = null;
    }
  }
}

function release(target) {
  try {
    target?.gatt?.disconnect();
  } catch {
    /* already down, which is the state we were asking for */
  }
}

/** Disconnect the current device, if any. Stops us trying to get it back. */
export function disconnect() {
  // Nothing held and nothing pending means nothing to say — unless a
  // connection is mid-way, which is exactly when somebody wants out.
  if (!device && !retryTimer && state.state !== 'connecting') return;
  cancelRetry();
  const target = device;
  device = null;
  attempt = 0;
  lines.reset();
  // Whether or not it has finished connecting: disconnecting a link that is
  // still being made is what makes the pending connect give up.
  release(target);
  announce({ state: 'disconnected' });
}

function cancelRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
}

function onDisconnected(event) {
  // Pairing a second board leaves the first one's listener installed on an
  // object we no longer hold. Its eventual drop is not our connection ending,
  // and reporting it as one is a disconnect out of nowhere while data is still
  // arriving from the board that is actually plugged in.
  if (event?.target && event.target !== device) return;
  if (!device) return; // we asked for this one
  if (opening && event?.target === opening) return; // a first attempt's own business
  lines.reset();
  retry();
}

function retry() {
  const target = device;
  const wait = RETRY_DELAYS[attempt];
  if (wait == null) {
    device = null;
    attempt = 0;
    announce({ state: 'lost', message: target?.name || 'micro:bit' });
    return;
  }

  attempt += 1;
  // `retrying` is what tells the UI there is still a board to give up on: the
  // first connect has nothing to disconnect from, a reconnect very much does.
  announce({ state: 'connecting', retrying: true });
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (device !== target) return; // disconnected, or paired with something else
    try {
      await openStream(target);
    } catch {
      // Still down. `gattserverdisconnected` does not fire for an attempt that
      // never landed, so the next try is booked here rather than waited for.
      if (device === target) retry();
      return;
    }
    // Disconnected while this attempt was on its way: it landed for nobody.
    if (device !== target) {
      release(target);
      return;
    }
    attempt = 0;
    announce({ state: 'connected', message: target.name || 'micro:bit' });
  }, wait);
}

function onNotify(event) {
  lines.push(event.target.value);
}

/** Whether a board is currently held. */
export function isActive() {
  return Boolean(device);
}
