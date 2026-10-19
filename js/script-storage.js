// Where a pasted script is kept between visits.
//
// Refreshing the page is the ordinary way to re-pair a board at the workshop,
// so a script that vanished on refresh would vanish several times an hour. It
// is saved as it is typed, and whether it was running goes with it, so a
// refresh brings the controller back exactly as it was. A script that arrives
// inside somebody else's bundle is saved but never marked to run: it is their
// code, and it should not start until this person has pressed the button.

import { key } from './storage-keys.js';

const STORAGE_KEY = key('script', 'v1');

// Well past anything a person would paste; this is a guard against a file
// that is not what it claims to be, not a limit anyone should meet.
export const SCRIPT_LIMIT = 64 * 1024;

/**
 * `{ source, request, autoRun }` from whatever was stored or imported, or null.
 *
 * `request` is the sentence they typed for the AI. Kept with the script so a
 * refresh gives it back, and so a bundle says what its script was for.
 * Either one on its own is worth keeping; nothing at all is not.
 */
export function normalizeScript(value) {
  if (!value || typeof value !== 'object') return null;
  const { source, request, autoRun } = value;
  const text = typeof source === 'string' && source.length <= SCRIPT_LIMIT ? source : '';
  const ask = typeof request === 'string' && request.length <= SCRIPT_LIMIT ? request : '';
  if (!text.trim() && !ask.trim()) return null;
  return { source: text, request: ask, autoRun: autoRun === true && Boolean(text.trim()) };
}

export function loadScript(storage) {
  try {
    return normalizeScript(JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveScript(storage, script) {
  try {
    const normalized = normalizeScript(script);
    if (normalized) storage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Persistence may be blocked; the script still runs for this session.
  }
}

export function clearScript(storage) {
  saveScript(storage, null);
}
