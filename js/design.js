// The Design screen — the choices a game offers about itself, as opposed to
// the wiring board, which is only ever about your controller.
//
// The split is the whole point of this module existing. Both screens read the
// same sentences off the same option definitions and write through the same
// engine, so nothing here is a second copy of that state; what differs is which
// question is being asked. Controls asks what your object does. Design asks
// what you are flying through. Mixing them made two-thirds of the dropdowns on
// the wiring board things no controller could ever be patched into.
//
// The course settings at the top come from the game and go through the wiring
// engine. Everything below them — what it looks like, what it sounds like, what
// it says — is the theme, which is the same kind of question asked about
// something no enumerated dropdown could hold.

import { createPaintEditor } from './theme/paint-editor.js';
import { audioAssetFromFile, spriteAsset } from './theme/images.js';
import { contentBounds } from './theme/raster.js';
import { SLOTS, sizeOf, cropsToInk } from './theme/defaults.js';
import {
  SOUND_EVENTS, BUILT_IN, RECORDING_CAP_MS, asUpload, isUpload, listenTo,
  startRecording, recordingSupported,
} from './theme/audio.js';
import { drawLevels, drawWaveform } from './theme/waveform.js';
import { FONTS, fontStack, cardPalette } from './theme/theme-store.js';
import { createColourPicker } from './theme/colour-picker.js';
import { newAssetId } from './theme/assets.js';
import { exportBundle, readBundle, downloadBundle } from './theme/portable.js';
import { loadAllRules, saveAllRules } from './rules-store.js';
import { MOTION, RULES, courseFrom } from './games/sidescroller.js';
import { GAMES } from './games/index.js';

// How long Record shows "Get Ready" and fills before it starts listening.
const READY_MS = 1000;

/** One choice, laid out as running prose so it reads as a statement. */
function sentence(...parts) {
  const line = document.createElement('p');
  line.className = 'wiring-sentence';
  for (const part of parts.filter(Boolean)) {
    if (typeof part === 'string') {
      const word = document.createElement('span');
      word.textContent = part;
      line.appendChild(word);
    } else {
      line.appendChild(part);
    }
  }
  return line;
}

function select(choices, value, onPick) {
  const el = document.createElement('select');
  for (const [optionValue, label] of choices) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = label;
    option.selected = optionValue === value;
    el.appendChild(option);
  }
  el.addEventListener('change', () => onPick(el.value));
  return el;
}

/** The same, for the settings that are really numbers wearing words. */
function numberSelect(choices, value, onPick) {
  const nearest = choices.reduce((best, [option]) =>
    Math.abs(Number(option) - value) < Math.abs(Number(best) - value) ? option : best,
  choices[0][0]);
  return select(choices, nearest, (picked) => onPick(Number(picked)));
}

function textInput(value, placeholder, onCommit) {
  const el = document.createElement('input');
  el.type = 'text';
  el.value = value;
  el.placeholder = placeholder;
  el.className = 'theme-text';
  el.addEventListener('input', () => onCommit(el.value));
  return el;
}

function card(title, description, emoji) {
  const section = document.createElement('section');
  section.className = 'settings-card';
  const heading = document.createElement('div');
  heading.className = 'wiring-target-heading';
  if (emoji) {
    const glyph = document.createElement('span');
    glyph.textContent = emoji;
    glyph.setAttribute('aria-hidden', 'true');
    heading.appendChild(glyph);
  }
  const text = document.createElement('div');
  const name = document.createElement('h4');
  name.textContent = title;
  text.appendChild(name);
  if (description) {
    const blurb = document.createElement('p');
    blurb.textContent = description;
    text.appendChild(blurb);
  }
  heading.appendChild(text);
  section.appendChild(heading);
  return section;
}

function group(...children) {
  const block = document.createElement('div');
  block.className = 'settings-group';
  block.append(...children.filter(Boolean));
  return block;
}

const button = (label, className = 'btn btn-soft') => {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
};

/** A glyph on its own, named for anyone who can't see the glyph. */
const iconButton = (glyph, label) => {
  const el = button(glyph, 'sprite-action');
  el.title = label;
  el.setAttribute('aria-label', label);
  return el;
};

// Numbers nobody thinks in, as the handful of values that sound different.
const VOLUMES = [['0.25', 'quietly'], ['0.5', 'at a normal volume'], ['0.85', 'loudly']];

const at = (theme, path) => path.split('.').reduce((value, key) => value?.[key], theme);

