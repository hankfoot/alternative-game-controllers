// Entry point — wires the UI together.

import { onStatus, onInput } from './bus.js';
// One way to reach a board: Bluetooth, from the browser.
import { connect, disconnect, isSupported } from './bluetooth.js';
import { createChannelView, initVisualizer } from './visualizer.js';
import { initLessons } from './lessons.js';
import { starterCode } from './builder.js';
import { initGame } from './game.js';
import { initGameWarning } from './game-warning.js';
import { createSignalStore } from './signal-store.js';
import { initTabs } from './tabs.js';
import { initToc } from './toc.js';
import { initControlsUI } from './controls-ui.js';
import { createCommandBridge } from './game-commands.js';
import { initCodeUI } from './code-ui.js';
import { initDesign } from './design.js';
import { createGameOptions } from './game-options.js';
import { createThemeStore, browserStorage } from './theme/theme-store.js';
import { createAssetStore } from './theme/assets.js';
import { createImageCache, assetBytes } from './theme/images.js';
import { createAudio } from './theme/audio.js';
import { SOUND_FILES } from './theme/defaults.js';
import { designPromptCards, initPromptUI } from './theme/prompt-ui.js';
import { migrateStorage } from './storage-migrate.js';

// --- Tabs, and the sidebar that lists the screen -------------------------------
const toc = initToc({ host: document.getElementById('toc') });
initTabs({ onActivate: (panel) => toc?.show(panel) });

// How tall the sticky bar is, for everything that has to clear it: the sidebar
// sits under it, and a step scrolled to has to land below it rather than
// behind it. Its height changes when the tabs wrap onto their own row.
const topbar = document.querySelector('.topbar');
if (topbar) {
  // Rounded up: offsetHeight rounds a 107.5px bar down, and the home screen,
  // sized to exactly what is left under it, then overflowed by the half pixel.
  const measure = () => document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(topbar);
  measure();
}

// --- How the game looks and sounds ------------------------------------------
// Built before the game host, which reads the theme on every frame. The images
// a theme points at load asynchronously; until they arrive each one reads as
// null and the game draws its built-in art, so there is nothing to wait for.
const storage = browserStorage();
// Before anything reads a store. This works because no module reads storage at
// import time — every reader does it inside `init…`/`create…`, so a statement
// here is early enough. A future top-level `const saved = storage.getItem(…)`
// in any of them would break that silently, so it is worth keeping true.
migrateStorage(storage);
const themeStore = createThemeStore({ storage });
const assetStore = createAssetStore();
const images = createImageCache({ assets: assetStore });
const audio = createAudio({
  resolveUpload: async (id) => assetBytes(await assetStore.get(id)),
  builtIn: SOUND_FILES,
});
const look = { theme: () => themeStore.get(), images };
// The defaults are drawn or fetched once; the theme's own drawings load after.
// Neither is awaited here — the game redraws every frame and picks them up on
// its own. The Design cards do not, so they are told when this settles.
const drawingsReady = images.ready().then(() => images.warm(themeStore.get()));

// --- Shared controller state ------------------------------------------------
const signalStore = createSignalStore();
// The music belongs to the game, and plays only where the game is: not on the
// screen where you pick it, and not while the browser tab itself is away. It
// did play on Design for a while, on the theory that you would want to hear
// what you were choosing — but a track that starts itself the moment you set it
// and follows you around the screen is not a preview, it is a radio.
const gameHost = initGame({
  look,
  audio,
  musicWhen: () => document.visibilityState === 'visible'
    && !document.getElementById('panel-game')?.hidden,
});
// --- What the controls and the course are set to -----------------------------
const gameOptions = gameHost ? createGameOptions({ gameHost, storage }) : null;

// --- Game commands from the board ------------------------------------------
// The board steers the game with "game:…" lines its program writes through the
// helpers the builder emits — the sentences on Controls, or code by hand.
const bridge = gameHost ? createCommandBridge({ gameHost }) : null;
// The one deliberate global. Everything else in this app is module-local, and
// stays so; this is the same facade the board's commands go through, put where
// somebody with the console open can try `workshop.game.press('flap')` without
// a board in hand.
if (bridge) window.workshop = { game: bridge.game };

// --- Setup's starter program -----------------------------------------------
// Written from the generator rather than kept in the page, so the board's
// waiting screen on Setup is the same one every later program shows.
const setupCode = document.getElementById('setup-code');
if (setupCode) setupCode.textContent = starterCode();

// --- Sensing lessons ---------------------------------------------------------
// Rendered before the copy buttons below are bound, since each lesson has one.
initLessons({ host: document.getElementById('lesson-list'), signalStore });
// The sidebar read the screen before these existed, if Sensing was the first screen up.
toc?.refresh();

