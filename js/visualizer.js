// Live views of channels: one adaptive row per channel.
//
// A view watches the signal store and shows a row for each channel it is
// interested in — every channel, for the popover in the header; a named few,
// for a lesson on the Sensing screen or a sentence being tuned on Controls.
// Row style adapts to the data:
//   - event channels (per registry, e.g. shake) → flash dot + count
//   - channels that have only ever sent 0/1     → on/off pill
//   - anything else                             → numeric readout + rolling plot
// Plots scale using the registry's range hint when there is one, expanding to
// whatever values actually arrive (so unknown channels auto-scale). A view can
// also draw markers on a plot — a threshold line, or a low/high band — which is
// how a number being tuned is shown against the line it has to cross.
//
// The navbar chip is a plain button with a generic activity pulse (see
// main.js) — it renders NO per-channel data, so multiple simultaneous streams
// can't make it thrash.

import { channelInfo } from './channels.js';

// How much of the past a plot shows. The trace is drawn against time rather
// than as one point per frame: a reading arrives whenever the board has
// something new to say — every forty milliseconds while it moves, half a
// second apart while it sits — and a plot that pushed the latest value every
// frame held each reading for two or three frames and then jumped to the
// next, a staircase that read as choppy however fast the board was. Plotted
// at the moment it arrived, with a straight line to the reading before, the
// trace slides left at a steady pace and a change is a slope, not a step.
const WINDOW_MS = 2000;

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * A live view of some channels inside `host`.
 *
 * `channels` is the list to show, in that order, each row present from the
 * start so a lesson shows what it is waiting for; null means every channel
 * the store hears, added as they arrive. `markers(channel)` returns
 * `{ threshold }` or `{ low, high }` to draw on that channel's plot, or null.
 * `empty` is an element to hide once the first row exists.
 */