export function initDesign({
  hosts, options, theme, assets, images, audio,
  onGameChange, onThemeApplied, onRulesImported, onGameSelected, storage,
}) {
  if (!hosts?.settings || !options) return null;
  let uploads = [];
  // One per slot, so the thumbnails can be redrawn without rebuilding the
  // section — rebuilding it would throw away an editor somebody has open.
  let previews = [];

  const refreshUploads = async () => {
    uploads = (await assets.list()).filter((asset) => asset.kind === 'audio');
  };

  /** Redraws, reloads the images the theme points at, and restarts the music. */
  async function applied() {
    await images.warm(theme.get());
    onThemeApplied?.();
  }

  // --- The course ---------------------------------------------------------
  // The choices the game declares on ports nothing drives: pace and what you
  // fly through, the same under every scheme. How the controls feel is a
  // property of the scheme, and is edited on Controls under each sentence.
  function renderSettings() {
    const host = hosts.settings;
    host.textContent = '';
    const groups = options.settings ?? [];

    if (!groups.length) {
      const empty = document.createElement('div');
      empty.className = 'placeholder';
      const title = document.createElement('p');
      title.className = 'placeholder-title';
      title.textContent = 'Nothing to design yet';
      empty.appendChild(title);
      host.appendChild(empty);
      return;
    }

    for (const definition of groups) {
      const section = card(definition.label, definition.description, definition.emoji);
      for (const port of definition.ports ?? []) {
        const node = port.node ?? definition.id;
        const picked = options.get(node, port.id);
        const block = group();
        for (const option of port.options ?? []) {
          const control = select(option.choices, picked[option.id], (value) => {
            options.set(node, port.id, option.id, value);
          });
          block.appendChild(sentence(option.lead, control, option.trail));
        }
        if (block.childElementCount) section.appendChild(block);
      }
      host.appendChild(section);
    }
  }



  /**
   * Why a drawing was refused, in numbers somebody can act on — or null if size
   * was not the problem.
   *
   * Worth spelling out because the ceiling depends on where the page was opened
   * from: a site double-clicked off the filesystem has no database to write to
   * and falls back to a key per asset under a far tighter cap, which is exactly
   * the situation somebody is in when a photo of the sky will not save.
   */
  function tooBigFor(asset) {
    if (!asset) return null;
    const size = JSON.stringify(asset).length;
    const cap = assets.limit?.();
    if (!cap || size <= cap) return null;
    const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;
    const advice = assets.backend?.() === 'localstorage'
      ? ' Opening this page over http instead of straight off a file gives it a lot more room.'
      : '';
    return `That drawing is about ${kb(size)}, and the limit here is ${kb(cap)}.`
      + ` Try a simpler picture.${advice}`;
  }

  // --- Sprites --------------------------------------------------------------
  // Every slot always has a picture in it: yours if you have drawn or uploaded
  // one, the default otherwise. So there is no empty state here and no choice
  // to make about which to use — you open it and paint over what is there.
  function renderSprites() {
    const host = hosts.sprites;
    if (!host) return;
    host.textContent = '';
    previews = [];

    for (const slot of SLOTS) {
      const path = `scene.${slot.id}.sprite`;
      const tile = document.createElement('div');
      tile.className = 'sprite-slot';
      // A drawing that isn't square gets a thumbnail that isn't either, or it
      // shows as a thin strip in the middle of a square tile — which reads as
      // something being wrong rather than as a different shape. Which way it is
      // out of square matters: widening a tall pillar's tile makes the strip
      // worse, not better.
      const shape = sizeOf(slot.id);
      if (shape.width > shape.height) tile.dataset.shape = 'wide';
      if (shape.height > shape.width) tile.dataset.shape = 'tall';

      const row = document.createElement('div');
      row.className = 'sprite-row';
      const preview = document.createElement('div');
      preview.className = 'sprite-preview';
      const text = document.createElement('div');
      text.className = 'sprite-text';
      const label = document.createElement('span');
      label.className = 'sprite-label';
      // The thumbnail is the icon now, so the emoji beside the name would be a
      // second one saying less.
      label.textContent = slot.label;
      const help = document.createElement('span');
      help.className = 'theme-note';
      help.textContent = slot.help;
      const actions = document.createElement('div');
      actions.className = 'sprite-actions';
      const note = document.createElement('span');
      note.className = 'theme-note';

      function showPreview() {
        const shown = images.get(at(theme.get(), path), slot.id);
        preview.replaceChildren();
        reset.disabled = !at(theme.get(), path);
        if (!shown) return;

        // Cropped to what is actually drawn. The working canvas is a roomy 256
        // square so nobody has to think about fitting their drawing into it,
        // which leaves most of them ringed by empty checkerboard — showing that
        // at thumbnail size wastes the tile and shrinks the drawing to nothing.
        //
        // A slot defined to fill its frame is exempt: there is nothing to crop
        // to, and measuring it means reading every pixel on every brush stroke.
        const whole = { x: 0, y: 0, width: shown.width, height: shown.height };
        const box = (cropsToInk(slot.id) ? contentBounds(shown) : null) ?? whole;
        // A copy rather than the cached canvas itself: that one is what the
        // game draws from every frame, and it must not end up parented here.
        const thumb = document.createElement('canvas');
        thumb.className = 'sprite-thumb';
        thumb.width = box.width;
        thumb.height = box.height;
        thumb.getContext('2d')?.drawImage(
          shown, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height,
        );
        preview.appendChild(thumb);
      }

      // Which record this slot's drawing lives in. Claimed once, synchronously,
      // and reused for every stroke after: reading it back off the theme each
      // time meant a stroke finishing before the previous one had been written
      // still saw an empty slot and claimed a second record, so a drawing ended
      // up scattered across one asset per stroke and the theme pointed at
      // whichever of them was written last.
      let assetId = at(theme.get(), path);

      // Strokes arrive faster than IndexedDB answers, and two writes in flight
      // can land in either order — which showed as the picture on screen being
      // a stroke behind the canvas, or the built-in one reappearing when the
      // theme named a record that hadn't been decoded yet. So writes are run
      // one at a time, and anything asked for mid-write is folded into a single
      // trailing write that captures the canvas as it finally stands.
      let writing = false;
      let pending = null;

      async function writeOnce(canvas, blank) {
        assetId ??= newAssetId('sprite');
        const asset = spriteAsset(canvas, { id: assetId, name: slot.label });
        const saved = asset ? await assets.put(asset) : null;
        if (!saved) {
          note.textContent = tooBigFor(asset)
            // Naming the numbers, because the useful thing to know is how much
            // too big it is — and that the cure may be to open the site over
            // http rather than to redraw anything.
            ?? "That drawing couldn't be saved — storage is full or blocked.";
          return;
        }
        // A wiped canvas is a picture too — an invisible obstacle is a fair
        // thing to want — so it saves rather than reverting to the default.
        note.textContent = blank ? 'Wiped — nothing will be drawn for this one.' : '';
        theme.set(path, saved.id);
        await images.refresh(saved.id);
        showPreview();
        onThemeApplied?.();
      }

      async function save(canvas, { blank }) {
        pending = { canvas, blank };
        if (writing) return;
        writing = true;
        try {
          while (pending) {
            const next = pending;
            pending = null;
            await writeOnce(next.canvas, next.blank);
          }
        } finally {
          writing = false;
        }
      }

      // Opening the window is all this does now — no toggling, because a modal
      // dialog is the only thing on screen while it is up, so there is no
      // second click on this button to take.
      const edit = iconButton('✏️', `Draw ${slot.label.toLowerCase()}`);
      edit.setAttribute('aria-haspopup', 'dialog');
      edit.addEventListener('click', () => {
        createPaintEditor({
          size: sizeOf(slot.id),
          source: images.get(at(theme.get(), path), slot.id),
          title: slot.label,
          onCommit: save,
          // Hands back the built-in drawing for this slot, so the editor can
          // put it on the canvas. It stays a *drawing* rather than clearing the
          // slot's record: you asked to start from the original, not to stop
          // having one of your own.
          onReset: () => images.builtIn(slot.id),
          // The dialog takes itself down; this is only for putting focus back
          // where it came from, which the browser does not do on its own.
          onClose: () => edit.focus(),
        });
      });

      const reset = iconButton('↺', 'Put the default picture back');
      reset.addEventListener('click', async () => {
        theme.set(path, null);
        note.textContent = '';
        await applied();
        showPreview();
      });

      actions.append(edit, reset);
      text.append(label, help);
      row.append(preview, text, actions);
      tile.append(row, note);
      host.appendChild(tile);
      previews.push(showPreview);
      showPreview();
    }
  }

  // --- Sound ----------------------------------------------------------------
  // Every sound is a recording. There is nothing built in to fall back on, so
  // each row is either one of yours or the word "nothing" — and the way to
  // change that is a microphone or a file, side by side, because which of the
  // two is easier depends entirely on who is sitting there.
  // `record: false` drops the microphone. Music is the one row where it makes
  // no sense — a looped backing track is not something you hum into a laptop.
  // `event` is which moment this row is for — 'launch', 'music' and so on. The
  // row needs it because "the one it came with" is not a reference to anything;
  // it is resolved against the manifest at the moment of playing.
  function soundRow({ lead, event, current, onPick, record: canRecord = true }) {
    const row = document.createElement('div');
    row.className = 'sound-row';

    const line = document.createElement('p');
    line.className = 'wiring-sentence';
    const name = document.createElement('strong');
    name.className = 'sound-name';

    const note = document.createElement('span');
    note.className = 'theme-note';

    // The sound itself, drawn: its shape before you hear it, a playhead while
    // you do, and the microphone while you record over it. It is also the play
    // button — the thing you would reach for to hear a sound is a picture of
    // that sound — so it carries the play glyph and an accessible name.
    const wave = document.createElement('button');
    wave.type = 'button';
    wave.className = 'sound-wave';
    const glyph = document.createElement('span');
    glyph.className = 'sound-wave-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    wave.append(glyph, canvas);

    let peaks = null;
    // While a preview runs: when it started and how long it is, for the playhead.
    let playing = null;
    let playhead = null;
    // While recording: the microphone's recent loudness, newest last.
    let levels = null;

    function redraw() {
      if (levels) drawLevels(canvas, levels);
      else drawWaveform(canvas, peaks, { progress: playhead });
    }
    // Drawn again at its new width when the card reflows, since a canvas
    // doesn't stretch its bars, it smears them.
    new ResizeObserver(redraw).observe(canvas);

    function showPlaying(on) {
      glyph.textContent = on ? '■' : '▶';
      const label = on ? 'Stop' : 'Hear it';
      wave.title = label;
      wave.setAttribute('aria-label', label);
      wave.classList.toggle('sound-wave-playing', on);
    }
    showPlaying(false);

    function stopPreview() {
      playing?.handle?.stop();
      playing = null;
      playhead = null;
      showPlaying(false);
      redraw();
    }

    function sweep() {
      if (!playing?.duration) return;
      playhead = Math.min(1, (performance.now() - playing.started) / (playing.duration * 1000));
      redraw();
      if (playhead < 1) requestAnimationFrame(sweep);
    }

    // Recording is the one control with a consequence, so it is the one that
    // counts down and fills up rather than just changing its word: the count
    // says when it starts listening, and the fill how long it has left.
    const record = button('● Record');
    record.classList.add('sound-record');
    let recorder = null;
    // Whether the count is running. It sits apart from `recorder`, which is only
    // set once the count finishes — so pressing during the count has something
    // to check that says "not yet, but on its way".
    let counting = false;

    function showRecord(text, label = text) {
      record.textContent = text;
      record.setAttribute('aria-label', label);
    }

    const clear = button('✕', 'icon-btn');
    clear.title = 'Silence this';
    clear.setAttribute('aria-label', 'Silence this');
    const revert = button('↺', 'icon-btn');
    revert.title = 'Back to the default sound';
    revert.setAttribute('aria-label', 'Back to the default sound');

    async function loadShape() {
      const id = current();
      const shape = id === 'none' ? null : await audio?.peaks(id, event);
      // The row may have moved on to another sound while this one decoded.
      if (current() !== id) return;
      peaks = shape ?? null;
      redraw();
    }

    function sync() {
      const id = current();
      const mine = isUpload(id);
      const built = id === BUILT_IN;
      name.textContent = mine
        ? (uploads.find((a) => asUpload(a.id) === id)?.name ?? 'your recording')
        : (built ? 'the default sound' : 'nothing');
      // The label truncates, so the full name has to live somewhere it can
      // still be read.
      name.title = mine ? name.textContent : '';
      name.classList.toggle('sound-name-empty', !mine && !built);
      wave.disabled = !mine && !built;
      clear.hidden = id === 'none';
      revert.hidden = built;
      // The row's sound just changed under a preview that is still running.
      if (playing) stopPreview();
      peaks = null;
      redraw();
      loadShape();
    }

    // Saves what was recorded. Reached both from pressing Stop and from the
    // recording reaching its cap on its own, so it guards against running twice.
    async function finish(started) {
      if (recorder !== started) return;
      recorder = null;
      const blob = await started.stop();
      stopListening();
      record.classList.remove('sound-recording');
      record.style.removeProperty('--fill');
      showRecord('● Record');
      note.textContent = 'Saving…';
      const saved = await saveSound(new File([blob], 'Recording', { type: blob.type }), 'your recording');
      note.textContent = saved ? '' : "That recording couldn't be saved.";
      if (saved) onPick(asUpload(saved.id));
      sync();
    }

    let listening = null;
    function stopListening() {
      listening?.close();
      listening = null;
      levels = null;
      redraw();
    }

    function listen(started) {
      listening = listenTo(started.stream);
      levels = [];
      const begun = performance.now();
      const tick = () => {
        if (recorder !== started) return;
        const elapsed = performance.now() - begun;
        record.style.setProperty('--fill', `${Math.min(100, (elapsed / RECORDING_CAP_MS) * 100)}%`);
        showRecord(`■ Stop ${Math.ceil(elapsed / 1000)}s`, 'Stop recording');
        if (listening) {
          levels.push(listening.level());
          if (levels.length > 400) levels.shift();
        }
        redraw();
        requestAnimationFrame(tick);
      };
      tick();
    }

    record.addEventListener('click', async () => {
      audio?.resume();
      if (counting) {
        // Cancelled before it ever started listening. `beforeStart` sees this
        // flag drop, closes the microphone and records nothing, and the branch
        // that awaited it does the tidying up.
        counting = false;
        return;
      }
      if (recorder) {
        finish(recorder);
        return;
      }
      note.textContent = '';
      if (playing) stopPreview();
      // Asking for the microphone happens first and takes an unpredictable
      // moment — which is why a press of ● could seem to do nothing: by the time
      // it was listening you had already said the thing. So permission is
      // settled first, then a moment to get ready, and only then does it start.
      counting = true;
      record.disabled = true;
      record.classList.add('sound-recording');
      showRecord('…', 'Getting the microphone ready');

      const started = await startRecording({
        async beforeStart() {
          record.disabled = false;
          // A bar filling across the button rather than numbers: the end of
          // the fill is the moment it starts listening, which a glance at a
          // bar shows better than reading a count does. The fill is a CSS
          // animation and the wait a timer, so neither depends on frames.
          showRecord('Get Ready', 'Getting ready to record — press to cancel');
          record.style.setProperty('--ready', `${READY_MS}ms`);
          record.classList.add('sound-readying');
          await new Promise((wake) => setTimeout(wake, READY_MS));
          record.classList.remove('sound-readying');
          return counting;
        },
      });

      const stopped = !counting;
      counting = false;
      record.disabled = false;

      if (started.error || started.cancelled || stopped) {
        record.classList.remove('sound-recording', 'sound-readying');
        record.style.removeProperty('--fill');
        showRecord('● Record');
        note.textContent = started.error ?? '';
        return;
      }

      recorder = started;
      listen(started);
      // The cap stops it on its own; this is how the row hears about it.
      started.ended.then(() => finish(started));
    });

    const upload = document.createElement('label');
    upload.className = 'btn btn-soft';
    upload.textContent = 'Use file';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'audio/*';
    file.className = 'visually-hidden-file';
    file.addEventListener('change', async () => {
      const [chosen] = file.files ?? [];
      if (!chosen) return;
      note.textContent = 'Reading…';
      const saved = await saveSound(chosen, chosen.name);
      file.value = '';
      note.textContent = saved ? '' : "That file couldn't be saved — try a shorter one.";
      if (saved) onPick(asUpload(saved.id));
      sync();
    });
    upload.appendChild(file);

    wave.addEventListener('click', () => {
      audio?.resume();
      if (playing) {
        stopPreview();
        return;
      }
      const preview = { handle: null, started: 0, duration: 0 };
      preview.handle = audio?.play(current(), event, {
        onStart: (duration) => {
          preview.started = performance.now();
          preview.duration = duration;
          if (playing === preview) sweep();
        },
        onEnded: () => {
          if (playing === preview) stopPreview();
        },
      }) ?? null;
      if (!preview.handle) return;
      playing = preview;
      showPlaying(true);
    });
    clear.addEventListener('click', () => {
      onPick('none');
      sync();
    });
    revert.addEventListener('click', () => {
      onPick(BUILT_IN);
      sync();
    });

    line.append(document.createTextNode(lead), name);

    // The sentence on top, then the sound and what you can do to it side by
    // side. The note drops underneath, and only when there is something to say.
    const actions = document.createElement('div');
    actions.className = 'sound-actions';
    actions.append(...(canRecord ? [record] : []), upload, revert, clear);

    const body = document.createElement('div');
    body.className = 'sound-body';
    body.append(wave, actions);

    row.append(line, body, note);
    sync();
    return row;
  }

  /** Stores a recording or an uploaded file, and refreshes the known list. */
  async function saveSound(file, name) {
    const asset = await audioAssetFromFile(file, name);
    const saved = asset ? await assets.put(asset) : null;
    if (saved) {
      await refreshUploads();
      audio?.forget(saved.id);
    }
    return saved;
  }

  function renderSound() {
    const host = hosts.sound;
    if (!host) return;
    host.textContent = '';
    const current = theme.get();

    const effects = card(
      'Sounds',
      recordingSupported()
        ? 'Record them yourself, or bring in files you already have.'
        : 'This browser cannot record, so bring in files you already have.',
      '🔊',
    );
    const block = group();
    for (const [event, lead] of SOUND_EVENTS) {
      block.appendChild(soundRow({
        lead: `${lead} `,
        event,
        current: () => theme.get().sound[event],
        // Deliberately silent. `onPick` also fires the moment an upload or a
        // recording finishes saving, so playing here meant every file you
        // brought in announced itself — including a ten-second one, with no way
        // to stop it. Hearing it is what the ▶ beside this is for.
        onPick: (value) => theme.set(`sound.${event}`, value),
      }));
    }
    effects.appendChild(block);
    host.appendChild(effects);

    const music = card('Music', 'One recording, looped for as long as you play.', '🎼');
    music.appendChild(group(
      soundRow({
        lead: 'While you play, loop ',
        event: 'music',
        record: false,
        current: () => theme.get().music.track,
        onPick: (value) => {
          theme.set('music.track', value);
          onThemeApplied?.();
        },
      }),
      sentence(
        'Play it',
        numberSelect(VOLUMES, current.music.volume, (value) => {
          theme.set('music.volume', value);
          onThemeApplied?.();
        }),
      ),
    ));
    host.appendChild(music);
  }

  // --- Words ----------------------------------------------------------------
  // The card is edited on a copy of itself. It used to be six form rows —
  // "Before a round it says", "then", "and, in place of the control hint," —
  // stacked above a preview of the very thing those rows described, so the one
  // artefact appeared twice and the labels did the work of showing which line
  // was which. Typing on the card instead makes the labels unnecessary and the
  // preview redundant in one move.
  const FACES = [
    ['ready', 'Before a round', { title: 'text.title', body: 'text.body', button: 'text.button' }],
    ['over', 'After a crash', { title: 'text.over', body: 'text.overBody', button: 'text.overButton' }],
  ];
  let face = 'ready';

  function renderText() {
    const host = hosts.text;
    if (!host) return;
    host.textContent = '';

    // Which of the card's two faces you are looking at. A switch rather than
    // both at once: they are the same card in two moments, and showing one
    // keeps the thing on screen the size the game draws it.
    const faces = document.createElement('div');
    faces.className = 'face-switch';
    faces.setAttribute('role', 'group');
    faces.setAttribute('aria-label', 'Which card to write');

    const sheet = document.createElement('div');
    sheet.className = 'menu-sheet';

    function line(className, path, placeholder, label) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = `menu-line ${className}`;
      input.value = at(theme.get(), path) ?? '';
      input.placeholder = placeholder;
      input.setAttribute('aria-label', label);
      // A text field is a fixed box that scrolls its contents, so a long line
      // ran out under its own right edge — worst on the button, where the edge
      // is a filled pill. The game draws that pill around the words, so the
      // field here grows with them too. `size` counts characters rather than
      // measuring them, which is close enough for a field you are typing in and
      // works everywhere; `field-sizing` in the stylesheet makes it exact where
      // the browser has it.
      const fit = () => {
        input.size = Math.max(6, (input.value || input.placeholder).length);
      };
      fit();
      input.addEventListener('input', () => {
        fit();
        theme.set(path, input.value);
      });
      return input;
    }

    function paintSheet() {
      const shown = theme.get();
      const [, , paths] = FACES.find(([id]) => id === face);
      const crashed = face === 'over';
      // The same palette the canvas works out from the same one colour, so the
      // card here and the card there cannot drift apart.
      const palette = cardPalette(shown.overlay);
      sheet.style.fontFamily = fontStack(shown.font);
      sheet.style.background = shown.overlay;
      sheet.style.color = palette.title;
      sheet.style.borderColor = palette.border;

      const parts = [
        line('menu-title', paths.title, crashed ? 'Game over' : 'Ready?',
          crashed ? 'Heading after a crash' : 'Heading before a round'),
      ];
      if (crashed) {
        // Shown, not editable: the game writes the number you actually got.
        const score = document.createElement('p');
        score.className = 'menu-score';
        score.textContent = '12';
        score.title = 'The game fills this in';
        parts.push(score);
      }
      parts.push(
        line('menu-body', paths.body, crashed ? 'Nice flying' : 'Use your controller or the keys',
          'The line underneath'),
        line('menu-button', paths.button, crashed ? 'Go again' : 'Tap to start', 'The button'),
      );
      sheet.replaceChildren(...parts);

      // Stated outright rather than derived from `currentColor`: in a
      // background, `currentColor` resolves against the element's own text
      // colour, so a pill that set both came out one flat shape.
      const pill = sheet.querySelector('.menu-button');
      pill.style.background = palette.buttonFill;
      pill.style.color = palette.buttonInk;
      const score = sheet.querySelector('.menu-score');
      if (score) score.style.color = palette.body;
    }

    for (const [id, label] of FACES) {
      const tab = button(label, 'face-btn');
      tab.setAttribute('aria-pressed', String(id === face));
      tab.addEventListener('click', () => {
        face = id;
        [...faces.children].forEach((other) =>
          other.setAttribute('aria-pressed', String(other === tab)));
        paintSheet();
      });
      faces.appendChild(tab);
    }

    // Each face is listed in itself, so the choice is made by looking at it
    // rather than by reading a word for it.
    const fontPicker = select(FONTS.map(([id, label]) => [id, label]), theme.get().font, (value) => {
      theme.set('font', value);
      paintSheet();
    });
    fontPicker.classList.add('font-picker');
    [...fontPicker.options].forEach((option) => {
      option.style.fontFamily = fontStack(option.value);
    });

    // The same widget the paint editor uses, so the card's colour is chosen the
    // way a brush colour is rather than from a list of two.
    const cardColour = createColourPicker({
      value: theme.get().overlay,
      label: 'Card colour',
      onPick: (value) => {
        theme.set('overlay', value);
        paintSheet();
      },
    });

    const style = sentence('Typeface', fontPicker, 'on a', cardColour.element, 'card');

    paintSheet();
    // Straight into the step. A card round this with "What the menu says" on it
    // was a second title over the step's own, and a second border round a thing
    // that is already a card.
    host.append(faces, sheet, group(style));
  }

  // --- Taking it with you ---------------------------------------------------
  /**
   * Saving and opening a whole look, from the top bar.
   *
   * Bound once rather than rendered, because these controls are not part of any
   * screen — they sit above all of them and are about everything you have made.
   * That is also why "start over" is not here: it throws work away, and a
   * one-click discard next to the tab bar is a mistake waiting to be made. It
   * lives on the Design screen, where you can see what you are discarding.
   */
  function bindShare() {
    const note = hosts.shareNote;
    const save = hosts.exportBtn;
    const file = hosts.importFile;
    if (!save || !file) return;

    let clearNote = null;
    const report = (message, { sticky = false } = {}) => {
      if (!note) return;
      note.textContent = message;
      clearTimeout(clearNote);
      // Cleared after a moment: it sits in the top bar, where a message that
      // stayed would be a permanent piece of furniture describing something you
      // did once. An error stays put — that one has to be read.
      if (!sticky) clearNote = setTimeout(() => { note.textContent = ''; }, 4000);
    };

    save.addEventListener('click', async () => {
      const bundle = await exportBundle({
        theme: theme.get(),
        assets,
        game: {
          selected: options.gameId,
          options: options.exportAll(),
          rules: loadAllRules(storage),
        },
      });
      downloadBundle(bundle, 'game-theme.json');
      report('Saved.');
    });

    file.addEventListener('change', async () => {
      const [chosen] = file.files ?? [];
      if (!chosen) return;
      report('Reading…');
      let parsed = null;
      try {
        parsed = JSON.parse(await chosen.text());
      } catch {
        report("That file couldn't be read.", { sticky: true });
        return;
      }
      file.value = '';
      const bundle = readBundle(parsed);
      if (bundle.error) {
        report(bundle.error, { sticky: true });
        return;
      }
      // Counted rather than discarded: an oversized drawing that fails to store
      // leaves the theme pointing at a record that is not there, and without
      // this the only symptom is a piece of the imported look quietly missing.
      let refused = 0;
      for (const asset of bundle.assets) {
        if (!await assets.put(asset)) refused += 1;
      }
      saveAllRules(storage, bundle.game.rules);
      // The scheme first: the options and sentences being applied belong to it.
      if (bundle.game.selected) onGameSelected?.(bundle.game.selected);
      options.importAll(bundle.game.options);
      onRulesImported?.();
      theme.replace(bundle.theme);
      await refreshUploads();
      await applied();
      // Drawn again now the file's drawings are decoded. The replace above
      // already redrew, but before they were, so every card showed the
      // built-in art until the page was reloaded.
      renderTheme();
      renderSettings();
      report(refused
        ? `Loaded, but ${refused} ${refused === 1 ? 'drawing was' : 'drawings were'}`
          + ' too big to store — those pieces show the built-in art.'
        : 'Loaded.', { sticky: refused > 0 });
    });
  }

  /**
   * The one destructive control, in the head of everything it undoes. It asks
   * first, saying what goes, since there is no getting any of it back.
   */
  function renderReset(said = '') {
    const host = hosts.share;
    if (!host) return;
    const note = document.createElement('span');
    note.className = 'theme-note';
    note.textContent = said;

    const reset = button('Start over');
    reset.addEventListener('click', () => {
      note.textContent = 'Clear every drawing, sound and line of text?';
      const confirm = button('Clear them', 'btn btn-danger');
      const keep = button('Keep them');
      confirm.addEventListener('click', async () => {
        theme.reset();
        await applied();
        renderReset('Back to the original look.');
      });
      keep.addEventListener('click', () => renderReset());
      host.replaceChildren(note, keep, confirm);
      keep.focus();
    });

    host.replaceChildren(note, reset);
  }

  function mountPreview() {
    const host = hosts.preview;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'theme-preview-canvas';
    canvas.width = RULES.width;
    canvas.height = RULES.height;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A preview of the game with your drawings in it.');
    host.replaceChildren(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // No overlay: the menu card belongs to a real round, and here it would sit
    // over the very drawings this is meant to show.
    const render = GAMES[0].createRenderer(ctx, { drawOverlay: () => {} }, {
      theme: () => theme.get(),
      images,
    });

    // A score the preview pretends to be on, so that "speeds up sharply" and
    // "holds that pace" are visibly different — at zero they are identical, and
    // a setting that does nothing when you change it reads as a broken control.
    const PRETEND_SCORE = 8;

    // The band a gap's centre may sit in, the same one the game allows: far
    // enough from both edges that the bar either side is worth flying around.
    const edge = RULES.gateGap / 2 + RULES.gateMargin;
    const lowest = RULES.groundY - edge;

    // Fixed per obstacle rather than random, so the run doesn't reshuffle
    // itself on every frame.
    const heightFor = (index) => {
      const noise = Math.sin(index * 78.233) * 43758.5453;
      return edge + (noise - Math.floor(noise)) * (lowest - edge);
    };

    // The course as the settings above this canvas describe it. Read fresh each
    // frame rather than captured: the settings are edited a few inches away, and
    // a preview that needed remounting to notice would be worse than none.
    //
    // Both cards in one bag, because `courseFrom` answers for the whole course
    // and the split between "speed" and "the course" is a matter of which card
    // a control is printed on, not of which numbers it moves.
    const course = () => courseFrom({
      ...options.get('speed', 'pace'),
      ...options.get('world', 'obstacles'),
    }, PRETEND_SCORE);

    // How an obstacle moves, at the middle of the setting's range, each one
    // out of step with its neighbours.
    const swingFor = (index, seconds) => {
      const motion = MOTION[course().motion];
      if (!motion) return 0;
      const amp = (motion.amp[0] + motion.amp[1]) / 2;
      const period = (motion.period[0] + motion.period[1]) / 2;
      return amp * Math.sin((seconds * Math.PI * 2) / period + index * 2.1);
    };

    let distance = 0;
    let last = performance.now();

    function frame(now) {
      requestAnimationFrame(frame);
      // Only while it is on screen: the Design panel is hidden most of the
      // time, and a hidden canvas repainting sixty times a second is rude.
      if (host.offsetParent === null) {
        last = now;
        return;
      }
      const shaped = course();
      distance += Math.min((now - last) / 1000, 0.05) * shaped.speed;
      last = now;

      // Wider than the game spaces them: this canvas is a shop window, and
      // obstacles at playing density leave no clear view of what is behind them.
      const spacing = shaped.spacing * 1.6;
      const across = Math.ceil(RULES.width / spacing) + 2;
      const passed = Math.floor(distance / spacing);

      // Flown rather than parked. The craft's own animation — the lean, the
      // squash, the wake behind it — only happens while a round is running, so
      // a preview pinned to `ready` was quietly hiding half of what the drawings
      // look like in motion. A slow sine is enough to show all of it.
      const seconds = now / 1000;
      const swing = Math.sin(seconds * 0.9);
      const y = RULES.groundY * (0.45 + swing * 0.22);

      render({
        phase: 'playing',
        score: PRETEND_SCORE,
        distance,
        player: {
          y,
          velocity: 0,
          value: 0.5,
          // Climbing counts as working, which is what sheds a wake.
          thrusting: swing > 0.35,
          sinking: false,
        },
        gates: Array.from({ length: across }, (_, i) => ({
          x: RULES.width + (i - 1) * spacing - (distance % spacing),
          gap: shaped.gap,
          kind: shaped.shape === 'slalom'
            // The slalom is the two one-sided shapes taking turns, the same way
            // the game alternates them.
            ? ((passed + i) % 2 ? 'floor' : 'ceiling')
            : shaped.shape,
          gapY: heightFor(passed + i) + swingFor(passed + i, seconds),
          scored: false,
        })),
      }, now);
    }
    requestAnimationFrame(frame);
  }

  function renderTheme() {
    renderSprites();
    renderSound();
    renderText();
    renderReset();
  }

  renderSettings();
  // Bound once, not rendered: these controls live in the top bar and outlive
  // every redraw down here.
  bindShare();
  refreshUploads().then(renderTheme);
  renderTheme();
  mountPreview();

  // Re-read rather than patch: a scheme swap can change which settings exist.
  onGameChange?.(renderSettings);
  // Only the wholesale changes redraw the theme controls. A color picker being
  // dragged must not have the element under the cursor replaced mid-drag.
  theme.subscribe((_, reason) => {
    if (reason === 'replace' || reason === 'scene') renderTheme();
  });

  return {
    /**
     * Redraws the thumbnails. The cards are built before the drawings they
     * name have finished loading — the store is asynchronous and the screen is
     * not — so on a cold start every slot shows its built-in picture and would
     * go on showing it, because nothing else here ever looks at the cache again.
     */
    refreshPreviews() {
      previews.forEach((redraw) => redraw());
    },
  };
}
