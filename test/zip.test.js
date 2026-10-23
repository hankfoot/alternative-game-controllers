import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { readZip, ZipError } from '../js/theme/zip.js';

// A minimal zip writer, just enough to make the files the reader is for.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store = false, flags = 0 } of entries) {
    const nameBytes = Buffer.from(name);
    const body = store ? Buffer.from(data) : deflateRawSync(Buffer.from(data));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

test('a zip gives back its files, stored or compressed, without the clutter', async () => {
  const zip = makeZip([
    { name: 'game/player.png', data: 'pretend-png-'.repeat(20) },
    { name: 'crash.mp3', data: 'pretend-mp3', store: true },
    { name: 'game/', data: '', store: true },
    { name: '__MACOSX/game/._player.png', data: 'resource fork' },
    { name: '.DS_Store', data: 'finder' },
  ]);
  const files = await readZip(zip);
  assert.deepEqual(files.map((file) => file.name), ['game/player.png', 'crash.mp3']);
  assert.equal(Buffer.from(files[0].bytes).toString(), 'pretend-png-'.repeat(20));
  assert.equal(Buffer.from(files[1].bytes).toString(), 'pretend-mp3');
});

test('what a zip reader cannot open is turned down with a reason', async () => {
  await assert.rejects(readZip(new Uint8Array([1, 2, 3])), ZipError);
  await assert.rejects(readZip(makeZip([{ name: 'a.png', data: 'x', flags: 1 }])), /password/);
});
