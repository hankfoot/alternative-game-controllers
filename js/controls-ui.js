// The Controls screen: sentences, in dropdowns.
//
// "When [Button A] [is pressed], flap." The scheme decides which sentences
// there are — one per control it steers with, already filled in with
// something that needs no wiring — and the person decides how each one is
// triggered. For a reading, the sentence also carries the number it has to
// cross or the range it steers across, drawn live underneath against the
// line, so the number is set by looking rather than guessing. The sentences
// make a program (js/controls-codegen.js) to copy into MakeCode.
//
// Thin on purpose: what a sentence means and what it compiles to is the
// generator's, tested without a DOM. This file only moves choices between the
// selects and the stored rules, and keeps the code block current.

import {
  canDrive, groupedInputChoices, inputChoice, normalizeRule, offered, rulesCode, rulesParts, sentencesFor, usesRange, whenChoicesFor,
} from './controls-codegen.js';
import { controlsFor } from './game-facade.js';
import { describeLoad, streamLoad, variantFor } from './builder.js';
import { channelInfo } from './channels.js';
import { loadRules, saveRules } from './rules-store.js';
import { createChannelView } from './visualizer.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function option(value, label, selected) {
  const node = el('option', null, label);
  node.value = value;
  node.selected = value === selected;
  return node;
}

function select(choices, value, onPick) {
  const node = el('select');
  for (const [optionValue, label] of choices) node.appendChild(option(optionValue, label, value));
  node.addEventListener('change', () => onPick(node.value));
  return node;
}

/** A select whose choices sit under headings: `[[label, [[value, text], …]], …]`. */
function groupedSelect(groups, value, onPick) {
  const node = el('select');
  for (const [label, choices] of groups) {
    const group = el('optgroup');
    group.label = label;
    for (const [optionValue, text] of choices) group.appendChild(option(optionValue, text, value));
    node.appendChild(group);
  }
  node.addEventListener('change', () => onPick(node.value));
  return node;
}

// A number field held to what its input can read. Typing is not clamped
// mid-keystroke — "-2" on the way to "-20" would be snapped to 0 — but the
// value handed on is, and the field is corrected once it is left.
function numberInput(value, { min, max }, onCommit) {
  const node = el('input');
  node.type = 'number';
  node.step = 'any';
  node.min = String(min);
  node.max = String(max);
  node.value = String(value);
  const clamp = (v) => Math.min(max, Math.max(min, Number(v)));
  node.addEventListener('input', () => { if (node.value !== '' && Number.isFinite(Number(node.value))) onCommit(clamp(node.value)); });
  node.addEventListener('change', () => { if (node.value !== '' && Number.isFinite(Number(node.value))) node.value = String(clamp(node.value)); });
  return node;
}

// How a control reads at the end of a sentence: what it does to the craft,
// in the scheme's own words where it has them.
const PHRASES = {
  flap: 'flap',
  thrust: 'thrust',
  up: 'move up',
  down: 'move down',
  paddle: 'sets how high the craft flies',
  advance: 'start the game',
};
const controlPhrase = (rule) => PHRASES[rule.control] ?? rule.control;

