import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignalStore } from '../js/signal-store.js';

// A bus of one: the store subscribes, the test emits.
function fakeBus() {
  const listeners = new Set();
  return {
    subscribeInput: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: (msg) => listeners.forEach((fn) => fn(msg)),
  };
}

// A script invents a channel. It has to exist, with the kind the script said,
// before the first reading lands — otherwise the store infers a kind from that
// first value, and a `1` meant as the start of a 0..100 level would be filed as
// a button and the jacks offered for it would be the wrong ones.
test('a published channel exists with its declared kind before any reading', () => {
  const bus = fakeBus();
  const store = createSignalStore({ subscribeInput: bus.subscribeInput, now: () => 0 });
  store.setPublishedChannels([{ channel: 'height', kind: 'number' }]);
  assert.equal(store.get('height')?.kind, 'number');
  assert.equal(store.get('height').published, true);
  bus.emit({ channel: 'height', value: 1 });
  assert.equal(store.get('height').kind, 'number', 'a 1 does not talk it back down to binary');
});

test('a published channel survives the planned list being emptied, and leaves when unpublished', () => {
  const bus = fakeBus();
  const store = createSignalStore({ subscribeInput: bus.subscribeInput, now: () => 0 });
  store.setPublishedChannels(['claps']);
  store.setPlannedChannels([]);
  assert.ok(store.get('claps'), 'planning is somebody else\'s flag');
  store.setPublishedChannels([]);
  assert.equal(store.get('claps'), null, 'never live, never wired: gone');
});

test('unpublishing keeps a channel that is live or wired', () => {
  const bus = fakeBus();
  const store = createSignalStore({ subscribeInput: bus.subscribeInput, now: () => 0 });
  store.setPublishedChannels(['claps', 'height']);
  bus.emit({ channel: 'claps', value: 1 });
  store.setWiredChannels(['height']);
  store.setPublishedChannels([]);
  assert.ok(store.get('claps')?.live, 'a reading was heard, so it stays as a live signal');
  assert.ok(store.get('height')?.wired, 'a wire points at it, so it stays');
});
