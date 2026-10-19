// Where the sentences on Controls are kept: per scheme, since the controls a
// sentence ends with belong to the scheme.

import { key } from './storage-keys.js';

const RULES_KEY = key('rules', 'v1');

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Only what a rule is made of, with nothing else riding along. */
export function normalizeStoredRule(value) {
  if (!isRecord(value) || typeof value.input !== 'string' || typeof value.when !== 'string') return null;
  const rule = { id: String(value.id ?? ''), input: value.input, when: value.when, control: String(value.control ?? '') };
  for (const field of ['threshold', 'low', 'high']) {
    if (Number.isFinite(Number(value[field])) && value[field] !== null && value[field] !== '') rule[field] = Number(value[field]);
  }
  return rule;
}

function readAll(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(RULES_KEY) ?? 'null');
    return isRecord(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function loadRules(storage, gameId) {
  const forGame = readAll(storage)[gameId];
  return Array.isArray(forGame) ? forGame.map(normalizeStoredRule).filter(Boolean) : [];
}

export function saveRules(storage, gameId, rules) {
  try {
    const games = readAll(storage);
    games[gameId] = rules.map(normalizeStoredRule).filter(Boolean);
    storage?.setItem(RULES_KEY, JSON.stringify(games));
  } catch {
    // Persistence may be blocked; the sentences still work for this session.
  }
}

/** Every scheme's sentences, for a bundle. */
export function loadAllRules(storage) {
  const games = readAll(storage);
  const out = {};
  for (const [gameId, rules] of Object.entries(games)) {
    if (Array.isArray(rules)) out[gameId] = rules.map(normalizeStoredRule).filter(Boolean);
  }
  return out;
}

export function saveAllRules(storage, games) {
  try {
    const out = {};
    for (const [gameId, rules] of Object.entries(isRecord(games) ? games : {})) {
      if (Array.isArray(rules)) out[gameId] = rules.map(normalizeStoredRule).filter(Boolean);
    }
    storage?.setItem(RULES_KEY, JSON.stringify(out));
  } catch {
    // Persistence may be blocked; the sentences still work for this session.
  }
}
