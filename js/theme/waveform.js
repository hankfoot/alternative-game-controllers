// A sound drawn as a row of bars, mirrored about the middle: the shape of a
// recording you can see before you hear it, and a playhead across it while you
// do. The same strip shows the microphone while a recording is being made, so
// you can see it is hearing you.
//
// Colours come from the canvas's own CSS (`--wave-idle`, `--wave-played`,
// `--wave-live`), so the stylesheet decides them and dark mode follows.

const BAR = 2; // px wide
const GAP = 2; // px between

/** Sizes the canvas to its box at the screen's density, and hands back a context in CSS pixels. */
function prepare(canvas) {
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

const colour = (canvas, name, fallback) =>
  getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;

// One bar, at least a hairline tall so silence still reads as a line rather
// than as nothing having loaded.
function bar(ctx, x, height, value) {
  const tall = Math.max(1.5, value * (height - 2));
  ctx.fillRect(x, (height - tall) / 2, BAR, tall);
}

/**
 * The whole of a sound. `peaks` runs 0 to 1 and may be null, which draws the
 * flat line of silence. `progress`, from 0 to 1, colours the part already
 * played.
 */
export function drawWaveform(canvas, peaks, { progress = null } = {}) {
  const prepared = prepare(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const count = Math.max(1, Math.floor((width + GAP) / (BAR + GAP)));
  const idle = colour(canvas, '--wave-idle', '#a2a7b0');
  const played = colour(canvas, '--wave-played', '#8b46d6');

  for (let i = 0; i < count; i += 1) {
    // The loudest of the peaks this bar covers, so a short spike survives
    // being squeezed into a narrow strip.
    let value = 0;
    if (peaks?.length) {
      const from = Math.floor((i / count) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
      for (let j = from; j < to; j += 1) value = Math.max(value, peaks[j]);
    }
    ctx.fillStyle = progress !== null && i / count < progress ? played : idle;
    bar(ctx, i * (BAR + GAP), height, value);
  }
}

/** The microphone as it is heard, newest at the right, scrolling left. */
export function drawLevels(canvas, levels) {
  const prepared = prepare(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const count = Math.max(1, Math.floor((width + GAP) / (BAR + GAP)));
  ctx.fillStyle = colour(canvas, '--wave-live', '#e5484d');
  const shown = levels.slice(-count);
  const offset = count - shown.length;
  shown.forEach((value, i) => bar(ctx, (offset + i) * (BAR + GAP), height, value));
}
