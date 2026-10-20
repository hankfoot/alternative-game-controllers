// The instructions somebody pastes into an LLM before asking it for micro:bit
// code.
//
// Written out fresh every time rather than kept as a fixed document, because
// the one thing an LLM cannot know is what *this* controller is: which scheme
// the game is set to, so which control names exist, and which inputs the
// program already reads. Left to guess, it guesses `jump` and reconfigures a
// pin that is already a touch pad. So those are filled in from the same
// records the patch bay reads, and the examples use the names the helpers
// really take.
//
// Pure: given the inputs, the controls and the sentence, returns the text.

import { channelInfo } from './channels.js';

const VERB = {
  press: (name) => `gamePress("${name}")`,
  hold: (name) => `gameHold("${name}", true)`,
  level: (name) => `gameSet("${name}", 0.5)`,
};

function controlLine({ name, kind, description }) {
  if (name === 'advance') {
    return '- `advance` (press): starts a round, or retries after a crash. Call `gameStart()` for this — it is safe to call at any time.';
  }
  return `- \`${name}\` (${kind}): ${description} → \`${VERB[kind]?.(name) ?? name}\``;
}

/**
 * The inputs the program already reads, from the parts the sentences make
 * (see rulesParts in js/controls-codegen.js): each with the handler it owns,
 * if it owns one. MakeCode's Blocks view allows one handler per event: a
 * second `on loud sound` is shown as a disabled grey block and dropped from
 * the program, so an LLM that writes one for an event the program already
 * owns breaks the controller the moment somebody flips to Blocks.
 */
export function describeInputs(parts = []) {
  return parts.map((part) => {
    const channel = part.channels[0];
    return {
      channel,
      label: channelInfo(channel).label,
      mode: part.label ?? null,
      handler: (part.event ?? part.events?.down ?? null)?.replace(/, function \(\) \{$/, ', …)') ?? null,
    };
  });
}

function inputLine({ channel, label, mode, handler }) {
  const taken = handler ? ` — its \`${handler}\` handler is already in the program` : '';
  return `- \`${channel}\`: ${label}${mode ? ` as a ${mode}` : ''}${taken}`;
}

export function buildPrompt({ inputs = [], controls = [], schemeName = '', schemeTagline = '', request = '' } = {}) {
  const ask = request.trim();
  const inputLines = inputs.length
    ? inputs.map(inputLine)
    : ['- Nothing yet. You may set up any input you need.'];
  const controlLines = controls.length ? controls.map(controlLine) : ['- (no scheme selected)'];
  const scheme = schemeName ? ` (scheme: ${schemeName})` : '';

  return `# Writing micro:bit code for Alternative Game Controllers

You are helping someone program a BBC micro:bit V2 in MakeCode — the JavaScript editor at makecode.microbit.org — so that something they built controls a browser game. The micro:bit talks to the game over Bluetooth, and the program already on it does all of that. Your job is to add code that reads the sensors and calls four functions that are already defined in their program.

## The game functions already in their program

\`\`\`ts
gamePress("flap")          // fire a press control once
gameHold("thrust", true)   // hold a hold control down; gameHold("thrust", false) lets go
gameSet("paddle", 0.5)     // set a level control to a value from 0 to 1
gameStart()                // start a round, or retry after a crash
\`\`\`

Do not define these — they exist. Do not call \`send\`, \`serial\` or \`bluetooth\` yourself; the functions do the talking. A wrong control name is ignored by the game and shown in its log.

## The game controls${scheme}

${schemeTagline ? `${schemeTagline}\n\n` : ''}${controlLines.join('\n')}

## What the program already reads

${inputLines.join('\n')}

You may read the same sensors again, but do not change the mode or pull of a pin listed above. Any other pin is free.

MakeCode's Blocks view allows only one handler per event. Where a handler is named above, the program already has it: do not write another for the same event, or it will be dropped when they switch to Blocks. If the interaction needs that event, say so plainly instead of writing it — they can untick that input on the Sensing page and copy these instructions again.

## Writing MakeCode

- Write the MakeCode flavour of TypeScript that converts to blocks: \`let\` variables at the top level, \`function name () { }\`, \`if\`/\`else\`, \`for\`, \`while\`. No classes, arrow functions, ternaries, \`const\`, \`async\` or imports.
- Useful calls: \`input.onSound(DetectedSound.Loud, function () { })\` fires once per clap or shout; \`input.onGesture(Gesture.Shake, function () { })\`; \`input.rotation(Rotation.Pitch)\` and \`Rotation.Roll\` in degrees; \`input.acceleration(Dimension.X)\`; \`input.lightLevel()\` 0–255; \`input.soundLevel()\` 0–255; \`input.compassHeading()\`; \`pins.digitalReadPin(DigitalPin.P2)\`; \`pins.analogReadPin(AnalogPin.P2)\` 0–1023; \`loops.everyInterval(100, function () { })\`; \`basic.pause(ms)\`; \`Math.abs\`, \`Math.min\`, \`Math.max\`, \`Math.round\`.
- Buttons: \`input.onButtonPressed\` fires when the button is *released*. For the instant it goes down use \`control.onEvent(EventBusSource.MICROBIT_ID_BUTTON_A, EventBusValue.MICROBIT_BUTTON_EVT_DOWN, function () { })\`, and \`MICROBIT_BUTTON_EVT_UP\` for the release.
- Whatever calls \`gameHold(…, true)\` must have a matching path to \`gameHold(…, false)\`, or the control sticks.
- Do not draw on the LED display (\`basic.showIcon\`, \`showLeds\`, \`showNumber\`, \`showString\`, \`led.plot\`…) and do not use the A+B buttons: the program already uses the LEDs to show whether it is connected, and A+B to recalibrate touch pads.
- Read a level in \`loops.everyInterval(100, …)\` and call \`gameSet\` only when the value has moved by more than a little since the last call — Bluetooth carries about thirty lines a second in total, shared with everything else the board sends.
- Put every number the person might want to tweak in an UPPER_CASE \`let\` at the top, with a comment saying what it does.
- Declare every variable at the top level, above the handlers that use it.
- To show a reading of your own on the game's Controls page, \`send("name:" + value)\` with a lowercase name; it appears there as an input.
- Reply with one code block to paste at the very END of their program, below everything already there, then one or two sentences on what to tune.

## Example 1: flap every third clap

(Assumes the program does not already read \`loud\`.)

\`\`\`ts
// How many claps per flap
let EVERY = 3

let claps = 0
input.onSound(DetectedSound.Loud, function () {
    claps += 1
    if (claps % EVERY == 0) {
        gamePress("flap")
    }
})
\`\`\`

## Example 2: an office chair's height steers the craft

The micro:bit is strapped to a hinged arm resting on the seat, so pitch rises as the chair goes up. This assumes the "Steer directly" scheme, which has a \`paddle\` level control.

\`\`\`ts
// The pitch readings at the chair's lowest and highest positions
let LOW = -40
let HIGH = 30

let lastHeight = -1
loops.everyInterval(100, function () {
    let height = (input.rotation(Rotation.Pitch) - LOW) / (HIGH - LOW)
    height = Math.min(1, Math.max(0, height))
    if (Math.abs(height - lastHeight) > 0.02) {
        lastHeight = height
        gameSet("paddle", height)
    }
})
\`\`\`

## What they want

${ask || '(They will describe it in the next message.)'}

Write the code for that, following the rules above.
`;
}
