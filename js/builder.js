// The catalogue of inputs a micro:bit program can read, and the assembler that
// turns a set of them into a complete MakeCode program.
//
// Two screens build programs from this. Sensing's lessons each take a few
// inputs and make a snippet to try (js/lessons.js); Controls takes the inputs
// its sentences use and adds the sentences' own code (js/controls-codegen.js).
// Both go through `assemble`, which is the only place the scaffold — the
// radio, `send`, the game helpers, the connect report — is written, so the
// pin fixes that cost a workshop live in exactly one place. The generated code
// speaks the wire protocol: one "<channel>:<number>" line per reading, and
// "game:…" lines for the game.
//
// Generated code is written block-style (if/else, no ternaries) so MakeCode can
// decompile it back to blocks for attendees who'd rather edit visually.

import { channelInfo } from './channels.js';

// --- Code fragments ---------------------------------------------------------

// How long a browser is given, after the radio link comes up, before the board
// tells it where every held input stands. The connected event fires the moment
// the link exists, but the browser only subscribes to readings once it has
// looked the UART service up — a few hundred milliseconds later on a good day —
// and a line written before then is not queued, it is dropped on the floor
// (MicroBitUARTService::send returns NOT_SUPPORTED until indications are on).
// Sent at once, the report never arrived, which is also why its absence was
// never noticed. This also comfortably covers a touch pad's calibration, which
// is ten samples fifty milliseconds apart.
export const CONNECT_SETTLE_MS = 1500;

// Everything the Set up screen's baseline code does, plus the one function every
// reading goes through.
//
// `report` holds the lines that tell a browser where each held input stands as
// it attaches — see `edges` for why that has to be said there rather than every
// tick. `prime` is what must happen once per boot and no earlier than the first
// browser: a touch pad learning what untouched feels like, which is only worth
// doing once the thing is built (see `pinInput`). `state` is the top-level
// variables the scan loop keeps between ticks.
//
// `send` is the one place a line is written, so nothing else in this file needs
// to know whether anybody is listening. A named function with a typed parameter
// still decompiles to blocks, so the promise at the top of this file survives —
// that is the only reason `send` can exist rather than every call site carrying
// the guard.
function scaffoldTop({ state, prime, report }) {
  const connect = [];
  if (prime.length) {
    connect.push('if (!(primed)) {', '    primed = true', ...prime.map((l) => '    ' + l), '}');
  }
  if (report.length) connect.push(`basic.pause(${CONNECT_SETTLE_MS})`, ...report);
  return [
    // Bluetooth only, deliberately.
    //
    // There was a USB path here too, and every part of it was trouble. Writing
    // to serial blocks once the transmit buffer fills with nothing draining it,
    // which is the ordinary state of a board on a battery — so the board hung on
    // the first reading it sent. Guarding that on a greeting from the browser
    // meant a serial receive handler, and the board started rebooting instead.
    // None of it bought anything the radio does not already do.
    'bluetooth.startUartService()',
    'let connected = false',
    ...(prime.length ? ['let primed = false'] : []),
    ...state,
    'function send (line: string) {',
    '    if (connected) {',
    '        bluetooth.uartWriteLine(line)',
    '    }',
    '}',
    // The game's API, as four calls. Code somebody adds below the generated
    // program — usually code an LLM wrote from the Code it instructions on
    // the Controls page — drives the game through these, and never has to
    // know what goes on the wire. The browser reads the lines they write (see
    // js/game-commands.js); nothing it receives is ever executed. Always
    // emitted, even when nothing uses them: the instructions promise they are
    // there, and a promise with a condition on it is a bug report waiting.
    'function gamePress (control: string) {',
    '    send("game:press:" + control)',
    '}',
    'function gameHold (control: string, on: boolean) {',
    '    if (on) {',
    '        send("game:hold:" + control + ":1")',
    '    } else {',
    '        send("game:hold:" + control + ":0")',
    '    }',
    '}',
    'function gameSet (control: string, value: number) {',
    '    send("game:set:" + control + ":" + value)',
    '}',
    'function gameStart () {',
    '    send("game:start")',
    '}',
    'bluetooth.onBluetoothConnected(function () {',
    '    connected = true',
    // Drawn here, on the edge, rather than every time round the loop. Redrawing
    // all 25 LEDs ten times a second for a picture that never changes is real
    // work on the same processor that has to keep the Bluetooth radio fed, and
    // starving the radio is what a mystery disconnection usually turns out to be.
    '    basic.showIcon(IconNames.Yes)',
    ...connect.map((line) => '    ' + line),
    '})',
    'bluetooth.onBluetoothDisconnected(function () {',
    '    connected = false',
    '})',
  ];
}

