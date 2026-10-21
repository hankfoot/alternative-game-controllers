// The sidebar listing what is on the current screen, so a step can be reached
// without scrolling past the ones before it.
//
// It reads the screen rather than carrying its own copy of the headings: every
// `.block` title and every step title in the active panel, in page order. So a
// step added to the page is in the sidebar without anyone remembering to add
// it, and Sensing, whose steps are written by js/lessons.js, needs nothing of
// its own. A screen with fewer than two things on it (Home, Game) gets no
// sidebar at all — a list of one is a label.
//
// Wide screens keep it beside the content; narrow ones fold it into a closed
// "On this page" at the top of the screen. One piece of markup does both; the
// stylesheet decides which it is, and `open` follows the same breakpoint.

const WIDE = '(min-width: 1220px)';

// Headings, as entries: `level` 2 for a block title, 3 for a step; `n` the
// step's number as drawn on the page, if it has one. Pure, and tested on its own.
export function outline(headings) {
  return headings.map(({ level, text, id, n = null }) => ({
    level, text: text.trim(), id, n,
  }));
}

// Letters and digits, lowercased and hyphenated: "Get a micro:bit" → "get-a-micro-bit".
export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The sidebar links to something with an id. A step that already has one keeps
// it, so a link somebody has to a Sensing step stays good; the rest are named
// after the screen and the title.
function targetFor(heading, screen) {
  const step = heading.closest('.step');
  if (step?.id) return step.id;
  if (heading.id) return heading.id;
  const block = heading.closest('.block');
  if (heading.tagName === 'H2' && block?.id) return block.id;
  heading.id = `${screen}-${slug(titleOf(heading))}`;
  return heading.id;
}

// The title alone: a step's "Optional" badge is part of the heading on the page,
// but in a list of titles it would read as part of the name.
function titleOf(heading) {
  const copy = heading.cloneNode(true);
  copy.querySelectorAll('.opt-badge').forEach((badge) => badge.remove());
  return copy.textContent;
}

function readPanel(panel) {
  const screen = panel.id.replace(/^panel-/, '');
  const headings = [...panel.querySelectorAll('.block-head h2, .step-body > h3')];
  return outline(headings.map((h) => ({
    level: h.tagName === 'H2' ? 2 : 3,
    text: titleOf(h),
    id: targetFor(h, screen),
    n: h.closest('.step')?.querySelector('.step-num')?.textContent ?? null,
  })));
}

export function initToc({ host }) {
  if (!host) return null;
  const list = host.querySelector('ol');
  const details = host.querySelector('details');
  const wide = typeof matchMedia === 'function' ? matchMedia(WIDE) : null;

  let panel = null;
  let targets = []; // [{ id, link }] in page order, for the highlight
  let ticking = false;

  // Beside the content the list is always open, since there is nothing else in
  // that column; folded above it, it starts closed. Also run when the window
  // crosses the breakpoint, so a sidebar that was open does not stay open when
  // it lands on top of the screen.
  const settle = () => { if (details) details.open = !!wide?.matches; };
  wide?.addEventListener('change', settle);

  function render() {
    list.textContent = '';
    targets = [];
    const entries = panel ? readPanel(panel) : [];
    host.hidden = entries.length < 2;
    // The layout makes room for the sidebar only when there is one, and the
    // sidebar takes the screen's colour, so `main` is told both.
    const main = document.querySelector('main');
    main?.setAttribute('data-toc', host.hidden ? 'false' : 'true');
    main?.setAttribute('data-screen', panel ? panel.id.replace(/^panel-/, '') : '');
    if (host.hidden) return;

    for (const entry of entries) {
      const item = document.createElement('li');
      item.className = `toc-item toc-h${entry.level}`;
      const link = document.createElement('a');
      link.href = `#${entry.id}`;
      if (entry.n) {
        const num = document.createElement('span');
        num.className = 'toc-num';
        num.textContent = entry.n;
        link.append(num);
      }
      link.append(document.createTextNode(entry.text));
      item.append(link);
      list.append(item);
      targets.push({ id: entry.id, link });
    }
    highlight();
  }

  // The last entry whose target has scrolled up to the top of the window is the
  // one being read. Measured against the top bar's height, which is where the
  // content actually begins, plus a little so a heading just under the bar
  // counts as reached.
  function highlight() {
    ticking = false;
    if (host.hidden) return;
    const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0) + 40;
    let current = targets[0];
    for (const t of targets) {
      const el = document.getElementById(t.id);
      if (el && el.getBoundingClientRect().top <= top) current = t;
    }
    for (const t of targets) {
      if (t === current) t.link.setAttribute('aria-current', 'location');
      else t.link.removeAttribute('aria-current');
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(highlight);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // On a narrow screen the list closes once a link in it is picked, since the
  // point was to get somewhere and the open list would be sitting on top of it.
  host.addEventListener('click', (e) => {
    if (e.target.closest('a') && details && !wide?.matches) details.open = false;
  });

  settle();
  return {
    show(next) { panel = next; render(); },
    refresh() { render(); },
  };
}