// --- Consumers -------------------------------------------------------------
initVisualizer(signalStore);
const controls = gameHost
  ? initControlsUI({
    elements: {
      list: document.getElementById('rule-list'),
      code: document.getElementById('controls-code'),
      warn: document.getElementById('controls-warning'),
      hookup: document.getElementById('controls-hookup'),
      tune: document.getElementById('rule-tune'),
    },
    gameHost,
    signalStore,
    storage,
    options: gameOptions,
  })
  : null;
if (bridge && controls) {
  initCodeUI({
    elements: {
      prompt: document.getElementById('code-prompt'),
      request: document.getElementById('code-request'),
      copy: document.getElementById('code-copy'),
      status: document.getElementById('code-status'),
      log: document.getElementById('code-log'),
    },
    bridge,
    controls,
    gameHost,
    storage,
  });
}
// --- The controller, live, under the game ------------------------------------
// The same view as the one in the top bar, behaving the same way: a row for
// each channel as it arrives, emptied on every new connection.
const gameLive = document.getElementById('game-live');
if (gameLive) createChannelView(gameLive, { signalStore, empty: gameLive.querySelector('.live-empty') });

if (controls) {
  initGameWarning({
    element: document.getElementById('game-warning'),
    host: gameHost,
    controls,
    bridge,
  });
}
if (gameOptions && controls) {
  const byId = (id) => document.getElementById(id);
  const design = initDesign({
    hosts: {
      settings: byId('design-settings'),
      sprites: byId('design-sprites'),
      sound: byId('design-sound'),
      text: byId('design-text'),
      share: byId('design-share'),
      shareNote: byId('theme-io-note'),
      exportBtn: byId('theme-export'),
      importFile: byId('theme-import-file'),
      preview: byId('design-preview'),
    },
    options: gameOptions,
    theme: themeStore,
    assets: assetStore,
    images,
    audio,
    storage,
    // Registered after the options' own listener, so by the time this runs
    // they already hold the new scheme's settings.
    onGameChange: (redraw) => gameHost.onGameChange(redraw),
    onGameSelected: (id) => gameHost.selectGame(id),
    // A redrawn sprite needs no announcement — the renderer reads the theme
    // every frame. This is for the music, which has to be told to change.
    onThemeApplied: () => gameHost.syncMusic(),
    // An imported bundle rewrites the sentences underneath the screen holding them.
    onRulesImported: () => controls.reload(),
  });
  drawingsReady.then(() => design?.refreshPreviews());
  // The AI prompts on Design, and bringing back what the AI made.
  initPromptUI({
    cards: designPromptCards(byId),
    storage,
    onImport: (files) => design.importFiles(files),
  });
}


// --- Copy buttons on code blocks -------------------------------------------
document.querySelectorAll('.code-copy').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    // A button in a fold's <summary> would open and close the fold on every
    // copy; it copies, and the fold stays as it was.
    e.preventDefault();
    const code = (btn.closest('.code-block') ?? btn.parentElement).querySelector('code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1400);
    } catch {
      /* clipboard blocked (e.g. non-secure context) — user can select manually */
    }
  });
});

// --- Browser support banner ------------------------------------------------
if (!isSupported()) {
  document.getElementById('unsupported-banner').hidden = false;
}

// --- Live visualizer popover ----------------------------------------------
const signalToggle = document.getElementById('signal-toggle');
const vizPop = document.getElementById('viz-pop');
const vizClose = document.getElementById('viz-close');

function openViz(open) {
  vizPop.hidden = !open;
  signalToggle.setAttribute('aria-expanded', String(open));
}

// The chip washes green as readings arrive. Generic on/off — it never reflects
// any specific channel, so many simultaneous streams can't make it thrash.
// `data-state` (set below) colours the dot; `data-active` runs the wash.
//
// A CSS animation only replays if the element leaves and re-enters the state
// that runs it, which is what the reflow below is for. The rate limit is why
// that is affordable, and it is also the point: readings arrive ten times a
// second, and restarting a half-second fade on every one of them would hold the
// chip at full green — which says "connected", not "receiving". Restarting it
// three times a second lets it visibly breathe.
let washedAt = -Infinity;
let washOff = null;

function blink() {
  const now = performance.now();
  if (now - washedAt < 320) return;
  washedAt = now;
  signalToggle.dataset.active = 'false';
  void signalToggle.offsetWidth;
  signalToggle.dataset.active = 'true';
  clearTimeout(washOff);
  washOff = setTimeout(() => { signalToggle.dataset.active = 'false'; }, 520);
}

signalToggle.addEventListener('click', () => openViz(vizPop.hidden));
vizClose.addEventListener('click', () => openViz(false));

