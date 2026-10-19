// The Code it section on the Controls screen: the instructions to copy, the
// box to paste into, Run / Stop / Clear, and the log.
//
// Thin on purpose. Everything that could go wrong — compiling, running,
// stopping, what a name means — is js/script-runner.js's, and what the
// instructions say is js/script-prompt.js's; both are tested without a DOM.
// This file only moves text between those and the page.

import { buildPrompt, describeInputs } from './script-prompt.js';
import { controlsFor } from './script-runner.js';
import { loadScript, saveScript } from './script-storage.js';

// How much of the log is kept. A script printing every reading fills fifty
// lines in five seconds; what matters is the most recent, and the error.
const LOG_LINES = 50;

// How long after the last keystroke the draft is saved.
const SAVE_DELAY_MS = 300;

export function initScriptUI({ elements, runner, signalStore, gameHost, storage }) {
  const { prompt, source, run, stop, clear, status, log } = elements;
  if (!prompt || !source || !run || !stop || !runner || !signalStore || !gameHost) return null;

  // Whether Run was pressed more recently than Stop. Saved alongside the text,
  // so a refresh — which is how a board gets re-paired — brings the script back
  // running if it was, and not if it wasn't.
  let wanted = false;
  let saveTimer = null;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveScript(storage, { source: source.value, autoRun: wanted });
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function renderPrompt() {
    const game = gameHost.activeGame();
    prompt.textContent = buildPrompt({
      inputs: describeInputs(signalStore.all()),
      controls: controlsFor(game?.targets),
      schemeName: game?.label ?? '',
      schemeTagline: game?.tagline ?? '',
    });
  }

  const lines = [];
  function renderLog() {
    if (!log) return;
    log.replaceChildren(...lines.map(({ level, text }) => {
      const line = document.createElement('div');
      line.dataset.level = level;
      line.textContent = text;
      return line;
    }));
    log.scrollTop = log.scrollHeight;
  }

  function appendLog(level, text) {
    lines.push({ level, text });
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
    renderLog();
  }

  function renderStatus({ status: current, message }) {
    if (status) {
      status.textContent = message;
      status.dataset.status = current;
    }
    stop.disabled = current !== 'running';
    run.textContent = current === 'running' ? 'Run again' : 'Run';
  }

  run.addEventListener('click', () => {
    wanted = true;
    save();
    runner.run(source.value);
  });

  stop.addEventListener('click', () => {
    wanted = false;
    save();
    runner.stop();
  });

  clear?.addEventListener('click', () => {
    if (source.value.trim() && !window.confirm('Clear the script?')) return;
    wanted = false;
    runner.stop();
    source.value = '';
    lines.length = 0;
    renderLog();
    save();
  });

  source.addEventListener('input', saveSoon);
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run.click();
    }
  });

  runner.subscribe((event) => {
    if (event.type === 'log') appendLog(event.level, event.text);
    if (event.type === 'status') renderStatus(event);
  });

  // The instructions change when the inputs do or the scheme does — not on
  // every reading, which would rewrite a few kilobytes ten times a second.
  signalStore.subscribe(({ type }) => {
    if (type !== 'value') renderPrompt();
  });
  gameHost.onGameChange(renderPrompt);

  const saved = loadScript(storage);
  if (saved) {
    source.value = saved.source;
    wanted = saved.autoRun;
    if (saved.autoRun) runner.run(saved.source);
  }
  renderPrompt();
  renderStatus(runner.status());

  return {
    /** Re-reads the record, for when an imported bundle has rewritten it. Never runs it. */
    reload() {
      const fresh = loadScript(storage);
      wanted = false;
      runner.stop();
      source.value = fresh?.source ?? '';
      save();
    },
  };
}
