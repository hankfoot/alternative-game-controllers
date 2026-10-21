import assert from 'node:assert/strict';
import test from 'node:test';

import { outline, slug } from '../js/toc.js';

test('an id is made of the title, and nothing the URL would mind', () => {
  assert.equal(slug('Get a micro:bit'), 'get-a-micro-bit');
  assert.equal(slug('  Go cordless Optional '), 'go-cordless-optional');
  assert.equal(slug('Copy the starter code'), 'copy-the-starter-code');
});

test('entries keep page order, level, and the number drawn beside the step', () => {
  const entries = outline([
    { level: 2, text: ' Set up your micro:bit ', id: 'setup-guide' },
    { level: 3, text: 'Get a micro:bit', id: 'setup-get-a-micro-bit', n: '1' },
    { level: 3, text: 'Go cordless', id: 'setup-go-cordless', n: '+' },
  ]);
  assert.deepEqual(entries, [
    { level: 2, text: 'Set up your micro:bit', id: 'setup-guide', n: null },
    { level: 3, text: 'Get a micro:bit', id: 'setup-get-a-micro-bit', n: '1' },
    { level: 3, text: 'Go cordless', id: 'setup-go-cordless', n: '+' },
  ]);
});
