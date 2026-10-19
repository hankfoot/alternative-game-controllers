// The instructions somebody pastes into an LLM before asking it for a script.
//
// Written out fresh every time rather than kept as a fixed document, because
// the one thing an LLM cannot know is what *this* controller is: which channels
// this person enabled, what their numbers mean, and which scheme the game is
// set to. Left to guess, it guesses `button` and `jump`, and the script fails
// on names. So the inputs and the controls are filled in from the same records
// the patch bay reads, and the examples use the names the API really takes.
//
// Pure: given the inputs and controls, returns the text. Nothing in here knows
// what a document is.

// How often a reading of each kind arrives — the thing a script most needs to
// know and the thing nobody thinks to tell it.
const ARRIVES = {
  number: 'Arrives about ten times a second.',
  bearing: 'Arrives about ten times a second.',
  binary: 'Sent the moment it changes: 1 when pressed or closed, 0 when released.',
  event: 'Sent as a single 1 each time it happens, nothing in between.',
};

const KIND_WORD = { number: 'number', bearing: 'compass bearing', binary: 'on/off', event: 'event' };

/** The inputs worth telling an LLM about, from the signal store's records. */
export function describeInputs(signals = []) {
  return signals
    .filter((signal) => signal.planned || signal.live)
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.channel.localeCompare(b.channel))
    .map(({ channel, kind, min, max, unit, label, desc }) => ({
      channel, kind, min, max, unit: unit ?? '', label: label ?? channel, desc: desc ?? '',
    }));
}

function range({ kind, min, max, unit }) {
  if (kind === 'binary') return '0 or 1';
  if (kind === 'event') return '1';
  const suffix = unit ? ` ${unit}` : '';
  return `${min} to ${max}${suffix}`;
}

function inputLine(input) {
  const what = input.desc ? ` ${input.desc}` : '';
  return `- \`${input.channel}\` (${KIND_WORD[input.kind] ?? input.kind}, ${range(input)}):${what} ${ARRIVES[input.kind] ?? ARRIVES.number}`;
}

const VERB = {
  press: (name) => `game.press('${name}')`,
  hold: (name) => `game.hold('${name}', true)`,
  level: (name) => `game.set('${name}', 0.5)`,
};

function controlLine({ name, kind, description }) {
  if (name === 'advance') {
    return `- \`advance\` (press): starts a round, or retries after a crash. Call \`game.start()\` for this — it is safe to call at any time.`;
  }
  return `- \`${name}\` (${kind}): ${description} → \`${VERB[kind]?.(name) ?? name}\``;
}

export function buildPrompt({ inputs = [], controls = [], schemeName = '', schemeTagline = '' } = {}) {
  const inputLines = inputs.length
    ? inputs.map(inputLine)
    : ['- No inputs are enabled yet. Pick some on the Sensing page, or connect a board, then copy this again.'];
  const controlLines = controls.length
    ? controls.map(controlLine)
    : ['- (no scheme selected)'];
  const scheme = schemeName ? ` (scheme: ${schemeName})` : '';

  return `# Writing a script for the Game Controller Workshop

You are helping someone write a short JavaScript script for a browser game they control with a BBC micro:bit. The micro:bit streams sensor readings to the page, and the script turns those readings into game controls. The script is pasted into a box on the page, which runs it with two objects, \`inputs\` and \`game\`, described below. Nothing is installed and nothing is imported.

## Their inputs right now

Each reading is a number on a named channel. These are the channels this person has:

${inputLines.join('\n')}

## The game controls${scheme}

${schemeTagline ? `${schemeTagline}\n\n` : ''}${controlLines.join('\n')}

## The API

\`\`\`js
inputs.on(channel, (value, info) => { ... })      // every reading of that channel; '*' for all. info = { channel, kind, min, max }
inputs.onPress(channel, (value, info) => { ... }) // once per press of an on/off input, or once per event
inputs.value(channel)                             // the latest reading, or undefined if none has arrived
inputs.list()                                     // [{ channel, kind, min, max, live }]
inputs.publish(channel, number, { kind })         // invent a new input — it appears on the Controls page and can be wired like any other
game.press(name)                                  // fire a press control
game.hold(name, on)                               // hold a hold control down (true) or let go (false)
game.set(name, value)                             // set a level control, 0 to 1
game.start()                                      // start a round, or retry after a crash
game.phase()                                      // 'ready', 'playing' or 'over'
game.controls()                                   // the controls above, as data
setTimeout, setInterval, console.log              // all available; console output shows on the page
\`\`\`

A wrong channel or control name does not throw — it is written to the page's log and the call does nothing. Stop undoes everything the script set up: timers, listeners, held controls, published inputs.

## Rules

1. Plain JavaScript only. No \`import\`, \`require\`, \`fetch\`, \`document\`, \`window\` or \`localStorage\` — just \`inputs\`, \`game\`, timers, \`console\` and \`Math\`.
2. Write top-level code; do not wrap it in a function. \`await\` is allowed at the top level. The script keeps running for as long as something is listening with \`inputs.on\` or \`inputs.onPress\`.
3. Use only the channel names and control names listed above, spelled exactly as shown.
4. Put every number the person might want to tweak in an UPPER_CASE constant at the top, with a comment saying what it does.
5. Reply with one code block of at most about forty lines, then one or two sentences on what to tune.

## Example 1: flap every third clap

\`\`\`js
// How many claps per flap
const EVERY = 3

let claps = 0
inputs.onPress('loud', () => {
  claps += 1
  if (claps % EVERY === 0) game.press('flap')
})
\`\`\`

## Example 2: an office chair's height steers the craft

The micro:bit is strapped to a hinged arm resting on the seat, so \`pitch\` rises as the chair goes up. This assumes the "Steer directly" scheme, which has a \`paddle\` level control.

\`\`\`js
// The pitch readings at the chair's lowest and highest positions
const LOW = -40
const HIGH = 30

inputs.on('pitch', (pitch) => {
  const height = Math.min(1, Math.max(0, (pitch - LOW) / (HIGH - LOW)))
  game.set('paddle', height)
  // Also show it on the Controls page, as a 0–100 reading called "height"
  inputs.publish('height', Math.round(height * 100), { kind: 'number' })
})
\`\`\`

## If they would rather do it on the micro:bit

Any line of the form \`send("name:" + number)\` in the MakeCode program invents a channel called \`name\`; it shows up on the Controls page the first time it arrives, and can be wired like any other. So a count can live on the board instead — for example a handler that counts loud sounds and sends \`"clap3:1"\` on every third one — at the cost of re-flashing on every change.
`;
}
