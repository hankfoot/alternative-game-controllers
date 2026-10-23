// Reading a .zip, for importing a set of drawings and sounds an AI tool
// bundled into one download.
//
// Small on purpose: the central directory says where every file is, and the
// browser's own DecompressionStream inflates the compressed ones, so there is
// no library to ship. It reads what tools actually produce — stored and
// deflated entries in an ordinary zip — and turns down what it can't
// (encrypted entries, zip64, other compression) with a reason, rather than
// handing back garbage.

const EOCD = 0x06054b50; // end of central directory
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

async function inflate(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new ZipError('This browser can’t open zip files. Unzip it first and pick the files inside.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Where the end-of-central-directory record starts, searching back past a comment. */
function findEnd(view) {
  const last = view.byteLength - 22;
  const first = Math.max(0, last - 0xffff);
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  return -1;
}

// Folders, and the clutter a Mac adds to every zip it makes.
const isClutter = (name) =>
  name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\./.test(name);

/**
 * Every file in a zip, as `{ name, bytes }`, with folders and hidden files
 * left out. `name` is the entry's full path inside the zip.
 */
export async function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.byteLength >= 22 ? findEnd(view) : -1;
  if (end < 0) throw new ZipError('That doesn’t look like a zip file.');

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (at === 0xffffffff || count === 0xffff) throw new ZipError('That zip is too big to open here.');

  const decode = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL) throw new ZipError('That zip file is damaged.');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decode.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (isClutter(name)) continue;
    if (flags & 1) throw new ZipError('That zip has a password on it.');
    if (view.getUint32(local, true) !== LOCAL) throw new ZipError('That zip file is damaged.');
    // The local header's own name and extra lengths, which can differ from the
    // central directory's; the size comes from the directory, because a local
    // header written while streaming says zero.
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.push({ name, bytes: data.slice() });
    else if (method === 8) files.push({ name, bytes: await inflate(data) });
    else throw new ZipError('That zip uses a kind of compression this page can’t open.');
  }
  return files;
}

/** Whether a picked file is a zip, going by its name or its type. */
export const isZip = (file) =>
  /\.zip$/i.test(file?.name ?? '') || /zip/.test(file?.type ?? '');
