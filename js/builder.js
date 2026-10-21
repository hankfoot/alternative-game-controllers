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
// tick. `state` is the top-level variables the scan loop keeps between ticks.
//
// `send` is the one place a line is written, so nothing else in this file needs
// to know whether anybody is listening. A named function with a typed parameter
// still decompiles to blocks, so the promise at the top of this file survives —
// that is the only reason `send` can exist rather than every call site carrying
// the guard.
function scaffoldTop({ state, report }) {
  const connect = [];
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
    // The face on the LEDs: whether something is being counted down (and
    // nothing else may draw), and whether the smiley is already up.
    'let busy = true',
    'let faceShown = false',
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
    // The smiley is the face loop's to draw (see `faceLoop`), so the two
    // never draw over each other.
    '    faceShown = false',
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

// How often the loop reads its live inputs. Forty milliseconds — twenty-five
// times a second — rather than the hundred it was. At ten readings a second a
// tilt waited fifty milliseconds on average just to be noticed, and the game
// then had to smooth so hard to hide the steps that it felt like steering
// through syrup. The radio can afford it because a reading is only sent when
// it changes (see `reading`), and because `send` blocks until the line is
// acknowledged, so a loop that asks for more than the link can carry simply
// runs at the link's pace, always sending the newest value, never a backlog.
export const POLL_MS = 40;

// A reading that has not changed is still sent this many ticks after the last
// one went out — about every half second — so the browser can tell a board
// that is holding still from one that has gone quiet.
export const KEEPALIVE_TICKS = 12;

/**
 * A live number: read every tick into `<channel>Now`, and sent as
 * "<channel>:<n>" when it differs from the last value sent, or when it has
 * been a while. Tilt and sound change on nearly every tick in a hand; light in
 * a still room and temperature hardly ever do, and cost the radio nothing
 * until they move.
 */
export function reading(channel, expr) {
  const now = `${channel}Now`;
  const last = `${channel}Last`;
  const age = `${channel}Age`;
  return {
    read: expr,
    // Starts past the keepalive, so the first tick reports whatever it finds.
    state: [`let ${now} = 0`, `let ${last} = 0`, `let ${age} = ${KEEPALIVE_TICKS}`],
    loop: [
      `${now} = ${expr}`,
      `${age} += 1`,
      `if (${now} != ${last} || ${age} >= ${KEEPALIVE_TICKS}) {`,
      `    ${last} = ${now}`,
      `    ${age} = 0`,
      `    send("${channel}:" + ${now})`,
      `}`,
    ],
  };
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
 *   calibrate — lines run once at startup
 *   recalibrate — lines run when A and B are pressed together, to teach a
 *              touch pad what untouched feels like again
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
        label: 'Touch pad (capacitive)',
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
        // Setting the mode is also when the pad calibrates: it takes the
        // highest of ten readings as "untouched" and fires a little above that
        // (TouchButton::calibrate), all within a few milliseconds. So it
        // happens at startup — and again whenever A and B are pressed together,
        // for a pad that was built, moved or caught mid-settle after that. It used to wait for the first browser to
        // connect, which meant a pad did nothing at all until then, and a test
        // without the page connected read the pin in the wrong mode entirely.
        calibrate: [`pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Capacitive)`],
        // Learning "untouched" again, on demand. The pad calibrates once, from
        // ten readings, when it is switched into capacitive mode — and a foil
        // square on a lead can be caught mid-settle and learn a level too low,
        // after which every reading is a touch and the pad sticks on. Setting
        // the mode it is already in does nothing, so it is switched away and
        // back, which builds a fresh sensor that calibrates again. A pad that
        // was stuck on never sends its release, so one is raised by hand: the
        // UP handler then tells the page, and lets go of anything the pad was
        // holding in the game.
        recalibrate: [
          `pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Resistive)`,
          `pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Capacitive)`,
          `control.raiseEvent(EventBusSource.MICROBIT_ID_IO_P${n}, EventBusValue.MICROBIT_BUTTON_EVT_UP)`,
        ],
        events: buttonEvents(`MICROBIT_ID_IO_P${n}`),
        handlers: buttonEdges(ch, `MICROBIT_ID_IO_P${n}`),
        connect: binary(ch, `input.pinIsPressed(TouchPin.P${n})`),
        build:
          `Clip a piece of foil to pin P${n}. Keep your hands off it while the micro:bit starts. If it stays on after you let go, press <strong>A and B together</strong> to reset it.`,
      },
      resistive: {
        label: 'Touch pad (resistive)',
        kind: 'binary', form: 'pad',
        channels: [ch],
        // The classic micro:bit touch: the pin rests high on a very weak
        // pull-up (10 MΩ on the board itself), and a person holding GND who
        // touches the pin's foil drags it low through their body. Setting the
        // mode hands the pin to the runtime's button driver, which smooths the
        // flicker a hand makes and raises the same DOWN and UP events as a
        // button — so it reports exactly like one. Nothing to calibrate.
        setup: [`pins.touchSetMode(TouchTarget.P${n}, TouchTargetMode.Resistive)`],
        events: buttonEvents(`MICROBIT_ID_IO_P${n}`),
        handlers: buttonEdges(ch, `MICROBIT_ID_IO_P${n}`),
        connect: binary(ch, `input.pinIsPressed(TouchPin.P${n})`),
        build:
          `Clip a piece of foil, or a banana, to pin P${n}. Clip another piece of foil to the GND pin and hold it while you touch the first one.`,
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
          `Clip one piece of foil to pin P${n} and another to the 3V pin. Mount them so they touch when your controller is used, like the jaws of a puppet or a door closing.`,
      },
      analog: {
        label: 'Analog',
        kind: 'number', form: 'analog',
        channels: [ch],
        // A voltage, read as 0–1023, sent whenever it changes. A strip of pencil
        // graphite between 3V and GND, with the pin on a clip you slide along
        // it, makes a potentiometer out of a drawing.
        ...reading(ch, `pins.analogReadPin(AnalogPin.P${n})`),
        build:
          `Pin P${n} reads a number from 0 to 1023, depending on how much electricity reaches it. Draw a thick pencil line, clip 3V to one end and GND to the other, and slide a clip from P${n} along the line.`,
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
        build: 'Press the A button. You can also tape on a lever or a flap that presses it for you.',
      },
      {
        id: 'btnb', emoji: '🔘', name: 'Button B',
        kind: 'binary', form: 'button',
        channels: ['btnb'],
        events: buttonEvents('MICROBIT_ID_BUTTON_B'),
        handlers: buttonEdges('btnb', 'MICROBIT_ID_BUTTON_B'),
        connect: binary('btnb', 'input.buttonIsPressed(Button.B)'),
        build: 'Press the B button. You can also tape on a lever or a flap that presses it for you.',
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
        build: 'Touch the gold logo on the front of the micro:bit. It works through a thin strip of foil or tape too.',
      },
      pinInput(0),
      pinInput(1),
      pinInput(2),
    ],
  },
  {
    id: 'motion',
    title: 'Tilt & direction',
    desc: 'How the board is angled or pointed, and how hard it is moving, streamed as a live number whenever it changes.',
    inputs: [
      {
        id: 'pitch', emoji: '📐', name: 'Pitch',
        kind: 'number',
        channels: ['pitch'],
        ...reading('pitch', 'input.rotation(Rotation.Pitch)'),
        build: 'Attach the micro:bit and its battery to your object, then tip it forward and back.',
      },
      {
        id: 'roll', emoji: '📐', name: 'Roll',
        kind: 'number',
        channels: ['roll'],
        ...reading('roll', 'input.rotation(Rotation.Roll)'),
        build: 'Attach the micro:bit and its battery to your object, then tip it from side to side.',
      },
      // How hard the board is moving, as opposed to how it is held. Pitch and
      // roll are steady while the board sits still at an angle; these jump
      // when it is swung, punched or stamped, and settle back. Thousandths of
      // g, so sitting still reads about 1000 on the strength and on whichever
      // axis points down.
      {
        id: 'accel', emoji: '🚀', name: 'Acceleration (strength)',
        kind: 'number',
        channels: ['accel'],
        ...reading('accel', 'input.acceleration(Dimension.Strength)'),
        build: 'Attach the micro:bit to something you swing or stamp. The number sits near 1000 at rest and jumps with every jolt.',
      },
      {
        id: 'accelx', emoji: '↔️', name: 'Acceleration X',
        kind: 'number',
        channels: ['accelx'],
        ...reading('accelx', 'input.acceleration(Dimension.X)'),
        build: 'Jerk the micro:bit left and right, along the row of pins.',
      },
      {
        id: 'accely', emoji: '↕️', name: 'Acceleration Y',
        kind: 'number',
        channels: ['accely'],
        ...reading('accely', 'input.acceleration(Dimension.Y)'),
        build: 'Jerk the micro:bit up and down, from the logo towards the pins.',
      },
      {
        id: 'accelz', emoji: '🔃', name: 'Acceleration Z',
        kind: 'number',
        channels: ['accelz'],
        ...reading('accelz', 'input.acceleration(Dimension.Z)'),
        build: 'Jerk the micro:bit towards you and away, straight through the LED display.',
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
        ...reading('heading', 'input.compassHeading()'),
        build: 'Attach the micro:bit to your object and turn it like a dial. When it starts, tilt it until every light is on to calibrate the compass, and do this once your controller is fully built. Keep it away from laptops and speakers, which have magnets inside.',
      },
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures',
    desc: 'One-off moves — the board flags the instant each happens, so unlike the live inputs they add nothing to the Bluetooth load. Lean on these when you can.',
    inputs: [
      gesture('shake', 'Shake', 'Shake', '🫨',
        'Attach the micro:bit to something you can shake, like a maraca or a stuffed animal.'),
      gesture('tiltleft', 'Tilt left', 'TiltLeft', '👈',
        'Happens once each time the micro:bit tips quickly to the left.'),
      gesture('tiltright', 'Tilt right', 'TiltRight', '👉',
        'Happens once each time the micro:bit tips quickly to the right.'),
      gesture('logoup', 'Logo up', 'LogoUp', '🙂',
        'Happens when the micro:bit is held upright with the gold logo at the top.'),
      gesture('logodown', 'Logo down', 'LogoDown', '🙃',
        'Happens when the micro:bit is turned upside down, with the gold logo at the bottom.'),
      gesture('faceup', 'Face up', 'ScreenUp', '🔆',
        'Happens when the micro:bit is laid flat with its lights facing up.'),
      gesture('facedown', 'Face down', 'ScreenDown', '🌙',
        'Happens when the micro:bit is laid flat with its lights facing down.'),
      gesture('freefall', 'Free fall', 'FreeFall', '🪂',
        'Happens when the micro:bit is dropped or tossed. Catch it, or drop it onto something soft.'),
      gesture('g3', 'Small bump', 'ThreeG', '💥',
        'Happens when the micro:bit gets a gentle bump or tap.'),
      gesture('g6', 'Hard hit', 'SixG', '💥',
        'Happens when the micro:bit gets a firm knock.'),
      gesture('g8', 'Big slam', 'EightG', '💥',
        'Happens only when the micro:bit gets a hard slam.'),
      {
        // Lives with the gestures because it costs what they cost: one line
        // when it happens, nothing otherwise. The alternative, counting peaks
        // off the streamed sound level, misses claps shorter than the gap
        // between samples — which is many of them.
        id: 'loud', emoji: '👏', name: 'Loud sound',
        kind: 'event',
        channels: ['loud'],
        event: 'input.onSound(DetectedSound.Loud, function () {',
        handlers: handler('input.onSound(DetectedSound.Loud, function () {', ['send("loud:1")']),
        build: 'Happens once each time the microphone hears a clap or a shout. The microphone is next to the gold logo.',
      },
      {
        // The other half of the same detector: it fires once when the room
        // has gone quiet after being loud. A pause in the music, a held breath.
        id: 'quiet', emoji: '🤫', name: 'Quiet',
        kind: 'event',
        channels: ['quiet'],
        event: 'input.onSound(DetectedSound.Quiet, function () {',
        handlers: handler('input.onSound(DetectedSound.Quiet, function () {', ['send("quiet:1")']),
        build: 'Happens once each time the room goes quiet after being noisy. Make a noise, then stop.',
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
        ...reading('light', 'input.lightLevel()'),
        build: 'Cover the lights on the front with your hand, or shine a light on them. The number goes from 0 in the dark to 255 in bright light.',
      },
      {
        id: 'temp', emoji: '🌡️', name: 'Temperature',
        kind: 'number',
        channels: ['temp'],
        ...reading('temp', 'input.temperature()'),
        build: 'Warm the micro:bit between your thumbs. The temperature changes slowly.',
      },
      {
        id: 'mic', emoji: '🎤', name: 'Sound',
        kind: 'number',
        channels: ['mic'],
        ...reading('mic', 'input.soundLevel()'),
        build: 'Talk, clap, or blow near the microphone, which is next to the gold logo. The number goes from 0 when it is quiet to 255 when it is loud.',
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
 * `streamed` is a channel read every POLL_MS and sent whenever it changes — up
 * to twenty-five lines a second while it moves, and a tilt in a hand moves on
 * nearly every tick: the steady load, and what the caps below are really about. `pressed` is a
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
  // of a reading that is moving. Rounded up, so a controller made
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

// The one thing that draws on the LEDs, so nothing draws over anything
// else. Not connected: an X for a second, a Bluetooth rune for a second, then
// the board's five-letter name — "waiting to pair", and which board to pick in
// the Bluetooth list. Connected: a smiley, drawn once rather than every time
// round — redrawing all 25 LEDs for a picture that never changes is work on
// the processor that keeps the radio fed. Its own loop, so the pauses in the
// animation never hold up a reading.
//
// `busy` is for programs where something else sometimes needs the LEDs (a
// touch pad relearning); the Setup starter has nothing of the kind.
function faceLoopLines({ busy }) {
  const idle = busy ? '!(connected) && !(busy)' : '!(connected)';
  return [
    'basic.forever(function () {',
    ...(busy ? ['    if (busy) {', '        basic.pause(100)', '    } else if (connected) {'] : ['    if (connected) {']),
    '        if (!(faceShown)) {',
    '            faceShown = true',
    '            basic.showIcon(IconNames.Happy)',
    '        }',
    '        basic.pause(100)',
    '    } else {',
    '        basic.showIcon(IconNames.No)',
    // A full second each, timed here rather than left to the blocks' own
    // display time: on a real board that came out at half what it should
    // have. Checked between, so a connection mid-way goes to the smiley —
    // except during the name, which cannot be stopped once it is scrolling.
    '        basic.pause(1000)',
    `        if (${idle}) {`,
    '            basic.showLeds(`',
    '                . . # # .',
    '                # . # . #',
    '                . # # # .',
    '                # . # . #',
    '                . . # # .',
    '                `)',
    '            basic.pause(1000)',
    '        }',
    `        if (${idle}) {`,
    // Cleared first, so the name scrolls in from a dark screen rather than
    // sliding in beside the Bluetooth sign still lit from the step before.
    '            basic.clearScreen()',
    '            basic.showString(control.deviceName())',
    '        }',
    '    }',
    '})',
  ];
}

/**
 * The program on the Setup screen: Bluetooth on, and the board's face — the
 * X, the Bluetooth sign and its name until it pairs, a smiley once it has —
 * and nothing else. It is what proves a board, a browser and a person can
 * find each other before any sensing starts.
 */
export function starterCode() {
  return [
    'bluetooth.startUartService()',
    'let connected = false',
    'let faceShown = false',
    'bluetooth.onBluetoothConnected(function () {',
    '    connected = true',
    '    faceShown = false',
    '})',
    'bluetooth.onBluetoothDisconnected(function () {',
    '    connected = false',
    '})',
    ...faceLoopLines({ busy: false }),
  ].join('\n');
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
  const calibrate = [];
  const recalibrate = [];
  const report = [];
  for (const v of parts) {
    if (!v) continue;
    if (v.handlers) handlers.push(...v.handlers);
    if (v.setup) setup.push(...v.setup);
    if (v.loop) loop.push(...v.loop);
    if (v.scan) scan.push(...v.scan);
    if (v.state) state.push(...v.state);
    if (v.calibrate) calibrate.push(...v.calibrate);
    if (v.recalibrate) recalibrate.push(...v.recalibrate);
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

  // A and B together, because neither alone is free: either may be an input
  // a sentence uses. Calibrating takes milliseconds — the fingers are on the
  // buttons, not the foil — so all there is to see is a tick, held a second,
  // to say it happened, before the face comes back.
  const recalibration = recalibrate.length
    ? handler('input.onButtonPressed(Button.AB, function () {', [
      'busy = true',
      ...recalibrate,
      'basic.showIcon(IconNames.Yes)',
      'basic.pause(1000)',
      'faceShown = false',
      'busy = false',
    ])
    : [];

  const faceLoop = faceLoopLines({ busy: true });


  return [
    ...scaffoldTop({ state, report }),
    ...handlers,
    ...recalibration,
    // Last before the loop: a setup line may block for as long as it takes
    // someone to finish calibrating, so everything that has to be listening by
    // then is already registered above.
    ...setup,
    // Startup: the touch pads learn "untouched" — ten readings, done within
    // the first few milliseconds, and nobody is touching the foil the moment
    // the board powers on — and the face loop takes over the LEDs.
    ...calibrate,
    'busy = false',
    ...faceLoop,
    ...scanLoop,
    'basic.forever(function () {',
    // No `if (connected)` here either, for the same reason it left the handlers:
    // `send` already knows what to do.
    ...loop.map((l) => '    ' + l),
    `    basic.pause(${POLL_MS})`,
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
// thirty and sixty lines a second depending on the laptop. Two tilt readings
// moving together at twenty-five a second is most of that budget; four is past
// it, and the loop falls to the radio's pace with nothing left for a press.
// These are set low enough to warn before anybody notices rather than after;
// tune them down if a build inside them still feels late.
export const STREAM_BUSY = 2; // gentle heads-up
export const STREAM_HEAVY = 4; // stronger warning

/** The words for a load, for a warning on whichever screen is building a program. */
export function describeLoad({ streamed, pressed, weight }) {
  if (weight < STREAM_BUSY) return null;
  const parts = [];
  if (streamed) parts.push(`${streamed} live reading${streamed > 1 ? 's' : ''} streaming up to twenty-five times a second`);
  if (pressed) parts.push(`${pressed} on/off input${pressed > 1 ? 's' : ''} reporting every press and release`);
  const load = parts.join(' and ');
  return weight >= STREAM_HEAVY
    ? { level: 'heavy', text: `You have ${load}. That's more than the micro:bit's Bluetooth can carry — expect the game to feel laggy or jerky, and presses to arrive late. Drop what you aren't using; gestures and loud sounds are free.` }
    : { level: 'busy', text: `You have ${load}. Fine so far — but stacking on many more will start to lag over Bluetooth. Gestures and loud sounds are free.` };
}