export function initControlsUI({ elements, gameHost, signalStore, storage, options = null }) {
  const { list, code, warn, hookup = null, tune = null } = elements;
  if (!list || !code || !gameHost || !signalStore) return null;

  const listeners = new Set();
  let gameId = gameHost.activeGame()?.id ?? '';
  // One per control the scheme steers with — never more, never fewer.
  let rules = sentencesFor(gameHost.activeGame(), loadRules(storage, gameId));
  let views = [];

  const targets = () => gameHost.activeGame()?.targets ?? [];
  const valid = () => rules.map((rule) => normalizeRule(rule, targets())).filter(Boolean);
  const parts = () => rulesParts(rules, targets());

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function persist() {
    saveRules(storage, gameId, rules);
    // The channels the program will send, so the popover and the prompt know
    // what to expect before the board has said anything.
    signalStore.setPlannedChannels(parts().flatMap((part) =>
      part.channels.map((channel) => ({ channel, kind: part.kind, mode: part.label ?? null, form: part.form ?? null }))));
    renderOutput();
    notify();
  }

  // --- The sentences --------------------------------------------------------

  /** The kind of control a sentence ends with: press, hold or level. */
  const kindOf = (rule) => controlsFor(targets()).find((c) => c.name === rule.control)?.kind ?? 'press';

  /**
   * The inputs a sentence may start with, in their groups: the ones that can
   * drive its control, with one pin on offer — P0 for the first sentence, P1
   * for the second — and without the board's own buttons or an analog pin
   * (see `offered`), minus the other ways of reading a pin another sentence
   * already reads.
   */
  function inputGroupsFor(rule) {
    const kind = kindOf(rule);
    const slot = rules.indexOf(rule);
    const taken = new Map();
    for (const other of rules) {
      const choice = inputChoice(other.input);
      if (other !== rule && choice?.pin && !taken.has(choice.pin)) taken.set(choice.pin, choice.mode);
    }
    return groupedInputChoices((choice) => canDrive(choice, kind)
      && offered(choice, slot)
      && (!choice.pin || !taken.has(choice.pin) || taken.get(choice.pin) === choice.mode))
      .map(([label, choices]) => [label, choices.map((choice) => [choice.id, choice.label])]);
  }

  function setInput(rule, inputId) {
    const choice = inputChoice(inputId);
    rule.input = inputId;
    // A number that suited the old input is meaningless for the new one — a
    // light level's 100 is nothing on an acceleration — so the sentence
    // starts again from the new input's range.
    delete rule.low;
    delete rule.high;
    delete rule.threshold;
    const whens = whenChoicesFor(choice.family, kindOf(rule)).map(([id]) => id);
    setWhen(rule, whens.includes(rule.when) ? rule.when : whens[0]);
  }

  function setWhen(rule, when) {
    rule.when = when;
    // Fill in the numbers a reading's sentence needs, keeping any that fit.
    const normalized = normalizeRule(rule, targets());
    if (normalized) Object.assign(rule, normalized, { id: rule.id });
  }

  /**
   * The numbers a reading's sentence carries — "above 120 lux", "from -40 to
   * 40 °" — as fields in step 5, where they are tuned against the live
   * reading, and as plain words in step 2, where the sentence is chosen.
   * Returns the nodes, and a function giving the marker for the live view.
   */
  function numbersOf(rule, editable) {
    const choice = inputChoice(rule.input);
    if (choice.family !== 'number') return { nodes: [], marker: () => null };
    const info = channelInfo(choice.catalogue);
    const unit = info.unit ? ` ${info.unit}` : '';
    const span = { min: info.min ?? 0, max: info.max ?? 1 };
    const field = (key) => (editable
      ? numberInput(rule[key], span, (value) => { rule[key] = value; changed(rule); })
      : el('strong', 'rule-number', String(rule[key])));
    if (usesRange(rule.when)) {
      return {
        nodes: [' ', field('low'), ' to ', field('high'), unit],
        marker: () => ({ low: rule.low, high: rule.high }),
      };
    }
    return { nodes: [' ', field('threshold'), unit], marker: () => ({ threshold: rule.threshold }) };
  }

  /** The sentence, with its numbers either fixed words or fields. */
  function sentenceLine(rule, { choosing }) {
    const choice = inputChoice(rule.input);
    const line = el('p', 'wiring-sentence rule-sentence');
    // A steer reads "Pitch, from -40 to 40 °, sets how high the craft flies";
    // everything else reads "When Button A is pressed, flap."
    const steering = kindOf(rule) === 'level';
    if (!steering) line.append('When ');
    if (choosing) {
      line.appendChild(groupedSelect(inputGroupsFor(rule), rule.input, (value) => {
        setInput(rule, value);
        persist();
        render();
      }));
    } else {
      line.appendChild(el('strong', null, channelInfo(choice.catalogue).label ?? rule.input));
    }
    line.append(steering ? ', from' : ' ');
    const whens = whenChoicesFor(choice.family, kindOf(rule));
    // A choice of one is not a choice; it reads as words instead.
    if (steering) {
      // nothing: "from … to …" says it
    } else if (choosing && whens.length > 1) {
      line.appendChild(select(whens, rule.when, (value) => {
        setWhen(rule, value);
        persist();
        render();
      }));
    } else {
      line.append(whens.find(([id]) => id === rule.when)?.[1] ?? whens[0]?.[1] ?? '');
    }
    const numbers = numbersOf(rule, !choosing);
    line.append(...numbers.nodes);
    line.append(', ');
    // One span for the control and the words after it, so the sentence's
    // spacing between parts does not land in front of the full stop.
    const ending = el('span', 'rule-ending');
    ending.appendChild(el('strong', 'rule-control', controlPhrase(rule)));
    ending.append(kindOf(rule) === 'hold' ? ' for as long as it lasts.' : '.');
    line.appendChild(ending);
    return { line, marker: numbers.marker };
  }

  // Step 2: choosing. Only the sentence — what to read, and when — since
  // there is no code on the board yet to watch or tune.
  function renderRule(rule) {
    const row = el('div', 'rule');
    row.dataset.id = rule.id;
    row.appendChild(sentenceLine(rule, { choosing: true }).line);
    return row;
  }

  // Step 4: what to clip where, for the sentences as they stand. It sat
  // under each sentence while it was being chosen, which is before there
  // is anything on the board to wire up.
  function renderHookup() {
    if (!hookup) return;
    hookup.textContent = '';
    const items = rules.map((rule) => {
      const choice = inputChoice(rule.input);
      const variant = choice && variantFor(choice.catalogue, choice.mode);
      if (!variant?.build) return null;
      const info = channelInfo(choice.catalogue);
      const item = el('li', 'hookup-item');
      const head = el('p', 'hookup-head');
      head.append(el('strong', null, `${info.emoji} ${info.label}${variant.label ? ` · ${variant.label}` : ''}`),
        ` — to ${controlPhrase(rule)}`);
      const text = el('p', 'hookup-text');
      text.innerHTML = variant.build;
      item.append(head, text);
      return item;
    }).filter(Boolean);
    if (!items.length) {
      hookup.appendChild(el('p', 'rule-empty', 'Nothing to wire: these controls use the micro:bit’s own sensors.'));
      return;
    }
    const listEl = el('ul', 'hookup-list');
    listEl.append(...items);
    hookup.appendChild(listEl);
  }

  // Step 5: the sentence again, its numbers now fields, under it the input
  // live with those numbers drawn on it, and how the control feels. This is
  // the part that is tuned once the code is on the board and running.
  function renderTune(rule) {
    const row = el('div', 'rule');
    row.dataset.id = rule.id;
    const { line, marker } = sentenceLine(rule, { choosing: false });
    row.appendChild(line);

    const choice = inputChoice(rule.input);
    const channel = choice.catalogue;
    // The input, live: a number with the line it has to cross drawn on it, a
    // press as its on/off pill, a gesture as a flash and a count. Every
    // sentence gets one, so a clip that is not making contact shows up here
    // and not as a mystery on the Game screen.
    const meter = el('div', 'rule-meter');
    const live = el('div', 'live-rows rule-live');
    meter.appendChild(live);
    const view = createChannelView(live, { signalStore, channels: [{ channel, kind: choice.family }], markers: marker });
    views.push(view);
    const note = el('span', 'rule-note', 'The live reading appears here once the micro:bit is connected.');
    meter.appendChild(note);
    signalStore.subscribe(({ type, signal }) => {
      if (type === 'value' && signal.channel === channel) note.hidden = true;
      if (type === 'reset') note.hidden = false;
    });
    row.appendChild(meter);

    // Said once a number has moved, since a number is part of the program:
    // the board keeps running the old one until it is downloaded again.
    const resend = el('p', 'rule-resend', 'New number: copy the code in step 3 and download it again.');
    resend.hidden = true;
    row.appendChild(resend);

    // How the control feels — how hard a flap kicks, how the craft falls, how
    // fast a slide moves, how closely a steer follows — right under the
    // reading that drives it. These change the game, not the program, so
    // they take effect at once.
    const feel = feelFor(rule);
    if (feel) row.appendChild(feel);
    return row;
  }

  // A number tuned in step 5: the program changes, so step 2's words and
  // step 3's code follow, and the row says the board needs the new code.
  function changed(rule) {
    persist();
    renderChoosing();
    tune?.querySelector(`.rule[data-id="${CSS.escape(rule.id)}"] .rule-resend`)?.removeAttribute('hidden');
  }

  /** The control's options as sentences, or null if it carries none. */
  function feelFor(rule) {
    if (!options) return null;
    const [node, portId] = rule.id.split('.');
    const port = (options.targets ?? []).find((target) => target.id === node)?.ports?.find((p) => p.id === portId);
    if (!port?.options?.length) return null;
    const block = el('div', 'rule-feel');
    const picked = options.get(node, portId);
    for (const option of port.options) {
      const line = el('p', 'wiring-sentence');
      if (option.lead) line.appendChild(el('span', null, option.lead));
      line.appendChild(select(option.choices, picked[option.id], (value) => {
        settingFeel = true;
        options.set(node, portId, option.id, value);
        settingFeel = false;
      }));
      if (option.trail) line.appendChild(el('span', null, option.trail));
      block.appendChild(line);
    }
    return block;
  }

  // A Load rewrites the options underneath the sentences, so they are drawn
  // again — but not for a pick made here, which would rebuild the select
  // under the pointer.
  let settingFeel = false;
  options?.subscribe?.(() => { if (!settingFeel) render(); });

  function renderChoosing() {
    list.textContent = '';
    if (!rules.length) {
      list.appendChild(el('p', 'rule-empty', 'This scheme has nothing to steer.'));
    }
    for (const rule of rules) list.appendChild(renderRule(rule));
  }

  function render() {
    views.forEach((view) => view.destroy());
    views = [];
    renderChoosing();
    renderHookup();
    if (tune) {
      tune.textContent = '';
      for (const rule of rules) tune.appendChild(renderTune(rule));
    }
  }

  // --- The program ----------------------------------------------------------
  function renderOutput() {
    code.textContent = rulesCode(rules, targets());
    if (warn) {
      const load = describeLoad(streamLoad(parts()));
      warn.hidden = !load;
      if (load) {
        warn.dataset.level = load.level;
        warn.textContent = `⚡ ${load.text}`;
      }
    }
  }

  // A new scheme means new controls, and its own sentences.
  gameHost.onGameChange((game) => {
    gameId = game?.id ?? '';
    rules = sentencesFor(game, loadRules(storage, gameId));
    persist();
    render();
  });

  persist();
  render();

  return {
    rules: () => valid(),
    parts,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Re-reads the store, for when an imported bundle has rewritten it. */
    reload() {
      rules = sentencesFor(gameHost.activeGame(), loadRules(storage, gameId));
      persist();
      render();
    },
  };
}
