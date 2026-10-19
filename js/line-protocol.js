// The wire protocol, and the buffering that gets whole lines out of it.
//
// Both transports speak exactly the same thing — newline-delimited
// "<channel>:<number>" — and differ only in how the bytes arrive. So the part
// that turns bytes into messages lives here, once, rather than being written
// twice and drifting.
//
// Each transport gets its own buffer rather than sharing one. Two half-lines
// from two boards interleaving in a single buffer would splice into a line
// neither of them sent, which is the sort of fault that shows up as one
// impossible reading an hour into a workshop.

import { emitInput, emitCommand } from './bus.js';

/**
 * Collects bytes and calls `onLine` for each complete line in them.
 *
 * `push` takes whatever the transport hands over — a DataView from a Bluetooth
 * notification, a Uint8Array from a serial read. Decoding is streaming, so a
 * multi-byte character split across two chunks survives; with an ASCII protocol
 * that is theory rather than practice, but the non-streaming version quietly
 * corrupts the boundary and there is no reason to keep that around.
 */
export function createLineBuffer({ onLine = parseLine, midStream = false } = {}) {
  const decoder = new TextDecoder();
  let buffer = '';
  // Whether the next newline is the *end* of something we only saw half of, and
  // must therefore be thrown away rather than parsed.
  let syncing = midStream;

  return {
    push(chunk) {
      if (!chunk) return;
      buffer += decoder.decode(chunk, { stream: true });

      // A stream joined in progress starts mid-line: the board has been writing
      // into a buffer nobody was reading, so the first bytes are the tail of a
      // reading that began before we arrived. Parsed, that tail glues itself to
      // the front of the next line — "pit" followed by "pitch:112" becomes the
      // channel "pitpitch", which then appears in the input list as a stream
      // that does not exist. So the first fragment is dropped, always.
      if (syncing) {
        const nl = buffer.indexOf('\n');
        if (nl < 0) {
          buffer = '';
          return;
        }
        buffer = buffer.slice(nl + 1);
        syncing = false;
      }

      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        // Trimmed, which is also what makes CRLF work: `serial.writeLine` on the
        // micro:bit ends every line with \r\n, so without this every wired
        // reading would arrive as a number with a carriage return stuck to it
        // and parse as NaN. Splitting on \n and trimming the rest handles both
        // endings without having to know which transport it came from.
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onLine(line);
      }
    },

    /**
     * Throws away a partial line. Called when a stream opens or ends, so the
     * tail of a session that was cut off mid-line is never glued to the head of
     * the next one.
     */
    reset({ mid = midStream } = {}) {
      buffer = '';
      syncing = mid;
    },
  };
}

// The prefix that makes a line a command rather than a reading. A reading is
// "<channel>:<number>"; a command starts with this and could never be mistaken
// for one, since nothing after it is a number.
const COMMAND_PREFIX = 'game:';

const CONTROL_NAME = /^[a-z0-9_-]+$/;

/**
 * Parse one game command — "game:press:flap", "game:hold:thrust:1",
 * "game:set:paddle:0.5", "game:start" — or null if the line is not one, or
 * is one with something missing. Pure.
 */
export function parseCommand(raw) {
  const line = raw.trim().toLowerCase();
  if (!line.startsWith(COMMAND_PREFIX)) return null;
  const [verb, control = '', value = ''] = line.slice(COMMAND_PREFIX.length).split(':').map((part) => part.trim());
  if (verb === 'start') return { verb, raw };
  if (!CONTROL_NAME.test(control)) return null;
  if (verb === 'press') return { verb, control, raw };
  if (verb === 'hold') {
    // "game:hold:thrust" alone means down; the explicit 0 is the release.
    const number = value === '' ? 1 : Number(value);
    return Number.isFinite(number) ? { verb, control, value: number, raw } : null;
  }
  if (verb === 'set') {
    const number = Number(value);
    return value !== '' && Number.isFinite(number) ? { verb, control, value: number, raw } : null;
  }
  return null;
}

/**
 * Parse one protocol line into a message and push it onto the bus: a game
 * command to `command`, a "<channel>:<number>" reading to `emit`. Any channel
 * name is valid; malformed lines are ignored so a noisy starter can't crash
 * the page.
 */
export function parseLine(raw, emit = emitInput, command = emitCommand) {
  if (raw.trim().toLowerCase().startsWith(COMMAND_PREFIX)) {
    const parsed = parseCommand(raw);
    if (parsed) command(parsed);
    return;
  }
  const sep = raw.indexOf(':');
  if (sep <= 0) return; // no channel name — not part of the protocol
  const channel = raw.slice(0, sep).trim().toLowerCase();
  const encodedValue = raw.slice(sep + 1).trim();
  const value = Number(encodedValue);
  if (!channel || !encodedValue || !Number.isFinite(value)) return;
  emit({ channel, value, raw });
}