/** Lines that report a true/false reading as "<channel>:1" / "<channel>:0". */
function binary(channel, expr) {
  return [
    `if (${expr}) {`,
    `    send("${channel}:1")`,
    `} else {`,
    `    send("${channel}:0")`,
    `}`,
  ];
}

/**
 * A top-level event handler. Exported for the sentences on Controls, which
 * add their own lines to the same handlers the inputs report through.
 *
 * This used to wrap every body in `if (connected)` as well. Whether the radio is
 * listening is `send`'s business, asked once there rather than at every call
 * site, which is what keeps a handler to the reading it reports.
 */
export function handler(open, body) {
  return [open, ...body.map((l) => '    ' + l), '})'];
}

/**
 * A held input reported the instant it changes, rather than read once a tick.
 *
 * Two things were wrong with polling it in the forever loop. The loop pauses
 * 100 ms, so a press was up to a tenth of a second late and a quick tap between
 * two ticks was never seen at all — which is what "the button feels laggy" is.
 * And the obvious fix, MakeCode's own `on button pressed`, is worse: that block
 * is wired to the DAL's CLICK event, which by definition fires on *release*, so
 * a hold registers as nothing until you let go. Same for `on pin pressed`, and
 * for `TouchButtonEvent.Pressed` on the logo — all three are clicks.
 *
 * So these go straight to the DOWN and UP events underneath, which fire on the
 * edge itself. The cost is that nothing is sent while the input sits still, so
 * a browser that connects mid-hold would hear silence; `connect` covers that by
 * reading the level once as the connection opens.
 */
function edges(channel, { down, up }) {
  const report = (value) => [`send("${channel}:${value}")`];
  return [...handler(down, report(1)), ...handler(up, report(0))];
}

/** The DOWN and UP handler openers for anything the DAL treats as a button. */
export function buttonEvents(source) {
  const on = (event) =>
    `control.onEvent(EventBusSource.${source}, EventBusValue.MICROBIT_BUTTON_EVT_${event}, function () {`;
  return { down: on('DOWN'), up: on('UP') };
}

/** DOWN/UP off the event bus, for anything the DAL treats as a button. */
function buttonEdges(channel, source) {
  return edges(channel, buttonEvents(source));
}

const LOGO_EVENTS = {
  down: 'input.onLogoEvent(TouchButtonEvent.Touched, function () {',
  up: 'input.onLogoEvent(TouchButtonEvent.Released, function () {',
};

// How often a switch pin is read. Fifty times a second: a close is seen within
// a frame, and the radio can never be asked for more lines than this.
export const SCAN_MS = 20;

/**
 * A switch pin read every SCAN_MS, reporting only when its level changes.
 *
 * This was edge-driven like the buttons, and it was the one input that could
 * not be. A button's DOWN and UP come out of the DAL's button driver, which
 * samples the contact and only speaks once the reading has held still; a pin's
 * RISE and FALL are the GPIO interrupt itself — one event per edge, no
 * filtering at all (NRF52Pin::rise). Two pieces of foil meeting produce dozens
 * of edges in a few milliseconds, each spawning a handler that then blocks on
 * the radio for a whole connection interval. The bus queues at most ten events
 * per listener and throws the rest away (MESSAGE_BUS_LISTENER_MAX_QUEUE_DEPTH),
 * so which edge was the *last* delivered came down to luck — and when the final
 * FALL was the one dropped, the browser was told the switch had closed and was
 * never told otherwise. Switches that stuck on, half a second of lag, presses
 * that went missing: all this.
 *
 * Polling gives up nothing worth having. A close is reported on the first
 * sample that sees it, the stream can never exceed one line per scan, and
 * because it is the level being reported rather than the edges, a lost line
 * is corrected by the next change instead of latching forever. An open has to
 * hold for two samples before it is believed — foil breaks contact for far
 * longer than a switch bounces — which costs the release a frame or two and the
 * radio nothing.
 */
