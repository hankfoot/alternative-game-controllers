// The Design screen's two AI prompts, filled in from a few words about the
// game: the same card as Code it on Controls, a box to type in on top and
// the prompt it fills in under the fold.
//
// One description serves both, since the drawings and the sounds are for the
// same game — typing in either box fills in both prompts — and it is kept, so
// it is still there after a reload.

import { key } from '../storage-keys.js';
import { soundPrompt, spritePrompt } from './ai-prompts.js';

const IDEA_KEY = key('idea', 'v1');
const COPIED_MS = 1800;

export function initPromptUI({ cards, storage = null, onImport = null }) {
  const bound = cards
    .map(({ card, write }) => ({
      write,
      card,
      input: card?.querySelector('.design-idea'),
      copy: card?.querySelector('.design-ai-copy'),
      code: card?.querySelector('code'),
    }))
    .filter(({ input, copy, code }) => input && copy && code);
  if (!bound.length) return;

  let idea = '';
  try {
    idea = storage?.getItem(IDEA_KEY) ?? '';
  } catch {
    // Persistence may be blocked; the box still works for this visit.
  }

  function render() {
    for (const { input, code, write } of bound) {
      if (input.value !== idea) input.value = idea;
      code.textContent = write(idea);
    }
  }

  for (const { card, input, copy, code, write } of bound) {
    if (onImport) bindImport(card, onImport);
    input.addEventListener('input', () => {
      idea = input.value;
      render();
      try {
        storage?.setItem(IDEA_KEY, idea);
      } catch {
        // As above.
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        copy.click();
      }
    });

    copy.addEventListener('click', async (event) => {
      // In the fold's <summary>, where a click would also open and close it.
      event.preventDefault();
      // The description is the one part that is theirs; a prompt copied
      // without it asks the AI to fill in a blank it can't.
      if (!idea.trim()) {
        input.focus();
        return;
      }
      const original = copy.textContent;
      let label = 'Copied — paste it into your AI';
      try {
        await navigator.clipboard.writeText(write(idea));
        copy.classList.add('copied');
      } catch {
        // Clipboard blocked: open the fold and select the text, so one
        // keystroke copies it.
        label = 'Copy blocked — select the text below';
        const details = code.closest('details');
        if (details) details.open = true;
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      copy.textContent = label;
      setTimeout(() => {
        copy.textContent = original;
        copy.classList.remove('copied');
      }, COPIED_MS);
    });
  }

  render();
}

// Files back in, picked or dropped on the card. Either card takes either kind:
// each file goes where its name says, whichever card it came in through.
function bindImport(card, onImport) {
  const picker = card.querySelector('.design-import-file');
  const note = card.querySelector('.design-import-note');
  if (!picker || !note) return;

  async function take(files) {
    if (!files?.length) return;
    note.textContent = 'Bringing them in…';
    note.textContent = await onImport(files);
  }

  picker.addEventListener('change', async () => {
    await take(picker.files);
    picker.value = '';
  });
  card.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault();
    card.dataset.drop = 'true';
  });
  card.addEventListener('dragleave', (event) => {
    if (!card.contains(event.relatedTarget)) card.dataset.drop = 'false';
  });
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.dataset.drop = 'false';
    take(event.dataTransfer?.files);
  });
}

/** The two Design cards, found by the prompt each one holds. */
export function designPromptCards(byId) {
  return [
    { card: byId('design-sprite-prompt')?.closest('.code-block'), write: spritePrompt },
    { card: byId('design-sound-prompt')?.closest('.code-block'), write: soundPrompt },
  ];
}
