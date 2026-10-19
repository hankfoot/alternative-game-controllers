# Game Controller Workshop

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

## Wiring inputs to the game

The Controls page contains a visual patch bay. Choose or drag an input onto a compatible game port,
then tune its threshold, range, direction, cooldown, or smoothing. Buttons and gestures work as
triggers; sensor readings can drive the craft's position and how hard it climbs. How fast the
world runs is a choice rather than a control, and lives on the Design page. Wiring is saved in
browser storage and survives a refresh.

On wide screens the wiring workbench and game sit side-by-side so changes can be tested
immediately. When that pair cannot fit comfortably, the game stacks beneath the workbench.

## Driving the game from the board ("Code it")

Below the patch bay, the Controls page has a box for a sentence — "flap every third clap",
"the height of my chair steers the craft" — and a button that copies it together with
instructions for an LLM. The LLM writes MakeCode code; the person pastes it at the bottom of
their MakeCode program and downloads it. Nothing pasted is ever run in the browser.

The generated program always carries four helpers, which are the game's API on the wire:

| Helper | Line sent | Effect |
| --- | --- | --- |
| `gamePress("flap")` | `game:press:flap` | fires a press control |
| `gameHold("thrust", true)` | `game:hold:thrust:1` | holds a hold control (`:0` lets go) |
| `gameSet("paddle", 0.5)` | `game:set:paddle:0.5` | sets a level control, 0 to 1 |
| `gameStart()` | `game:start` | starts a round, or retries after a crash |

Control names are the scheme's ports by friendly name (`flap`, `thrust`, `up`/`down`, `paddle`,
`shift`, `advance`). The browser routes commands straight to the game ([js/game-commands.js](js/game-commands.js)),
shows them in a log, and lets go of every held control when the board disconnects. The same
facade sits on `window.workshop.game` for trying a control from the devtools console.

## Code structure

- `index.html` contains the six accessible page panels — Home, Setup, Sensing, Controls, Design,
  Game — and the static workshop content.
- `styles.css` contains the complete responsive design.
- `js/main.js` builds everything and wires it together; `js/tabs.js` runs the page panels.
- `js/builder.js` generates MakeCode and controller-building guidance.
- `js/channels.js` holds friendly metadata for known wire-protocol channels.
- `js/signal-store.js` owns discovered, planned, and wired input state.
- `js/wiring-*.js` separate wiring configuration, runtime math, persistence, coordination, and UI.
- `js/games/` contains testable game rules: `base.js` is shared scaffolding, `sidescroller.js` is
  the game and its control schemes, and `index.js` is the registry the rest of the app reads.
- `js/game.js` connects those rules to the DOM/canvas; `js/game-warning.js` works out what is still
  missing between a controller and a playable game.
- `js/game-facade.js` names the game's ports for code; `js/game-commands.js` routes the board's
  `game:` lines through it; `js/code-prompt.js` writes the instructions for an LLM; `js/code-ui.js`
  binds the Code it section.
- `js/design.js` is the Design screen — course settings plus the look and sound of the game.
- `js/theme/` is that look-and-sound layer: drawing, sound, storage, and scene rendering.
- `js/bluetooth.js`, `js/bus.js`, and `js/visualizer.js` handle the input pipeline.
- `test/` covers wiring migration, persistence, protocol parsing, game rules, themes
  (`test/theme.test.js`), and the game-readiness check (`test/game-warning.test.js`).

## Controller code builder

The Controller page generates complete MakeCode JavaScript from the selected inputs, including
per-input build tips. Inputs are grouped into touch/press, tilt/direction, gestures, and ambient
sensors. Buttons, touch pads, the logo and gestures report their DOWN and UP events the instant they
happen, so a press is never a tick late and a quick tap is never missed. A switch pin is different:
its raw edge events are undebounced and the event bus drops any beyond ten, so a switch is scanned
every 20 ms by one loop and reported only when its level changes. Touch pads calibrate on the first
Bluetooth connection rather than at boot, so the wire and foil are already clipped on when the pad
learns what "untouched" feels like. The readings that have no edges — tilt, compass, light, sound —
are polled by a loop every 100 ms, and the page warns when too many of those may overwhelm the
micro:bit's Bluetooth UART.
