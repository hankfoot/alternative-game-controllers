import assert from 'node:assert/strict';
import test from 'node:test';

const MODES = { p0: 'touch', p1: 'touch', p2: 'touch' };

import { CONNECT_SETTLE_MS, INPUTS, SCAN_MS, assemble, generateCode, streamLoad, variantFor } from '../js/builder.js';

const load = (ids, modes = MODES) => streamLoad(ids.map((id) => variantFor(id, modes[id])));

const code = (ids, modes = MODES) => generateCode(new Set(ids), modes);
const count = (text, needle) => text.split(needle).length - 1;

// Everything below is about one property: the flashed program reports over the
// radio, and touches nothing else.

test('every reading is written through one send, and only send touches the radio', () => {
  const program = code(['btna', 'pitch', 'shake', 'p0']);

  assert.equal(count(program, 'function send'), 1, 'defined exactly once');
  assert.equal(count(program, 'bluetooth.uartWriteLine('), 1);
  const inSend = program.slice(program.indexOf('function send'), program.indexOf('\n}\n', program.indexOf('function send')));
  assert.ok(/if \(connected\) \{\s*\n\s*bluetooth\.uartWriteLine\(line\)/.test(inSend),
    'and only once a browser has attached');
});

// The board wrote to USB serial as well as the radio, and every part of that was
// trouble. Writing blocks once the transmit buffer fills with nothing draining
// it — the ordinary state of a board on a battery — so the board hung on the
// first reading it sent. Guarding the write on a greeting from the browser meant
// a serial receive handler, and then the board rebooted in a loop instead.
//
// Nothing in the generated program may touch serial again without that history
// being reckoned with, so this is pinned rather than left to be re-added by
// someone who wants the cable back.
test('the flashed program does not touch serial at all', () => {
  const program = code(INPUTS.map((input) => input.id));

  assert.ok(!program.includes('serial.'), 'no serial calls');
  assert.ok(!program.includes('wired'), 'and no leftover handshake for one');
});

// The guard used to wrap every handler body and the loop. `connected` only ever
// becomes true when a Bluetooth browser attaches, so leaving it in place meant a
// session over the cable fired every handler and sent nothing at all.
test('nothing that reads or reports is gated on a Bluetooth browser being attached', () => {
  const program = code(['btna', 'shake', 'pitch', 'light']);
  const lines = program.split('\n');

  const sendBody = lines.indexOf('    if (connected) {');
  assert.ok(sendBody > 0, "send's own guard is there");
  // The face on the LEDs asks too — it is what shows whether you are paired —
  // and that is the only other place.
  const face = program.slice(program.indexOf('basic.forever(function () {\n    if (busy) {'));
  const rest = program.replace(face, '');
  assert.equal(count(rest, 'if (connected)'), 1, 'send is the only reader of the readings that asks');
});

// `showString` blocks for the length of its scroll — about two seconds — so in
// the loop that reads and sends, it would drop the board to one reading every
// two seconds. It runs only when B is held, in its own handler.
test('holding B scrolls the board name, and nothing else ever does', () => {
  const program = code(['pitch']);
  assert.equal(count(program, 'control.deviceName()'), 1);
  const hold = program.indexOf('control.onEvent(EventBusSource.MICROBIT_ID_BUTTON_B, 5, function () {');
  const end = program.indexOf('\n})\n', hold);
  const name = program.indexOf('basic.showString(control.deviceName())');
  assert.ok(hold > 0 && name > hold && name < end, 'only on the B-held event');
  assert.ok(program.slice(hold, end).includes('busy = true'), 'holding the LEDs while it scrolls');
});


// MakeCode can only show the program as blocks if it can decompile it, which is
// why the whole file avoids ternaries. `send` is the one function it defines.
test('the generated program stays block-shaped', () => {
  const program = code(INPUTS.map((input) => input.id));
  assert.ok(!program.includes('?'), 'no ternaries anywhere');
  assert.ok(!program.includes('=>'), 'and no arrow functions');

  // A reporter alone on a line compiles fine but is not a shape MakeCode can
  // turn back into blocks, so the whole program silently drops to JavaScript.
  // Two priming reads were written that way. They return a value, so they have
  // to be assigned to something; the calls returning nothing are the safe ones.
  const reporters = /^\s*(input\.(pinIsPressed|compassHeading|lightLevel|rotation|acceleration)|pins\.(digitalReadPin|analogReadPin))\(/;
  for (const line of program.split('\n')) {
    if (reporters.test(line)) {
      assert.fail(`reporter standing alone as a statement, which will not decompile: ${line.trim()}`);
    }
  }
});

// An open switch leaves the pin attached to nothing, and a floating input picks
// up room hum — the switch flapping before anyone has touched it. The pull-down
// is the whole fix.
test('a switch pin is pulled down', () => {
  const program = code(['p0'], { p0: 'switch' });
  assert.ok(program.includes('pins.setPull(DigitalPin.P0, PinPullMode.PullDown)'),
    'the pin is tied to 0 while the circuit is open');
});

// A switch used to report its pin's RISE and FALL events, and that is the one
// source that cannot be reported raw: the events come straight off the GPIO
// interrupt with no debounce, a foil contact produces dozens per touch, the bus
// keeps ten per listener and drops the rest, and when the dropped one was the
// final FALL the browser was never told the switch had opened. So a switch is
// scanned instead — read fifty times a second by one loop, reporting the level
// only when it changes — and nothing about it may go back on the event bus.
test('a switch pin is scanned for changes, never watched for edges', () => {
  const program = code(['p0', 'p1'], { p0: 'switch', p1: 'switch' });

  assert.ok(!program.includes('setEvents'), 'no edge events are switched on');
  assert.ok(!program.includes('MICROBIT_PIN_EVT'), 'and none are listened for');
  assert.equal(count(program, `loops.everyInterval(${SCAN_MS}, function () {`), 1,
    'one scan loop, shared by every switch');
  assert.ok(program.includes('if (p0Sent == 0) {') && program.includes('if (p1Sent == 0) {'),
    'each reports only when its level has changed');
  assert.ok(program.includes('p0OpenFor >= 2'), 'and an open has to hold before it is believed');
});

// Touch does its own sensing and is actively broken by a pull — it is the one
// pin mode that must be left alone.
test('a touch pin is not pulled', () => {
  const program = code(['p0'], { p0: 'touch' });
  assert.ok(!program.includes('setPull'));
});

// Setting a pad's mode is also when it calibrates, taking what it reads over
// the next half second as "untouched". Done at startup that is a bare pin —
// the code is flashed before anything is built — and a clip, a wire and a sheet
// of foil read as a touch that never ends. So the pad is primed on the first
// connection instead, when the thing is built; and only the first, because the
// link drops and recovers by itself and a hand holding the pad through that
// would be calibrated in as the baseline.
test('a touch pin calibrates at startup, straight after the hands-off countdown', () => {
  const program = code(['p0'], { p0: 'touch' });
  const mode = 'pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)';
  // Once at startup, and once more inside the A+B recalibration.
  const outside = program.slice(0, program.indexOf('input.onButtonPressed(Button.AB'))
    + program.slice(program.indexOf('\n})\n', program.indexOf('input.onButtonPressed(Button.AB')));
  assert.equal(count(outside, mode), 1);

  const countdownCall = program.indexOf('\ncountdown()\n');
  assert.ok(countdownCall > 0 && program.indexOf(mode, countdownCall) > countdownCall, 'after the 3-2-1');
  assert.ok(program.indexOf(mode, countdownCall) < program.indexOf('busy = false', countdownCall),
    'and before the face loop takes over, so it is done by the time anyone can connect');
  const connectAt = program.indexOf('bluetooth.onBluetoothConnected');
  const connectEnd = program.indexOf('\n})\n', connectAt);
  assert.ok(!program.slice(connectAt, connectEnd).includes('touchSetMode'), 'not when the browser connects');
});

// What the LEDs say: 3-2-1 while it is not ready, then — until it pairs — a
// Bluetooth rune for a second and an X for a second, round and round; a smiley
// once it has paired. One loop owns them. Holding B shows the board's name.
test('the LEDs count down at startup, then show whether the board is paired', () => {
  const program = code(['btna']);
  const countdown = program.slice(program.indexOf('function countdown () {'));
  assert.ok(countdown.startsWith('function countdown () {\n    busy = true\n    basic.showNumber(3)\n    basic.showNumber(2)\n    basic.showNumber(1)'));
  const startup = program.indexOf('\ncountdown()\n');
  const ready = program.indexOf('busy = false', startup);
  assert.ok(startup > 0 && ready > startup, 'count, then the face takes over');

  const face = program.slice(program.indexOf('basic.forever(function () {\n    if (busy) {'));
  assert.ok(face.includes('basic.showIcon(IconNames.Happy)'), 'a smiley when paired');
  const rune = face.indexOf('basic.showLeds(`');
  const x = face.indexOf('basic.showIcon(IconNames.No)');
  assert.ok(rune > 0 && x > rune, 'unpaired: the rune, then the X');
  assert.ok(face.slice(rune, x).includes('basic.pause(1000)') && face.slice(x).includes('basic.pause(1000)'),
    'each held for a full second, timed by the program');
  assert.ok(!face.includes('deviceName'), 'and no name in the waiting loop');
  assert.equal(count(program, 'IconNames.Happy'), 1, 'drawn only by the face loop');
  const connectAt = program.indexOf('bluetooth.onBluetoothConnected');
  assert.ok(!program.slice(connectAt, program.indexOf('\n})\n', connectAt)).includes('showIcon'),
    'the connect handler leaves the drawing to the face loop');
});

// The connected event fires as the link comes up, but the browser only
// subscribes to readings after it has looked the UART service up, and a line
// written before then is dropped rather than queued. Reported at once, the
// state of every held input went nowhere.
test('held inputs report their state only after the browser has had time to subscribe', () => {
  const program = code(['btna', 'p0', 'p1'], { p0: 'touch', p1: 'switch' });
  const pause = program.indexOf(`basic.pause(${CONNECT_SETTLE_MS})`);
  assert.ok(pause > 0, 'the report waits');
  for (const report of ['send("btna:', 'send("p0:', 'send("p1:']) {
    // The first occurrence of each is the one in the connected handler.
    assert.ok(program.indexOf(report) > pause, `${report} comes after the wait`);
  }
});

// A browser attaching mid-hold is told the switch is closed; the scan then has
// to know that was said, or it keeps quiet when the switch opens.
test('reporting a switch on connect also resets what the scan believes it sent', () => {
  const program = code(['p1'], { p1: 'switch' });
  const report = program.indexOf('send("p1:1")');
  assert.ok(program.lastIndexOf('p1Sent = 1', report) > 0, 'the scan is told a 1 went out');
});

// Resistive touch — the default — only reads when the player completes a circuit
// to GND, so it needs a second clip held in the other hand and does nothing at
// all without one. That was "touch doesn't work". Capacitive needs one wire.
test('a touch pin senses capacitively, so no GND wire is needed', () => {
  const program = code(['p0'], { p0: 'touch' });
  assert.ok(program.includes('pins.touchSetMode(TouchTarget.P0, TouchTargetMode.Capacitive)'));
  // Resistive only as the hop that makes A+B rebuild the sensor; it is put
  // straight back to capacitive on the next line.
  const resistive = program.split('\n').findIndex((line) => line.includes('TouchTargetMode.Resistive'));
  assert.ok(program.split('\n')[resistive + 1].includes('TouchTargetMode.Capacitive'));
  assert.equal(count(program, 'TouchTargetMode.Resistive'), 1);
});

// Code somebody adds below the program — usually written by an LLM from the
// Code it instructions — drives the game through four helpers. They are
// promised by those instructions, so they are there whether or not anything
// uses them, and they write the exact lines js/game-commands.js reads.
test('the four game helpers are always there, and speak the command lines', () => {
  const program = code(['pitch']);
  assert.ok(program.includes('function gamePress (control: string) {'));
  assert.ok(program.includes('send("game:press:" + control)'));
  assert.ok(program.includes('function gameHold (control: string, on: boolean) {'));
  assert.ok(program.includes('send("game:hold:" + control + ":1")'));
  assert.ok(program.includes('send("game:hold:" + control + ":0")'));
  assert.ok(program.includes('function gameSet (control: string, value: number) {'));
  assert.ok(program.includes('send("game:set:" + control + ":" + value)'));
  assert.ok(program.includes('function gameStart () {'));
  assert.ok(program.includes('send("game:start")'));
  assert.equal(count(program, 'bluetooth.uartWriteLine('), 1, 'and all through the one send');
});

// A clap is over in less than the 100 ms between two samples of the streamed
// sound level, so counting claps off `mic` lost most of them. The board's own
// loud-sound event fires once per clap and costs the radio nothing between.
test('a loud sound is reported as an event off the board, not read off the mic', () => {
  const program = code(['loud']);
  assert.ok(program.includes('input.onSound(DetectedSound.Loud, function () {'));
  assert.ok(program.includes('send("loud:1")'));
  assert.ok(!program.includes('soundLevel'), 'and streams nothing for it');
  const load = streamLoad([variantFor('loud')]);
  assert.deepEqual({ streamed: load.streamed, pressed: load.pressed }, { streamed: 0, pressed: 0 });
});

test('a build of nothing but gestures still reports them', () => {
  const program = code(['shake', 'g8']);
  assert.ok(program.includes('send("shake:1")'));
  assert.ok(program.includes('send("g8:1")'));
});

// --- What the load warning is grading ---------------------------------------

test('load counts polled readings apart from contacts, and gestures not at all', () => {
  const quiet = load(['shake', 'g8', 'freefall']);
  assert.deepEqual({ streamed: quiet.streamed, pressed: quiet.pressed }, { streamed: 0, pressed: 0 },
    'gestures are free — they only send when they happen');

  const busy = load(['pitch', 'roll', 'light', 'btna', 'btnb']);
  assert.equal(busy.streamed, 3, 'three live readings');
  assert.equal(busy.pressed, 2, 'two contacts reporting edges');
  assert.ok(busy.weight > busy.streamed, 'and contacts do count for something');
  assert.ok(busy.weight < busy.streamed + busy.pressed, 'but for less than a live reading');
});

// --- The assembler ------------------------------------------------------------------

test('an analog pin streams a voltage and is left unpulled', () => {
  const program = code(['p2'], { p2: 'analog' });
  assert.ok(program.includes('send("p2:" + pins.analogReadPin(AnalogPin.P2))'));
  assert.ok(!program.includes('setPull'));
  assert.equal(load(['p2'], { p2: 'analog' }).streamed, 1);
});

// The sentences on Controls, and anything typed by hand, ride on the same
// scaffold as the inputs — a part with its own lines, and lines at the end.
test('assemble takes parts of its own, and lines to append', () => {
  const part = { kind: 'binary', channels: [], state: ['let taps = 0'], handlers: ['input.onGesture(Gesture.Shake, function () {', '    taps += 1', '})'] };
  const program = assemble([variantFor('btna'), part], { extra: ['// by hand', 'gameStart()'] });
  assert.ok(program.indexOf('let taps = 0') < program.indexOf('function send'), 'state is declared up top');
  assert.ok(program.includes('    taps += 1'));
  assert.ok(program.endsWith('// by hand\ngameStart()'), 'hand-written lines come last');
  assert.equal(variantFor('p0', 'nonsense'), null);
  assert.equal(variantFor('nothing'), null);
});

// A pad can learn "untouched" too low — a foil square caught mid-settle — and
// then read as touched for ever. A and B together teach it again, and raise the
// release the stuck pad never sent, so the page and the game let go too.
test('a touch pad can be recalibrated with A and B, which also releases it', () => {
  const program = code(['p0', 'p2'], { p0: 'touch', p2: 'touch' });
  assert.equal(count(program, 'input.onButtonPressed(Button.AB, function () {'), 1, 'one handler for every pad');
  const ab = program.slice(program.indexOf('input.onButtonPressed(Button.AB'));
  assert.ok(ab.indexOf('countdown()') < ab.indexOf('TouchTargetMode.Resistive'), 'counted down first, so hands come off');
  for (const n of [0, 2]) {
    const away = program.indexOf(`pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Resistive)`);
    const back = program.indexOf(`pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Capacitive)`, away);
    const up = program.indexOf(`control.raiseEvent(EventBusSource.MICROBIT_ID_IO_P${n}, EventBusValue.MICROBIT_BUTTON_EVT_UP)`);
    assert.ok(away > 0 && back > away && up > back, `P${n}: switched away, back, then released`);
  }
  assert.ok(!code(['p1'], { p1: 'switch' }).includes('Button.AB'), 'nothing to recalibrate, no handler');
});