export function switchScan(channel, n, { onClose = [], onOpen = [] } = {}) {
  const sent = `${channel}Sent`;
  const openFor = `${channel}OpenFor`;
  return [
    `if (pins.digitalReadPin(DigitalPin.P${n}) == 1) {`,
    `    ${openFor} = 0`,
    `    if (${sent} == 0) {`,
    `        ${sent} = 1`,
    `        send("${channel}:1")`,
    ...onClose.map((l) => '        ' + l),
    `    }`,
    `} else {`,
    `    ${openFor} += 1`,
    `    if (${sent} == 1 && ${openFor} >= 2) {`,
    `        ${sent} = 0`,
    `        send("${channel}:0")`,
    ...onOpen.map((l) => '        ' + l),
    `    }`,
    `}`,
  ];
}

/** Line that reports a numeric reading as "<channel>:<n>". */
function number(channel, expr) {
  return [`send("${channel}:" + ${expr})`];
}

// --- The inputs -------------------------------------------------------------

/**
 * Each input contributes:
 *   channels — wire channel names it emits
 *   events   — for an on/off input, the DOWN and UP handler openers; `event`
 *              for a one-off; `read` for a number, the expression that reads
 *              it; `pin` for a scanned switch. The sentences on Controls build
 *              their own handlers and loop from these.
 *   loop     — lines run every tick inside the forever loop
 *   scan     — lines run every SCAN_MS inside the fast loop (see `switchScan`)
 *   handlers — top-level event handlers (outside the loop)
 *   setup    — lines run once at startup, after the handlers are registered
 *   state    — top-level variables the scan lines keep between ticks
 *   prime    — lines run once per boot, on the first Bluetooth connection
 *   connect  — lines that report the input's level as a browser attaches
 *   build    — one wiring / build-idea note for the "Build it" list
 * Pin inputs have `modes` instead, keyed by mode id.
 *
 * What a tile says the input reads isn't written here: it comes from the
 * channels themselves (see js/channels.js), so the tile you pick an input with
 * and the block you later wire describe it in exactly the same words. `build`
 * stays local, because it's about the thing you make, not the reading.
 */
function describe(channels) {
  return channels.map((channel) => channelInfo(channel).desc).filter(Boolean);
}

