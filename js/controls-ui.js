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
  canDrive, groupedInputChoices, inputChoice, normalizeRule, offered, rulesCode, rulesParts, sentencesFor, whenChoicesFor,
} from './controls-codegen.js';
import { controlsFor } from './game-facade.js';
import { describeLoad, streamLoad } from './builder.js';
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

function numberInput(value, onCommit) {
  const node = el('input');
  node.type = 'number';
  node.step = 'any';
  node.value = String(value);
  node.addEventListener('input', () => onCommit(node.value));
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

export function initControlsUI({ elements, gameHost, signalStore, storage }) {
  const { list, code, warn, tips } = elements;
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
      && offered(choice, slot, rule.input)
      && (!choice.pin || !taken.has(choice.pin) || taken.get(choice.pin) === choice.mode))
      .map(([label, choices]) => [label, choices.map((choice) => [choice.id, choice.label])]);
  }

  function setInput(rule, inputId) {
    const choice = inputChoice(inputId);
    rule.input = inputId;
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
      if (rule.when === 'between') {
        const low = numberInput(rule.low, (value) => { rule.low = Number(value); persist(); });
        const high = numberInput(rule.high, (value) => { rule.high = Number(value); persist(); });
        line.append(' ', low, ' to ', high, unit);
        marker = () => ({ low: rule.low, high: rule.high });
      } else {
        const threshold = numberInput(rule.threshold, (value) => { rule.threshold = Number(value); persist(); });
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

    // The reading, live, with the line it has to cross drawn on it. Only a
    // number has a line; a press is a press.
    if (choice.family === 'number') {
      const meter = el('div', 'rule-meter');
      const live = el('div', 'live-rows rule-live');
      meter.appendChild(live);
      const view = createChannelView(live, { signalStore, channels: [{ channel, kind: 'number' }], markers: marker });
      views.push(view);
      const use = el('button', 'btn btn-soft rule-use', rule.when === 'between' ? 'Use the current reading as the low end' : 'Use the current reading');
      use.type = 'button';
      use.addEventListener('click', () => {
        const now = view.value(channel);
        if (now == null) return;
        if (rule.when === 'between') rule.low = now;
        else rule.threshold = now;
        persist();
        render();
      });
      const note = el('span', 'rule-note', 'The live reading appears here once the micro:bit is connected.');
      meter.append(use, note);
      signalStore.subscribe(({ type, signal }) => {
        if (type === 'value' && signal.channel === channel) note.hidden = true;
      });
      row.appendChild(meter);
    }
    return row;
  }

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
    if (tips) {
      tips.textContent = '';
      const used = parts().filter((part) => part.build);
      if (!used.length) return;
      const ul = el('ul', 'build-list');
      for (const part of used) {
        const li = el('li');
        const name = el('strong', null, `${channelInfo(part.channels[0]).emoji} ${channelInfo(part.channels[0]).label}${part.label ? ` · ${part.label}` : ''}: `);
        li.appendChild(name);
        const text = el('span');
        text.innerHTML = part.build;
        li.appendChild(text);
        ul.appendChild(li);
      }
      tips.appendChild(ul);
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
