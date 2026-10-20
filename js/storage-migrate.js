// Moving everything somebody has made into the new namespace.
//
// The site has filed its records under two earlier names —
// `experimental-game-controllers`, then `game-controller-workshop` — and is now
// called something else. Renaming the keys without moving the values
// would look, from the outside, exactly like the site forgetting every wire,
// drawing and setting anybody had — so this runs once, before anything reads a
// store, and copies them across.
//
// It copies rather than moves. Deleting the old keys does not stop a tab still
// running the old code from writing them straight back; it only makes the
// resurrected record look like a fresh install to some later run, which could
// then copy it *forward* over good data. Left in place, the old keys are a
// one-way snapshot: a stale tab's writes land somewhere nothing reads any more,
// and by the time that tab is refreshed the marker is set and nothing merges.
// The honest cost is that work done in a stale tab after you opened the new
// site is lost, which is a great deal better than two records interleaving.
//
// A few tens of kilobytes stay behind in a five-megabyte budget. Worth it.

import { key } from './storage-keys.js';

// The old names, written out rather than built from a helper. A third rename
// must rewrite what this file *writes* and leave what it *reads* exactly as it
// is, and the only way to guarantee that is for these not to be generated.
//
// Newest name first: a copy never overwrites, so whichever name is tried first
// wins, and the most recent record is the one somebody last worked on.
const MOVED = Object.freeze([
  ['game-controller-workshop:rules:v1', key('rules', 'v1')],
  ['game-controller-workshop:request:v1', key('request', 'v1')],
  ['game-controller-workshop:controls:v1', key('controls', 'v1')],
  ['game-controller-workshop:game', key('game')],
  ['game-controller-workshop:theme:v1', key('theme', 'v1')],
  ['experimental-game-controllers:controls:v1', key('controls', 'v1')],
  ['experimental-game-controllers:game', key('game')],
  ['experimental-game-controllers:theme:v1', key('theme', 'v1')],
]);

// Assets fall back to a key each when there is no database to put them in, so
// there is no fixed list of them — only a prefix to sweep. Newest first, as above.
const OLD_ASSET_PREFIXES = Object.freeze([
  'game-controller-workshop:asset:',
  'experimental-game-controllers:asset:',
]);
const NEW_ASSET_PREFIX = `${key('asset')}:`;

/** Set once the whole sweep has finished, so the common case is one read. */
export const MIGRATED_KEY = key('migrated', 'v1');

/**
 * Copies one record, unless there is already something under the new name.
 * Answers whether this key is now settled — either copied, or nothing to copy,
 * or something newer already in its place.
 *
 * "Destination empty" rather than "marker unset" is what makes a half-finished
 * run safe to repeat: a write that throws on one key leaves the marker unset,
 * so the next load comes back, skips everything that landed, and retries the
 * rest. Guarding on the marker alone would strand whatever failed.
 */
function copy(storage, from, to) {
  try {
    const value = storage.getItem(from);
    if (value == null || storage.getItem(to) != null) return true;
    storage.setItem(to, value);
    return true;
  } catch {
    // Quota, a private window, a policy change mid-session. Leave it for the
    // next load rather than abandoning the keys after it.
    return false;
  }
}

/**
 * Brings a previous visit's saved work into the current namespace. Safe to call
 * any number of times; does nothing at all after the first completed run.
 */
export function migrateStorage(storage) {
  if (!storage) return;
  try {
    if (storage.getItem(MIGRATED_KEY)) return;
  } catch {
    return; // storage is unreadable; there is nothing to migrate to either
  }

  // Every key is attempted whatever the ones before it did — one refused write
  // must not abandon the rest — but a single failure withholds the marker, so
  // the next load comes back for exactly what is still missing.
  let settled = true;
  for (const [from, to] of MOVED) settled = copy(storage, from, to) && settled;

  // Collected before anything is written: setItem during a live index walk
  // shifts the indices under it, and the sweep would skip keys.
  let names = [];
  try {
    names = Array.from({ length: storage.length }, (_, i) => storage.key(i))
      .filter((name) => typeof name === 'string');
  } catch {
    names = [];
  }
  for (const prefix of OLD_ASSET_PREFIXES) {
    for (const from of names.filter((name) => name.startsWith(prefix))) {
      settled = copy(storage, from, NEW_ASSET_PREFIX + from.slice(prefix.length)) && settled;
    }
  }

  if (!settled) return;
  try {
    storage.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch {
    // Unmarked, so this runs again next time — which is a no-op by then, since
    // every copy above refuses to overwrite what it already wrote.
  }
}