function pinInput(n) {
  const ch = `p${n}`;
  return {
    id: ch,
    emoji: '🔌',
    name: `Pin ${n}`,
    modes: {
      touch: {
        label: 'Touch Pad',
        kind: 'binary', form: 'pad',
        channels: [ch],
        // Setting the mode is also what switches the pin into touch sensing, so
        // this doubles as the priming the pin needs — otherwise it sits in
        // digital mode and the touch events never arrive.
        //
        // Capacitive rather than the default resistive, which is the difference
        // between one wire and two. Resistive touch only reads when the player
        // completes a circuit to GND, so it needs a second clip held in the
        // other hand the whole time — fiddly, easy to let slip, and it fails
        // silently when it does. Capacitive senses the body's charge through
        // the one wire. V2 only, which the workshop's boards are.
        //
        // Primed on the first connection rather than at startup, because
        // setting the mode is also when the pad calibrates: it takes the
        // highest reading over half a second as "untouched" and fires a little
        // above that (TouchButton::calibrate). A crocodile clip, a wire and a
        // sheet of foil add far more than that margin, so a pad calibrated
        // bare at boot — which is when it used to happen, since the code is
        // flashed before anything is built — read as touched from the moment
        // the foil went on and never let go. By the time a browser connects the
        // thing is built. Once per boot, not per connection: the link drops
        // and comes back by itself, and recalibrating under a hand that is
        // holding the pad would teach it that touched is the baseline.
        prime: [`pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Capacitive)`],
        events: buttonEvents(`MICROBIT_ID_IO_P${n}`),
        handlers: buttonEdges(ch, `MICROBIT_ID_IO_P${n}`),
        connect: binary(ch, `input.pinIsPressed(TouchPin.P${n})`),
        build:
          `Clip one wire from P${n} to anything conductive — foil, fruit, a spoon. ` +
          `Touching the object sends 1. No second wire to hold: the pin senses your body through the one clip. ` +
          `Clip everything on <em>before</em> you connect — the pad learns what untouched feels like the first time the browser connects, so keep your hands off it for a second then. ` +
          `Changed the wiring afterwards? Press the reset button on the back of the board and connect again.`,
      },
      switch: {
        label: 'Switch',
        kind: 'binary', form: 'switch',
        channels: [ch],
        // An open switch leaves the pin connected to nothing at all, and a
        // floating input doesn't read 0 — it drifts on whatever hum is in the
        // room and reads as a switch flapping before anyone has touched the
        // thing. The pull-down ties it to 0 while the circuit is open, so the
        // only 1 is the foils actually meeting.
        setup: [`pins.setPull(DigitalPin.P${n}, PinPullMode.PullDown)`],
        state: [`let ${ch}Sent = 0`, `let ${ch}OpenFor = 0`],
        // The pin number, for the sentences on Controls to rebuild the scan
        // with their own lines inside it.
        pin: n,
        scan: switchScan(ch, n),
        // The report also resets the scan's memory of what was last sent, so a
        // browser that attaches mid-hold is not told "closed" here and then
        // told nothing when the scan, which believed it had already said so,
        // sees the switch open.
        connect: [
          `if (pins.digitalReadPin(DigitalPin.P${n}) == 1) {`,
          `    ${ch}Sent = 1`,
          `    send("${ch}:1")`,
          `} else {`,
          `    ${ch}Sent = 0`,
          `    send("${ch}:0")`,
          `}`,
        ],
        build:
          `Make a switch: clip a wire from 3V to one piece of foil, and another from P${n} to a second piece. ` +
          `When the foils touch, the circuit closes and sends 1. Great for jaws, doors, stomp pads.`,
      },
      analog: {
        label: 'Analog',
        kind: 'number', form: 'analog',
        channels: [ch],
        // A voltage, read as 0–1023, ten times a second. A strip of pencil
        // graphite between 3V and GND, with the pin on a clip you slide along
        // it, makes a potentiometer out of a drawing.
        read: `pins.analogReadPin(AnalogPin.P${n})`,
        loop: number(ch, `pins.analogReadPin(AnalogPin.P${n})`),
        build:
          `Read a voltage on P${n} as a number from 0 to 1023. Draw a thick pencil line, clip 3V to one end and GND ` +
          `to the other, and P${n} to a third clip you slide along it: the reading follows the clip. A bent wire ` +
          `dipped in a cup of water, or a strip of foil with a weight pressing on it, work the same way.`,
      },
    },
  };
}

/** A one-off accelerometer gesture: fires "<id>:1" via an onGesture handler. */
function gesture(id, name, gestureName, emoji, build) {
  return {
    id, emoji, name,
    kind: 'event',
    channels: [id],
    event: `input.onGesture(Gesture.${gestureName}, function () {`,
    handlers: handler(`input.onGesture(Gesture.${gestureName}, function () {`,
      [`send("${id}:1")`]),
    build,
  };
}

