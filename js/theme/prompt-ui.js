// The Design screen's two AI prompts, filled in from a few words about the
// game: the same card as Code it on Controls, a box to type in on top and
// the prompt it fills in under the fold.
//
// Each card keeps its own description: what the pictures should look like
// and what the sounds should sound like are different things to say, even
// for the same game. Each is kept, so it is still there after a reload.

import { key } from '../storage-keys.js';
import { soundPrompt, spritePrompt } from './ai-prompts.js';

// Both cards once shared this one; it seeds a card that has nothing of its own.
const SHARED_KEY = key('idea', 'v1');
const COPIED_MS = 1800;

export function initPromptUI({ cards, storage = null, onImport = null }) {
  const bound = cards
    .map(({ card, write, id }) => ({
      write,
      card,
      saveKey: key(`idea-${id}`, 'v1'),
      input: card?.querySelector('.design-idea'),
      copy: card?.querySelector('.design-ai-copy'),
      code: card?.querySelector('code'),
    }))
    .filter(({ input, copy, code }) => input && copy && code);
  if (!bound.length) return;

  const read = (name) => {
    try {
      return storage?.getItem(name) ?? null;
    } catch {
      // Persistence may be blocked; the box still works for this visit.
      return null;
    }
  };

  for (const { card, input, copy, code, write, saveKey } of bound) {
    if (onImport) bindImport(card, onImport);
    input.value = read(saveKey) ?? read(SHARED_KEY) ?? '';
    const idea = () => input.value;
    const render = () => { code.textContent = write(idea()); };
    render();

    input.addEventListener('input', () => {
      render();
      try {
        storage?.setItem(saveKey, idea());
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
      if (!idea().trim()) {
        input.focus();
        return;
      }
      const original = copy.textContent;
      let label = 'Copied — paste it into your AI';
      try {
        await navigator.clipboard.writeText(write(idea()));
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
    { id: 'sprites', card: byId('design-sprite-prompt')?.closest('.code-block'), write: spritePrompt },
    { id: 'sounds', card: byId('design-sound-prompt')?.closest('.code-block'), write: soundPrompt },
  ];
}
