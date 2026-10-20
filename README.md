# Alternative Game Controllers

A companion website for a workshop on unconventional controllers, originally designed by Avi Romanoff and Hank Duhaime.

Wire a real-world object to a **BBC micro:bit v2**, stream its sensors over **Web Bluetooth**,
and turn everyday objects into controllers for a browser game.

## How it works

1. On the **Sensing** page, choose inputs and copy the generated MakeCode.
2. Flash that code to a micro:bit using the walkthrough on the **Setup** page.
3. Open the site in desktop or Android Chrome/Edge and click **Connect**.
4. Open the Live-input control to test each signal.
5. Wire signals to controls on the **Controls** page, or have the board drive the game itself, and play on **Game**.

## Input protocol

The micro:bit sends one raw sensor reading per UART line:

```text
<channel>:<number>
```

| Example | Meaning |
| --- | --- |
| `btna:1` / `btna:0` | A binary button, touch pad, or switch. |
| `light:187` | A continuous raw sensor reading. |
| `pitch:-42` | The board's pitch angle in degrees. |
| `shake:1` | A one-off event sent when the gesture occurs. |

The browser decides what each channel controls, so remapping never requires reflashing. Any
channel name is valid. [js/channels.js](js/channels.js) supplies friendly metadata for known
channels; custom channels are discovered automatically.

## Run locally

The site has no runtime dependencies and no build step. Serve it over HTTP so browser modules and
Web Bluetooth use the same paths as GitHub Pages:

```sh
npm run dev
```

Then open <http://localhost:8000>. The included server uses only Node's standard library.

Run the Node test suite with:

```sh
npm test
```

With Nix installed, `nix develop path:.` provides Node.

## GitHub Pages

Configure Pages to **Deploy from a branch**, using the `main` branch and `/(root)`. GitHub serves
`index.html`, `styles.css`, `js/`, and `assets/` directly; no workflow, generated bundle, or
deployment branch is needed.

## The workshop, screen by screen

1. **Setup** — MakeCode, the starter project, flashing, and preparing foil and crocodile clips.
2. **Sensing** — four lessons, each a small program to download and a live view of what it sends:
   a touch pad (capacitive, one wire), a switch (two foils, pulled down and scanned), analog
   readings (pitch, light, and a voltage off a pencil line), and events (shake, loud sound).
   Every snippet is built by the same assembler as the controller's program, so the pin fixes
   are the same ones (`js/lessons.js`).
3. **Controls** — pick how the craft moves, then write sentences in dropdowns: *when Button A is
   pressed, flap*; *when light is below 100, hold thrust*; *pitch steers paddle between -40 and
   30*. A reading is drawn live under its sentence with the line it has to cross. The sentences
   become the MakeCode program for the board (`js/controls-codegen.js`), which streams every
   reading it uses and drives the game through the helpers below. Sentences are saved per scheme.
4. **Design** — the course, how the controls feel (flap strength, slide speed…), and the look and
   sound of the game.
5. **Game**.

## The game API on the wire

The generated program always carries four helpers, which are how any code on the board — the
sentences, or something an LLM wrote — drives the game:

| Helper | Line sent | Effect |
| --- | --- | --- |
| `gamePress("flap")` | `game:press:flap` | fires a press control |
| `gameHold("thrust", true)` | `game:hold:thrust:1` | holds a hold control (`:0` lets go) |
| `gameSet("paddle", 0.5)` | `game:set:paddle:0.5` | sets a level control, 0 to 1 |
| `gameStart()` | `game:start` | starts a round, or retries after a crash |

Control names are the scheme's ports by friendly name (`flap`, `thrust`, `up`/`down`, `paddle`,
`shift`, `advance`). The browser routes commands straight to the game (`js/game-commands.js`),
shows them in a log, and lets go of every held control when the board disconnects. The same
facade sits on `window.workshop.game` for trying a control from the devtools console. Nothing
pasted into the page is ever executed.

## Code it: vibecoding a controller

Below the sentences, Controls has a box for a sentence the dropdowns cannot say — "flap every
third clap" — and a button that copies it together with instructions for an LLM: the four
helpers, the controls of the picked scheme, the inputs the program already reads and the
handlers it already owns (MakeCode's Blocks view allows one per event), and MakeCode's
block-shaped dialect. The LLM writes MakeCode; the person pastes it at the bottom of the program
and downloads.

## Code structure

- `index.html` contains the six accessible page panels — Home, Setup, Sensing, Controls, Design,
  Game — and the static workshop content.
- `styles.css` contains the complete responsive design.
- `js/main.js` builds everything and wires it together; `js/tabs.js` runs the page panels.
- `js/builder.js` is the catalogue of inputs and the assembler that turns parts into a program;
  `js/lessons.js` makes the Sensing lessons from it, `js/controls-codegen.js` the sentences, and
  `js/controls-ui.js` and `js/rules-store.js` are the Controls screen and its storage.
- `js/channels.js` holds friendly metadata for known wire-protocol channels.
- `js/signal-store.js` owns discovered and planned input state; `js/game-options.js` the
  per-scheme choices the game declares on its controls and course.
- `js/games/` contains testable game rules: `base.js` is shared scaffolding, `sidescroller.js` is
  the game and its control schemes, and `index.js` is the registry the rest of the app reads.
- `js/game.js` connects those rules to the DOM/canvas; `js/game-warning.js` works out what is still
  missing between a controller and a playable game.
- `js/game-facade.js` names the game's ports for code; `js/game-commands.js` routes the board's
  `game:` lines through it; `js/code-prompt.js` writes the instructions for an LLM; `js/code-ui.js`
  binds the Code it section.
- `js/design.js` is the Design screen — course settings plus the look and sound of the game.
- `js/theme/` is that look-and-sound layer: drawing, sound, storage, and scene rendering.
- `js/bluetooth.js` is the one connection — Web Bluetooth to the micro:bit's UART; `js/line-protocol.js`
  turns its bytes into readings and game commands, `js/bus.js` hands them out, and `js/visualizer.js` draws them.
- `test/` covers wiring migration, persistence, protocol parsing, game rules, themes
  (`test/theme.test.js`), and the game-readiness check (`test/game-warning.test.js`).

## Generated programs

Every program the site writes — a lesson's snippet or a controller — shares one scaffold:
Bluetooth UART, a `send` that only writes while a browser is attached, the four game helpers, a
face on the LEDs (3-2-1 at startup, then a Bluetooth rune and an X a second each until it pairs,
and a smiley once it has; holding B scrolls the board's name), and a report of each held input's level 1.5 s after a browser connects (the UART service drops lines
written before the browser subscribes). Buttons, touch pads and the logo report DOWN and UP events
the instant they happen; switch pins are scanned every 20 ms because their raw edge events are
undebounced and the event bus drops any beyond ten; touch pads calibrate at startup, straight after
the 3-2-1 (hands off), and again whenever A and B are pressed together. Readings with no edges — tilt, compass, light, sound, analog
pins — are polled every 100 ms, and the page warns when too many of those may overwhelm the
Bluetooth UART.
