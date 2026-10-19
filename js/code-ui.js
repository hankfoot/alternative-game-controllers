// The Code it section on the Controls screen: the sentence to copy for an AI,
// and the log of what the board then sends.
//
// Thin on purpose. What the instructions say is js/code-prompt.js's, and what a
// command does is js/game-commands.js's; both are tested without a DOM. This
// file only moves text between those and the page. Nothing here runs code:
// the code the AI writes goes into MakeCode and onto the board.

import { buildPrompt, describeInputs } from './code-prompt.js';
import { controlsFor } from './game-facade.js';
import { key } from './storage-keys.js';

// The sentence they typed, kept between visits: refreshing is how a board gets
// re-paired, and the sentence is the one thing on this screen that is theirs.
const REQUEST_KEY = key('request', 'v1');

// How long the copy button says so.
const COPIED_MS = 1400;

// How many commands the log shows.
const LOG_LINES = 50;

export function initCodeUI({ elements, bridge, controls, gameHost, storage }) {
  const { prompt, request, copy, log, status } = elements;
  if (!request || !copy || !bridge || !controls || !gameHost) return null;

  function promptText() {
    const game = gameHost.activeGame();
    return buildPrompt({
      inputs: describeInputs(controls.parts()),
      controls: controlsFor(game?.targets),
      schemeName: game?.label ?? '',
      schemeTagline: game?.tagline ?? '',
      request: request.value,
    });
  }

  function renderPrompt() {
    if (prompt) prompt.textContent = promptText();
  }

  // Copied rather than shown: nobody needs to read a page of reference to use
  // it, and the sentence they typed is the only part that is theirs. The text
  // is still there, folded away, for anyone who wants to see it.
  copy.addEventListener('click', async () => {
    if (!request.value.trim()) {
      request.focus();
      return;
    }
    const original = copy.textContent;
    let label = 'Copied — paste it into your AI';
    try {
      await navigator.clipboard.writeText(promptText());
      copy.classList.add('copied');
    } catch {
      // Clipboard blocked — a non-secure context, usually. The text is still
      // there under the fold; open it and select it, so one keystroke copies.
      label = 'Copy blocked — select the text below';
      const details = prompt?.closest('details');
      if (details) details.open = true;
      if (prompt) {
        const range = document.createRange();
        range.selectNodeContents(prompt);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    copy.textContent = label;
    setTimeout(() => {
      copy.textContent = original;
      copy.classList.remove('copied');
    }, COPIED_MS * 2);
  });

  request.addEventListener('input', () => {
    renderPrompt();
    try {
      storage?.setItem(REQUEST_KEY, request.value);
    } catch {
      // Persistence may be blocked; the sentence still works for this visit.
    }
  });
  request.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      copy.click();
    }
  });

  // --- The log of what the board sends ---------------------------------------
  function renderLog() {
    if (!log) return;
    const entries = bridge.recent().slice(-LOG_LINES);
    log.replaceChildren(...entries.map(({ level, text }) => {
      const line = document.createElement('div');
      line.dataset.level = level;
      line.textContent = text;
      return line;
    }));
    log.scrollTop = log.scrollHeight;
  }

  function renderStatus() {
    if (!status) return;
    const driven = bridge.driven();
    status.textContent = driven
      ? 'Your board is driving the game.'
      : 'Waiting for a command from your board.';
    status.dataset.status = driven ? 'driven' : 'idle';
  }

  bridge.subscribe((event) => {
    if (event.type === 'command') renderLog();
    renderStatus();
  });

  // The instructions change when the sentences do or the scheme does.
  controls.subscribe(renderPrompt);
  gameHost.onGameChange(renderPrompt);

  try {
    request.value = storage?.getItem(REQUEST_KEY) ?? '';
  } catch {
    request.value = '';
  }
  renderPrompt();
  renderLog();
  renderStatus();

  return { renderPrompt };
}
