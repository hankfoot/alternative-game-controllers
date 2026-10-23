import test from 'node:test';
import assert from 'node:assert/strict';

import { createSignalStore } from '../js/signal-store.js';

// A store fed by hand rather than by the bus.
function storeWithFeed() {
  let feed = null;
  const store = createSignalStore({ subscribeInput: (listener) => { feed = listener; return () => {}; } });
  return { store, send: (channel, value) => feed({ channel, value }) };
}

test('a new connection forgets what the last one sent, but keeps what is planned', () => {
  const { store, send } = storeWithFeed();
  store.setPlannedChannels([{ channel: 'light', kind: 'number' }]);
  send('light', 200);
  send('shake', 1);
  const events = [];
  store.subscribe(({ type }) => events.push(type));

  store.reset();

  assert.equal(store.get('shake'), null, 'an unplanned channel is gone');
  const light = store.get('light');
  assert.ok(light, 'a planned channel stays');
  assert.equal(light.live, false);
  assert.equal(light.value, null);
  assert.equal(light.observedMax, null);
  assert.ok(events.includes('reset'), 'views are told to clear');
});
