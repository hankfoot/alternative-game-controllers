// The choices a game offers about its own controls and course, remembered
// per scheme and handed to the game.
//
// The game declares them on its ports — how hard a flap kicks, how fast the
// world runs, what the slide speed is — and reads them back through
// `option(node, port, id)`. This module only remembers which choice is picked
// and gives the game the resolved set: at boot, every time the scheme changes
// (a new scheme is a fresh engine with nothing set), and on every change. The
// Design screen edits through here; nothing else writes.
//
// Stored under one key, per game id, in the shape the wiring engine used
// before it, so what people have already set survives the engine going.

import { key } from './storage-keys.js';

const OPTION_KEY = key('controls', 'v1');

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function readAll(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(OPTION_KEY) ?? 'null');
    return isRecord(saved) ? saved : {};
  } catch {
    return {};
  }
}

function writeAll(storage, games) {
  try {
    storage?.setItem(OPTION_KEY, JSON.stringify(isRecord(games) ? games : {}));
  } catch {
    // Persistence may be blocked; the choices still hold for this session.
  }
}

export function createGameOptions({ gameHost, storage = null }) {
  const listeners = new Set();
  let game = gameHost.activeGame();
  let chosen = {};

  const portKey = (node, port) => `${node}.${port}`;
  const everyPort = () => [...(game?.targets ?? []), ...(game?.settings ?? [])]
    .flatMap((target) => target.ports.map((port) => ({ target, port })));

  function load() {
    const forGame = readAll(storage)[game?.id ?? ''];
    chosen = isRecord(forGame) ? forGame : {};
  }

  function save() {
    const games = readAll(storage);
    games[game?.id ?? ''] = chosen;
    writeAll(storage, games);
  }

  /** The picked value of every option on a port, falling back to the declared one. */
  function get(node, port) {
    const found = everyPort().find((entry) => entry.target.id === node && entry.port.id === port);
    const picked = chosen[portKey(node, port)] ?? {};
    const resolved = {};
    for (const option of found?.port.options ?? []) {
      const value = picked[option.id];
      const known = option.choices.some(([id]) => id === value);
      resolved[option.id] = known ? value : option.value;
    }
    return resolved;
  }

  function publish() {
    for (const { target, port } of everyPort()) {
      if (!port.options?.length) continue;
      gameHost.actions.setControlOptions?.(target.id, port.id, get(target.id, port.id));
    }
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }

  load();
  publish();
  gameHost.onGameChange?.((next) => {
    game = next;
    load();
    publish();
    notify();
  });

  return {
    get gameId() { return game?.id ?? ''; },
    /** The course: option groups that are not controls, so nothing drives them. */
    get settings() { return game?.settings ?? []; },
    /** The controls, with the options each one carries. */
    get targets() { return game?.targets ?? []; },
    get,
    set(node, port, id, value) {
      const k = portKey(node, port);
      chosen[k] = { ...(chosen[k] ?? {}), [id]: value };
      save();
      gameHost.actions.setControlOptions?.(node, port, get(node, port));
      notify();
    },
    /** Every game's choices, for a bundle. */
    exportAll: () => readAll(storage),
    /** A bundle's choices for every game, applied and handed to the game. */
    importAll(games) {
      writeAll(storage, games);
      load();
      publish();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
