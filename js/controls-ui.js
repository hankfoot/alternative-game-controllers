// The Controls screen: sentences, in dropdowns.
//
// "When [Button A] [is pressed], [flap]." Each sentence is a row of selects
// and, for a reading, the number it has to cross or the range it steers
// across — with that reading drawn live underneath against the line, so the
// number can be set by looking rather than guessing. The rows make a program
// (js/controls-codegen.js), shown below them to copy into MakeCode.
//
// Thin on purpose: what a sentence means and what it compiles to is the
// generator's, tested without a DOM. This file only moves choices between the
// selects and the stored rules, and keeps the code block current.

import {
  INPUT_CHOICES, WHEN_CHOICES, actionKind, controlChoices, inputChoice, normalizeRule, rulesCode, rulesParts,
} from './controls-codegen.js';
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

function select(choices, value, onPick) {
  const node = el('select');
  for (const [optionValue, label] of choices) {
    const option = el('option', null, label);
    option.value = optionValue;
    option.selected = optionValue === value;
    node.appendChild(option);
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

// How a control reads at the end of a sentence. `advance` is the one whose
// name says nothing: what it does is start the round.
const controlLabel = (control) => (control.name === 'advance' ? 'start the game' : control.name);

let nextId = 1;
const newId = () => `rule-${Date.now().toString(36)}-${nextId++}`;

export function initControlsUI({ elements, gameHost, signalStore, storage }) {
  const { list, add, code, warn, tips } = elements;
  if (!list || !add || !code || !gameHost || !signalStore) return null;

  const listeners = new Set();
  let gameId = gameHost.activeGame()?.id ?? '';
  let rules = loadRules(storage, gameId);
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

  /** The inputs a rule may pick: every one, minus the other ways of reading a pin another rule already uses. */
  function inputChoicesFor(rule) {
    const taken = new Map();
    for (const other of rules) {
      const choice = inputChoice(other.input);
      if (other !== rule && choice?.pin && !taken.has(choice.pin)) taken.set(choice.pin, choice.mode);
    }
    return INPUT_CHOICES.filter((choice) => !choice.pin || !taken.has(choice.pin) || taken.get(choice.pin) === choice.mode);
  }

  function setInput(rule, inputId) {
    const choice = inputChoice(inputId);
    rule.input = inputId;
    const whens = WHEN_CHOICES[choice.family].map(([id]) => id);
    if (!whens.includes(rule.when)) rule.when = whens[0];
    setWhen(rule, rule.when);
  }

  function setWhen(rule, when) {
    rule.when = when;
    const controls = controlChoices(targets(), when);
    if (!controls.some((control) => control.name === rule.control)) rule.control = controls[0]?.name ?? '';
    const normalized = normalizeRule(rule, targets());
    if (normalized) Object.assign(rule, normalized, { id: rule.id });
  }

  function renderRule(rule) {
    const row = el('div', 'rule');
    row.dataset.id = rule.id;
    const choice = inputChoice(rule.input);
    const line = el('p', 'wiring-sentence rule-sentence');
    line.append('When ');
    line.appendChild(select(inputChoicesFor(rule).map((c) => [c.id, c.label]), rule.input, (value) => {
      setInput(rule, value);
      persist();
      render();
    }));
    line.append(' ');
    line.appendChild(select(WHEN_CHOICES[choice.family], rule.when, (value) => {
      setWhen(rule, value);
      persist();
      render();
    }));

    const channel = choice.catalogue;
    let marker = () => null;
    if (choice.family === 'number') {
      const info = channelInfo(channel);
      const unit = info.unit ? ` ${info.unit}` : '';
      if (rule.when === 'between') {
        const low = numberInput(rule.low, (value) => { rule.low = Number(value); persist(); });
        const high = numberInput(rule.high, (value) => { rule.high = Number(value); persist(); });
        line.append(' ', low, ` and `, high, unit);
        marker = () => ({ low: rule.low, high: rule.high });
      } else {
        const threshold = numberInput(rule.threshold, (value) => { rule.threshold = Number(value); persist(); });
        line.append(' ', threshold, unit);
        marker = () => ({ threshold: rule.threshold });
      }
    }

    line.append(', ');
    const controls = controlChoices(targets(), rule.when);
    line.appendChild(select(controls.map((c) => [c.name, controlLabel(c)]), rule.control, (value) => {
      rule.control = value;
      persist();
    }));
    line.append(actionKind(rule.when) === 'hold' ? ' while it lasts.' : '.');

    const remove = el('button', 'btn btn-soft wiring-remove', '✕');
    remove.type = 'button';
    remove.title = 'Remove this sentence';
    remove.setAttribute('aria-label', 'Remove this sentence');
    remove.addEventListener('click', () => {
      rules = rules.filter((other) => other !== rule);
      persist();
      render();
    });
    line.appendChild(remove);
    row.appendChild(line);

    // The reading, live, with the line it has to cross drawn on it. Only a
    // number has a line; a press is a press.
    if (choice.family === 'number') {
      const meter = el('div', 'rule-meter');
      const live = el('div', 'live-rows rule-live');
      meter.appendChild(live);
      const view = createChannelView(live, { signalStore, channels: [{ channel, kind: 'number' }], markers: marker });
      views.push(view);
      const use = el('button', 'btn btn-soft rule-use', rule.when === 'between' ? 'Use current as low' : 'Use current reading');
      use.type = 'button';
      use.addEventListener('click', () => {
        const now = view.value(channel);
        if (now == null) return;
        if (rule.when === 'between') rule.low = now;
        else rule.threshold = now;
        persist();
        render();
      });
      const note = el('span', 'rule-note', 'Waiting for the board — download the code below, then connect.');
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
      list.appendChild(el('p', 'rule-empty', 'No sentences yet. Add one, and the code for your board appears below.'));
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

  add.addEventListener('click', () => {
    const rule = { id: newId(), input: 'btna', when: 'pressed', control: '' };
    setWhen(rule, 'pressed');
    rules.push(rule);
    persist();
    render();
    list.querySelector(`[data-id="${rule.id}"] select`)?.focus();
  });

  // A new scheme means new controls, and its own sentences.
  gameHost.onGameChange((game) => {
    gameId = game?.id ?? '';
    rules = loadRules(storage, gameId);
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
      rules = loadRules(storage, gameId);
      persist();
      render();
    },
  };
}