export function createChannelView(host, { signalStore, channels = null, markers = () => null, empty = null }) {
  /** @type {Map<string, object>} channel name -> row state */
  const rows = new Map();
  let alive = true;

  function makeRow(name, kind) {
    const info = channelInfo(name);
    const row = {
      name, kind,
      current: 0,
      count: 0,
      flashUntil: 0,
      min: info.min ?? 0,
      max: info.max ?? 1,
      samples: [], // [{ t, v }] within the window, oldest first
      heard: false,
      el: null, vizEl: null, canvas: null, ctx: null,
    };

    if (host) {
      if (empty) empty.hidden = true;
      row.el = document.createElement('div');
      row.el.className = 'chan';
      row.el.dataset.kind = kind;
      row.el.dataset.heard = 'false';
      row.el.innerHTML = `
        <span class="chan-id"><span class="chan-emoji">${info.emoji}</span><code>${name}</code></span>
        <div class="chan-viz"></div>
      `;
      row.vizEl = row.el.querySelector('.chan-viz');
      fillViz(row);
      host.appendChild(row.el);
    }
    rows.set(name, row);
    return row;
  }

  function fillViz(row) {
    if (!row.vizEl) return;
    if (row.kind === 'event') {
      row.vizEl.innerHTML = '<span class="chan-flash"></span><span class="chan-count">×<b>0</b></span>';
    } else if (row.kind === 'binary') {
      row.vizEl.innerHTML = '<span class="chan-pill" data-on="false">0</span>';
    } else {
      row.vizEl.innerHTML = '<canvas class="chan-spark"></canvas><span class="chan-num">0</span>';
      row.canvas = row.vizEl.querySelector('canvas');
      row.ctx = row.canvas.getContext('2d');
    }
  }

  // Rows for the channels asked for, before anything arrives: a lesson
  // waiting for its first reading should show what it is waiting for. An
  // entry may say what kind to expect, for a pin the registry cannot know.
  const wanted = channels
    ? channels.map((entry) => (typeof entry === 'string' ? { channel: entry, kind: null } : entry))
    : null;
  for (const { channel: name, kind } of wanted ?? []) {
    const known = signalStore.get(name);
    makeRow(name, known?.kind ?? kind ?? channelInfo(name).kind ?? 'binary');
  }

  const unsubscribe = signalStore.subscribe(({ type, signal }) => {
    if (type !== 'value') return;
    const { channel, value, kind } = signal;
    if (wanted && !wanted.some((entry) => entry.channel === channel)) return;
    let row = rows.get(channel);
    if (!row) row = makeRow(channel, kind);

    if (row.kind !== kind) {
      row.kind = kind;
      if (row.el) row.el.dataset.kind = kind;
      fillViz(row);
    }

    row.current = value;
    if (!row.heard) {
      row.heard = true;
      if (row.el) row.el.dataset.heard = 'true';
    }

    if (row.kind === 'event') {
      row.count++;
      row.flashUntil = performance.now() + 150;
      row.vizEl?.querySelector('.chan-flash')?.classList.add('flash');
      row.vizEl?.querySelector('.chan-count b')?.replaceChildren(String(row.count));
    } else if (row.kind === 'binary') {
      const pill = row.vizEl?.querySelector('.chan-pill');
      if (pill) { pill.dataset.on = String(value === 1); pill.textContent = String(value); }
    } else {
      row.min = signal.min;
      row.max = signal.max;
      row.samples.push({ t: performance.now(), v: value });
      row.vizEl?.querySelector('.chan-num')?.replaceChildren(fmt(value));
    }
  });

  // --- Drawing --------------------------------------------------------------

  // Size a canvas to its displayed box. Returns false if it has no size (hidden).
  //
  // Sized from the same measurement the drawing uses (clientWidth, inside the
  // border) rather than from getBoundingClientRect, which includes the border.
  // Sized from the latter, the bitmap was two pixels wider than the area that
  // got cleared each frame, and the sliver past the edge kept every height the
  // trace had ever reached there: a dashed tick standing at the right edge.
  function fit(canvas, ctx) {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  const cssColor = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  function drawTrace(row, color, markerColor, now) {
    const { canvas, ctx } = row;
    if (!fit(canvas, ctx)) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pad = 3;
    // A marker outside the reading's range still has to be seen, so the plot
    // widens to include it rather than drawing it off the edge.
    const marker = markers(row.name);
    let { min, max } = row;
    for (const v of [marker?.threshold, marker?.low, marker?.high]) {
      if (typeof v === 'number' && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    }
    const span = max - min || 1;
    const yOf = (v) => h - ((v - min) / span) * (h - pad * 2) - pad;
    const xOf = (t) => w - ((now - t) / WINDOW_MS) * w;
    // The one sample older than the window stays, so the line enters from the
    // left edge rather than starting part-way across.
    const { samples } = row;
    while (samples.length > 1 && samples[1].t <= now - WINDOW_MS) samples.shift();
    // Where the line crosses the left edge: between the sample that fell out of
    // the window and the first one inside it. Drawn from the old sample's true
    // position it was off the canvas by however old it was — minutes, for a
    // reading that arrived once and then held — and the segment from there to
    // the first real point ran flat across the whole plot.
    const edge = () => {
      const [a, b] = samples;
      if (!b || a.t >= now - WINDOW_MS) return yOf(a.v);
      const f = (now - WINDOW_MS - a.t) / (b.t - a.t);
      return yOf(a.v + (b.v - a.v) * Math.min(1, f));
    };
    // Through every reading at the moment it arrived, then flat to the right
    // edge: the latest reading holds until the board says otherwise.
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(samples[0].t > now - WINDOW_MS ? xOf(samples[0].t) : 0, edge());
      for (const s of samples) if (s.t > now - WINDOW_MS) ctx.lineTo(xOf(s.t), yOf(s.v));
      ctx.lineTo(w, yOf(samples[samples.length - 1].v));
    };

    if (marker && typeof marker.low === 'number' && typeof marker.high === 'number') {
      const top = yOf(Math.max(marker.low, marker.high));
      const bottom = yOf(Math.min(marker.low, marker.high));
      ctx.fillStyle = markerColor + '22';
      ctx.fillRect(0, top, w, Math.max(1, bottom - top));
    }

    if (samples.length) {
      // fill under the trace
      trace();
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = color + '18';
      ctx.fill();

      // the trace
      trace();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    if (marker && typeof marker.threshold === 'number') {
      const y = yOf(marker.threshold);
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.moveTo(0, y); ctx.lineTo(w, y);
      ctx.strokeStyle = markerColor;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function frame(now) {
    if (!alive) return;
    const color = cssColor('--accent', '#2563eb');
    const markerColor = cssColor('--red', '#e5484d');

    for (const row of rows.values()) {
      if (row.kind === 'event') {
        if (now > row.flashUntil) row.vizEl?.querySelector('.chan-flash')?.classList.remove('flash');
        continue;
      }
      if (row.kind !== 'number') continue;
      if (row.canvas) drawTrace(row, color, markerColor, now);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    /** The latest reading of a channel this view shows, or null. */
    value: (name) => (rows.get(name)?.heard ? rows.get(name).current : null),
    destroy() {
      alive = false;
      unsubscribe();
      for (const row of rows.values()) row.el?.remove();
      rows.clear();
    },
  };
}

/** The popover in the header: every channel, as it arrives. */
export function initVisualizer(signalStore) {
  const host = document.getElementById('live-rows');
  if (!host) return null;
  return createChannelView(host, { signalStore, empty: host.querySelector('.live-empty') });
}