// Close on Escape or a click outside the popover (but not on the toggle).
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openViz(false); });
document.addEventListener('click', (e) => {
  if (vizPop.hidden) return;
  if (vizPop.contains(e.target) || signalToggle.contains(e.target)) return;
  openViz(false);
});

// --- Connection button + status --------------------------------------------
// The top bar always shows the live-input toggle, labelled with the connection
// state ("Not Connected" → the board's own name). Connect and Disconnect swap
// places beside it, and both stay in the bar: needing to unplug is what happens
// when something has gone wrong, and that is the worst possible moment for the
// control to be hidden inside a popover.
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const signalLabel = document.getElementById('signal-label');

// How long a connected board may say nothing before the chip stops claiming
// everything is fine. Only applies when something is expected to be streaming —
// see `expectsStream`. Generous, because a board that has just been asked to
// calibrate its compass is legitimately busy for a few seconds.
const QUIET_MS = 3000;
let lastHeard = 0;
let live = null; // the last real status, while `stale` is standing in for it

// Whether silence means anything. A controller made of buttons and gestures
// sends nothing at all while nobody is touching it — that is the whole point of
// reporting edges — so only a build with a polled reading in it can be quiet in
// a way worth mentioning.
function expectsStream() {
  return signalStore.all().some((signal) =>
    signal.planned && (signal.kind === 'number' || signal.kind === 'bearing'));
}

const connectError = document.getElementById('connect-error');

const LABELS = {
  lost: 'Connection lost',
  stale: 'Connected, no data',
};

function paint({ state, message, retrying = false }) {
  // Whichever of the two buttons is about to vanish, if it is the one somebody
  // just pressed, hand focus on rather than dropping it on the floor.
  const wasFocused = document.activeElement;
  const connected = state === 'connected' || state === 'stale';
  const connecting = state === 'connecting';

  signalToggle.dataset.state = state;
  connectBtn.hidden = connected;
  connectBtn.disabled = connecting;
  connectBtn.textContent = connecting ? 'Connecting…' : 'Connect';
  // Offered whenever there is something to give up on, which while connecting
  // there always is — a first attempt as much as a reconnect. That is the one
  // moment somebody most wants to stop waiting, and a "Connecting…" with
  // nothing to press beside it is the loop people got stuck in.
  disconnectBtn.hidden = !connected && !connecting;
  disconnectBtn.textContent = connecting ? 'Cancel' : 'Disconnect';

  if (state === 'connected') {
    // e.g. "BBC micro:bit [gapeg]" — the board's own name, which is what tells
    // you *which* board in a room full of them.
    signalLabel.textContent = message || 'Connected';
  } else if (connecting) {
    signalLabel.textContent = retrying ? 'Reconnecting…' : 'Connecting…';
  } else {
    signalLabel.textContent = LABELS[state] ?? 'Not Connected';
  }

  // The chip has room for a state, not for a sentence, so the reason goes to the
  // banner. Without this the connection was working out exactly why it
  // failed and then throwing it away — every failure read "Not Connected",
  // which is the one thing the person already knew.
  if (connectError) {
    const explain = !connected && !connecting && message;
    connectError.textContent = explain || '';
    connectError.hidden = !explain;
  }
  if (connected && wasFocused === connectBtn) signalToggle.focus();
  if (!connected && wasFocused === disconnectBtn) connectBtn.focus();
}

onStatus((status) => {
  // A fresh link starts with a clean slate: the readings from the last board,
  // or the last program on this one, are not what it is about to send.
  if (status.state === 'connected' && live?.state !== 'connected') signalStore.reset();
  live = status;
  lastHeard = performance.now();
  paint(status);
});

onInput(() => {
  blink();
  lastHeard = performance.now();
  if (live && signalToggle.dataset.state === 'stale') paint(live);
});

// Checked on a timer rather than worked out when asked, because the thing being
// watched is the absence of events, and nothing arrives to prompt the question.
setInterval(() => {
  if (live?.state !== 'connected') return;
  const quiet = performance.now() - lastHeard > QUIET_MS;
  const showing = signalToggle.dataset.state;
  if (quiet && showing === 'connected' && expectsStream()) paint({ state: 'stale' });
}, 1000);

// --- Connecting --------------------------------------------------------------
// One way in, so Connect just connects: Bluetooth, from the browser. The board
// is still plugged in by USB to flash it, but never to play.

async function start() {
  try {
    await connect();
  } catch (err) {
    // The chooser being dismissed throws, and is not a failure — the Bluetooth
    // module has already put the previous status back.
    console.debug('connect cancelled or failed:', err?.message);
  }
}

connectBtn.addEventListener('click', () => start());
disconnectBtn.addEventListener('click', () => disconnect());