// Inputs are grouped into three sections shown as separate labelled grids.
const SECTIONS = [
  {
    id: 'touch',
    title: 'Touch & press',
    desc: 'Buttons and things you make conductive. Each sends 1 while active, 0 otherwise.',
    inputs: [
      {
        id: 'btna', emoji: '🔘', name: 'Button A',
        kind: 'binary', form: 'button',
        channels: ['btna'],
        events: buttonEvents('MICROBIT_ID_BUTTON_A'),
        handlers: buttonEdges('btna', 'MICROBIT_ID_BUTTON_A'),
        connect: binary('btna', 'input.buttonIsPressed(Button.A)'),
        build: 'No wiring. To press it with an object, tape something onto the button or build a little lever that pushes it.',
      },
      {
        id: 'btnb', emoji: '🔘', name: 'Button B',
        kind: 'binary', form: 'button',
        channels: ['btnb'],
        events: buttonEvents('MICROBIT_ID_BUTTON_B'),
        handlers: buttonEdges('btnb', 'MICROBIT_ID_BUTTON_B'),
        connect: binary('btnb', 'input.buttonIsPressed(Button.B)'),
        build: 'No wiring. Same tricks as Button A — two buttons means two separate channels.',
      },
      {
        id: 'logo', emoji: '⭐', name: 'Logo touch',
        kind: 'binary', form: 'logo',
        channels: ['logo'],
        // `Touched` is the down event; the one named `Pressed` is the click,
        // and so lands on release. The names are the wrong way round from what
        // you would guess, which is exactly why this is worth spelling out.
        events: LOGO_EVENTS,
        handlers: edges('logo', LOGO_EVENTS),
        connect: binary('logo', 'input.logoIsPressed()'),
        build: 'No wiring. Touch the gold logo on the front — it even works through a thin strip of foil taped over it.',
      },
      pinInput(0),
      pinInput(1),
      pinInput(2),
    ],
  },
  {
    id: 'motion',
    title: 'Tilt & direction',
    desc: 'How the board is angled or pointed, streamed as a live number every tick.',
    inputs: [
      {
        id: 'pitch', emoji: '📐', name: 'Pitch',
        kind: 'number',
        channels: ['pitch'],
        read: 'input.rotation(Rotation.Pitch)',
        loop: number('pitch', 'input.rotation(Rotation.Pitch)'),
        build: 'No wiring — strap the whole micro:bit (plus battery pack) to your object and tip it forward or back. Arrives in degrees. Great for steering.',
      },
      {
        id: 'roll', emoji: '📐', name: 'Roll',
        kind: 'number',
        channels: ['roll'],
        read: 'input.rotation(Rotation.Roll)',
        loop: number('roll', 'input.rotation(Rotation.Roll)'),
        build: 'No wiring — strap the whole micro:bit (plus battery pack) to your object and tip it left or right. Arrives in degrees. Great for steering.',
      },
      {
        id: 'heading', emoji: '🧭', name: 'Compass',
        kind: 'bearing',
        channels: ['heading'],
        // Reading the compass is what triggers calibration, and calibration
        // blocks until it's done. Left to the loop, that lands the moment you
        // connect — the app says connected and the board sits in the tilt game
        // instead of streaming, which reads as a broken connection. One throwaway
        // read up here spends it at power-on instead, while the board is still in
        // your hand. Once calibrated it returns instantly and shows nothing.
        //
        // Assigned rather than left as a bare call, because a reporter standing
        // alone as a statement is not a shape MakeCode can turn back into
        // blocks — it compiles, but it drops the whole program to JavaScript.
        setup: ['let calibrated = input.compassHeading()'],
        read: 'input.compassHeading()',
        loop: number('heading', 'input.compassHeading()'),
        build: 'No wiring — spin your object like a dial. On power-up it asks you to calibrate: tilt the board to fill the LED grid. Calibrate with the finished object assembled, battery and all — the reading is thrown off by whatever is attached, so a bare board calibrated on the bench will be wrong once it is inside your build. Expect to redo it after each download, and test in the room you will play in: laptops, speaker magnets and steel tables all pull it about. On the Controls page you pick which direction to watch for, and whether it fires on arrival or holds while pointing that way.',
      },
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures',
    desc: 'One-off moves — the board flags the instant each happens, so unlike the live inputs they add nothing to the Bluetooth load. Lean on these when you can.',
    inputs: [
      gesture('shake', 'Shake', 'Shake', '🫨',
        'No wiring — attach the board to anything shakeable. A maraca, a stuffed animal, a pool noodle.'),
      gesture('tiltleft', 'Tilt left', 'TiltLeft', '👈',
        'No wiring. Fires the moment the board tips past ~45° to the left — a quick flick, not a hold.'),
      gesture('tiltright', 'Tilt right', 'TiltRight', '👉',
        'No wiring. The mirror of tilt-left — pair the two to nudge something left/right.'),
      gesture('logoup', 'Logo up', 'LogoUp', '🙂',
        'No wiring. Board held UPRIGHT (LED display facing you), gold-logo edge at the top — the normal way to read it. Fires when it swings into that position.'),
      gesture('logodown', 'Logo down', 'LogoDown', '🙃',
        'No wiring. Still UPRIGHT and facing you, but turned 180° so the logo edge is now at the bottom. Fires when your object is flipped upside down.'),
      gesture('faceup', 'Face up', 'ScreenUp', '🔆',
        'No wiring. Board laid FLAT like on a table, LED display pointing up at the ceiling. Fires when it settles face-up.'),
      gesture('facedown', 'Face down', 'ScreenDown', '🌙',
        'No wiring. Board laid FLAT the other way, LED display pointing down at the floor. Fires when it settles face-down.'),
      gesture('freefall', 'Free fall', 'FreeFall', '🪂',
        'No wiring. Fires the instant the board is in the air — toss it up (and catch it!) or drop it onto a cushion.'),
      gesture('g3', 'Small bump', 'ThreeG', '💥',
        'No wiring. Fires on a light knock (3g) — a gentle tap or bump of your object.'),
      gesture('g6', 'Hard hit', 'SixG', '💥',
        'No wiring. Fires on a firm whack (6g) — a solid smack or a real shake.'),
      gesture('g8', 'Big slam', 'EightG', '💥',
        'No wiring. Fires only on a big impact (8g) — a hard slam. Use for a “power move”.'),
      {
        // Lives with the gestures because it costs what they cost: one line
        // when it happens, nothing otherwise. The alternative, counting peaks
        // off the streamed sound level, misses claps shorter than the 100 ms
        // between samples — which is most of them.
        id: 'loud', emoji: '👏', name: 'Loud sound',
        kind: 'event',
        channels: ['loud'],
        event: 'input.onSound(DetectedSound.Loud, function () {',
        handlers: handler('input.onSound(DetectedSound.Loud, function () {', ['send("loud:1")']),
        build: 'No wiring. Fires once per clap, shout or bang — the mic is next to the touch logo. Count them in a script (see Code it on Controls) to make every third clap do something.',
      },
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient sensing',
    desc: 'What the board senses about its surroundings, each a live number.',
    inputs: [
      {
        id: 'light', emoji: '💡', name: 'Light',
        kind: 'number',
        channels: ['light'],
        read: 'input.lightLevel()',
        loop: number('light', 'input.lightLevel()'),
        build: 'No wiring. Cover and uncover the LED grid with your hand, or shine a flashlight on it. Sends 0–255.',
      },
      {
        id: 'temp', emoji: '🌡️', name: 'Temperature',
        kind: 'number',
        channels: ['temp'],
        read: 'input.temperature()',
        loop: number('temp', 'input.temperature()'),
        build: 'No wiring. Warm the processor with your thumbs — it responds slowly, which makes for hilarious controls.',
      },
      {
        id: 'mic', emoji: '🎤', name: 'Sound',
        kind: 'number',
        channels: ['mic'],
        read: 'input.soundLevel()',
        loop: number('mic', 'input.soundLevel()'),
        build: 'No wiring. Clap, yell, blow, sing — loudness arrives as 0–255. The mic is next to the touch logo.',
      },
    ],
  },
];

// Flat list of every input, for code/steps generation (order = section order).
export const INPUTS = SECTIONS.flatMap((s) => s.inputs);

// --- Code + steps generation ------------------------------------------------

/** Resolve an input to its active variant (pins depend on the chosen mode). */
function variantOf(input, pinModes) {
  return input.modes ? input.modes[pinModes[input.id]] : input;
}

/**
 * What a build asks of the micro:bit's radio, split by the shape of it.
 *
 * `streamed` is a line per channel per 100 ms tick, for as long as the board is
 * on: the steady load, and what the caps below are really about. `pressed` is a
 * line per change — a button sends one going down and one coming up, and
 * nothing at all while it sits still, and a scanned switch is the same — so a
 * couple of them cost nothing next to a live reading, and a wall of them all
 * being mashed at once is another matter. A gesture is in neither: it fires the
 * once, when it happens.
 *
 * `weight` is the two put on one scale, which is what the warning is graded on.
 */
export function streamLoad(parts) {
  let streamed = 0;
  let pressed = 0;
  for (const v of parts) {
    if (!v || v.kind === 'event') continue;
    const n = v.channels?.length ?? 0;
    if (v.loop) streamed += n;
    else if (v.handlers || v.scan) pressed += n;
  }
  // A contact worked as hard as a person can work one is worth roughly a third
  // of a reading polled ten times a second. Rounded up, so a controller made
  // entirely of buttons still eventually earns the warning.
  return { streamed, pressed, weight: streamed + Math.ceil(pressed / 3) };
}

/** The input with this id, or null. */
export function inputById(id) {
  return INPUTS.find((input) => input.id === id) ?? null;
}

/**
 * The variant of an input that `assemble` wants: for a pin, the chosen mode;
 * for anything else, the input itself. Null when the pin has no such mode.
 */
export function variantFor(id, mode = null) {
  const input = inputById(id);
  if (!input) return null;
  if (!input.modes) return input;
  return input.modes[mode] ?? null;
}

/**
 * A complete program from a list of parts.
 *
 * Each part is an input variant (see the field list above `describe`), or
 * anything with the same fields: the sentences on Controls contribute parts
 * too, with their own `state`, `handlers` and `loop` lines. `extra` is lines
 * appended after everything else — code somebody wrote by hand.
 */
export function assemble(parts, { extra = [] } = {}) {
  const handlers = [];
  const setup = [];
  const loop = [];
  const scan = [];
  const state = [];
  const prime = [];
  const report = [];
  for (const v of parts) {
    if (!v) continue;
    if (v.handlers) handlers.push(...v.handlers);
    if (v.setup) setup.push(...v.setup);
    if (v.loop) loop.push(...v.loop);
    if (v.scan) scan.push(...v.scan);
    if (v.state) state.push(...v.state);
    if (v.prime) prime.push(...v.prime);
    if (v.connect) report.push(...v.connect);
  }

  // Every switch shares one scan loop, so every one of them is read by the
  // same fiber. That matters beyond tidiness: the radio's transmit buffer is
  // sixty bytes, and a line that does not fit is written in two halves with a
  // wait in between, during which another fiber's line can land in the gap —
  // "p0:1" inside "pitch:-42" is a reading for a channel that does not exist.
  // The fewer fibers writing at once, the less chance of the buffer ever being
  // that full.
  const scanLoop = scan.length
    ? [`loops.everyInterval(${SCAN_MS}, function () {`, ...scan.map((l) => '    ' + l), '})']
    : [];

  return [
    ...scaffoldTop({ state, prime, report }),
    ...handlers,
    // Last before the loop: a setup line may block for as long as it takes
    // someone to finish calibrating, so everything that has to be listening by
    // then is already registered above.
    ...setup,
    // Shown once, at startup, rather than from inside the loop. `showString`
    // *blocks* for the length of the scroll — about two seconds for a five
    // letter name — so in the loop it would drop the board to one reading
    // every two seconds. The name is only wanted while you are looking at the
    // Bluetooth chooser anyway.
    'basic.showString(control.deviceName())',
    ...scanLoop,
    'basic.forever(function () {',
    // No `if (connected)` here either, for the same reason it left the handlers:
    // `send` already knows what to do.
    ...loop.map((l) => '    ' + l),
    '    basic.pause(100)',
    '})',
    ...extra,
  ].join('\n');
}

/** The program for a set of input ids, with a mode per pin. */
export function generateCode(selected, pinModes = {}) {
  return assemble(INPUTS.filter((input) => selected.has(input.id)).map((input) => variantOf(input, pinModes)));
}

// --- Radio budget --------------------------------------------------------------

// Soft caps on `streamLoad().weight` before the BLE UART starts to lag.
//
// Every line is its own indication, and the board waits for the browser to
// confirm each one before the next goes out (MicroBitUARTService::send), so the
// radio moves roughly one line per connection interval — somewhere between
// thirty and sixty lines a second depending on the laptop. Five readings polled
// ten times a second is that whole budget with nothing left for a press. These
// are set low enough to warn before anybody notices rather than after; tune
// them down if a build inside them still feels late.
export const STREAM_BUSY = 3; // gentle heads-up
export const STREAM_HEAVY = 5; // stronger warning

/** The words for a load, for a warning on whichever screen is building a program. */
export function describeLoad({ streamed, pressed, weight }) {
  if (weight < STREAM_BUSY) return null;
  const parts = [];
  if (streamed) parts.push(`${streamed} live reading${streamed > 1 ? 's' : ''} streaming ten times a second`);
  if (pressed) parts.push(`${pressed} on/off input${pressed > 1 ? 's' : ''} reporting every press and release`);
  const load = parts.join(' and ');
  return weight >= STREAM_HEAVY
    ? { level: 'heavy', text: `You have ${load}. That's more than the micro:bit's Bluetooth can carry — expect the game to feel laggy or jerky, and presses to arrive late. Drop what you aren't using; gestures and loud sounds are free.` }
    : { level: 'busy', text: `You have ${load}. Fine so far — but stacking on many more will start to lag over Bluetooth. Gestures and loud sounds are free.` };
}
