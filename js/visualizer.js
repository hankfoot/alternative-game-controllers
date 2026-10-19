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

const HISTORY = 120;

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
      history: new Array(HISTORY).fill(null),
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
      row.vizEl?.querySelector('.chan-num')?.replaceChildren(fmt(value));
    }
  });

  // --- Drawing --------------------------------------------------------------

  // Size a canvas to its displayed box. Returns false if it has no size (hidden).
  function fit(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  const cssColor = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  function drawTrace(row, color, markerColor) {
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
    const stepX = w / (HISTORY - 1);
    const yOf = (v) => h - ((v - min) / span) * (h - pad * 2) - pad;
    const pt = (i) => ({ x: i * stepX, y: yOf(row.history[i] ?? min) });

    ctx.clearRect(0, 0, w, h);

    if (marker && typeof marker.low === 'number' && typeof marker.high === 'number') {
      const top = yOf(Math.max(marker.low, marker.high));
      const bottom = yOf(Math.min(marker.low, marker.high));
      ctx.fillStyle = markerColor + '22';
      ctx.fillRect(0, top, w, Math.max(1, bottom - top));
    }

    // fill under the trace
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = color + '18';
    ctx.fill();

    // the trace
    ctx.beginPath();
    for (let i = 0; i < HISTORY; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

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
      row.history.push(row.heard ? row.current : null);
      row.history.shift();
      if (row.canvas) drawTrace(row, color, markerColor);
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
