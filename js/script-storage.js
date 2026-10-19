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

/** `{ source, autoRun }` from whatever was stored or imported, or null. */
export function normalizeScript(value) {
  if (!value || typeof value !== 'object') return null;
  const { source, autoRun } = value;
  if (typeof source !== 'string' || !source.trim() || source.length > SCRIPT_LIMIT) return null;
  return { source, autoRun: autoRun === true };
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
