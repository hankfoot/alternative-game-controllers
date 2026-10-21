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
  shift: 'shift the speed',
  advance: 'start the game',
};
const controlPhrase = (rule) => PHRASES[rule.control] ?? rule.control;

export function initControlsUI({ elements, gameHost, signalStore, storage, options = null }) {
  const { list, code, warn } = elements;
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

  function renderRule(rule) {
    const row = el('div', 'rule');
    row.dataset.id = rule.id;
    const choice = inputChoice(rule.input);
    const line = el('p', 'wiring-sentence rule-sentence');
    // A steer reads "Pitch, from -40 to 40 °, sets how high the craft flies";
    // everything else reads "When Button A is pressed, flap."
    const steering = kindOf(rule) === 'level';
    if (!steering) line.append('When ');
    line.appendChild(groupedSelect(inputGroupsFor(rule), rule.input, (value) => {
      setInput(rule, value);
      persist();
      render();
    }));
    line.append(steering ? ', from' : ' ');
    const whens = whenChoicesFor(choice.family, kindOf(rule));
    // A choice of one is not a choice; it reads as words instead.
    if (steering) {
      // nothing: "from … to …" says it
    } else if (whens.length > 1) {
      line.appendChild(select(whens, rule.when, (value) => {
        setWhen(rule, value);
        persist();
        render();
      }));
    } else {
      line.append(whens[0]?.[1] ?? '');
    }

    const channel = choice.catalogue;
    let marker = () => null;
    if (choice.family === 'number') {
      const info = channelInfo(channel);
      const unit = info.unit ? ` ${info.unit}` : '';
      const span = { min: info.min ?? 0, max: info.max ?? 1 };
      if (usesRange(rule.when)) {
        const low = numberInput(rule.low, span, (value) => { rule.low = value; persist(); });
        const high = numberInput(rule.high, span, (value) => { rule.high = value; persist(); });
        line.append(' ', low, ' to ', high, unit);
        marker = () => ({ low: rule.low, high: rule.high });
      } else {
        const threshold = numberInput(rule.threshold, span, (value) => { rule.threshold = value; persist(); });
        line.append(' ', threshold, unit);
        marker = () => ({ threshold: rule.threshold });
      }
    }

    line.append(', ');
    // One span for the control and the words after it, so the sentence's
    // spacing between parts does not land in front of the full stop.
    const ending = el('span', 'rule-ending');
    ending.appendChild(el('strong', 'rule-control', controlPhrase(rule)));
    ending.append(kindOf(rule) === 'hold' ? ' for as long as it lasts.' : '.');
    line.appendChild(ending);
    row.appendChild(line);

    // How to build this input and what its numbers mean, under the sentence
    // that uses it. It sat in step 3 under the code, a list for every input
    // at once; the moment it is wanted is while the sentence is being
    // written, with the numbers right there to fill in.
    const variant = variantFor(choice.catalogue, choice.mode);
    if (variant?.build) {
      const info = channelInfo(choice.catalogue);
      const tip = el('div', 'rule-tip');
      tip.appendChild(el('strong', null, `${info.emoji} ${info.label}${variant.label ? ` · ${variant.label}` : ''}: `));
      const text = el('span');
      text.innerHTML = variant.build;
      tip.appendChild(text);
      row.appendChild(tip);
    }

    // How the control feels — how hard a flap kicks, how the craft falls, how
    // fast a slide moves — right under the sentence that drives it. The game
    // declares these on the control's own port, and the options store keeps
    // the picks per scheme; this is only where they are edited. They sat on
    // Design under a heading about the course, two screens from the sentence
    // they modify, and the moment anyone wants them is when the craft feels
    // floaty or heavy while a sentence is being tuned.
    const feel = feelFor(rule);
    if (feel) row.appendChild(feel);

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
    });
    row.appendChild(meter);
    return row;
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

  function render() {
    views.forEach((view) => view.destroy());
    views = [];
    list.textContent = '';
    if (!rules.length) {
      list.appendChild(el('p', 'rule-empty', 'This scheme has nothing to steer.'));
    }
    for (const rule of rules) list.appendChild(renderRule(rule));
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
