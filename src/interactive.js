import process from 'node:process';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { c } from './colors.js';
import { cellsOf, extra, printable } from './targets.js';
import { planKill, readProcessTable } from './tree.js';
import { columnWidths, dataRow, headerRow, keyHints, labelledRule, plainRow, rule, tableWidth } from './ui.js';

/** Print targets as an aligned table; `numbered` adds a leading index for the typed prompt. */
export function printTargets(targets, { numbered = false } = {}) {
  const rows = targets.map(cellsOf);
  const numWidth = String(targets.length).length;
  const indent = 2 + (numbered ? numWidth + 2 : 0);
  const widths = columnWidths(rows, indent);
  const line = rule(tableWidth(widths, indent) - 2);

  console.log(`  ${numbered ? ' '.repeat(numWidth + 2) : ''}${headerRow(widths)}`);
  console.log(`  ${line}`);
  rows.forEach((row, i) => {
    const num = numbered ? `${c.cyan(String(i + 1).padStart(numWidth))}  ` : '';
    console.log(`  ${num}${dataRow(row, widths)}`);
  });
  console.log(`  ${line}`);
}

/**
 * Parse a selection like "1 3", "1,3", "2-4" or "a" into zero-based indexes.
 * Throws on out-of-range or malformed input.
 */
export function parseSelection(input, count) {
  const text = input.trim().toLowerCase();
  if (text === 'a' || text === 'all') return [...Array(count).keys()];

  const picked = new Set();
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const m = token.match(/^(\d+)(?:-(\d+))?$/);
    const start = Number(m?.[1]);
    const end = Number(m?.[2] ?? m?.[1]);
    if (!m || start < 1 || end > count || end < start) throw new Error(`Invalid selection: "${token}"`);
    for (let n = start; n <= end; n++) picked.add(n - 1);
  }
  return [...picked];
}

const SHOW_CURSOR = '\x1b[?25h\x1b[?7h'; // show cursor, re-enable line wrap
const HIDE_CURSOR = '\x1b[?25l\x1b[?7l'; // hide cursor, disable wrap so every row stays one line

const canUseCheckboxes = () =>
  process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function';

const PICKER_KEYS = [
  ['↑↓', 'move'],
  ['space', 'toggle'],
  ['a', 'all'],
  ['c', 'children'],
  ['t', 'app'],
  ['enter', 'free selected'],
  ['q', 'quit'],
];
const PICKER_CHROME = 6; // title, header, two rules, detail line and key hints around the rows

// Ticked under the port list, so nobody has to remember --children / --tree. Windows has neither:
// taskkill /T always stops children there and --tree is not supported.
const OPTIONS = [
  { key: 'children', hotkey: 'c', flag: '--children', label: 'Also stop what it started', hint: 'child processes running under the ticked ports, such as workers behind a server' },
  { key: 'tree', hotkey: 't', flag: '--tree', label: 'Also close the app that started it', hint: 'the parent program and everything under it, such as a whole editor window. Unsaved work is lost; you are asked to confirm' },
];
const pickerOptions = () => (process.platform === 'win32' ? [] : OPTIONS);

/**
 * Checkbox picker: ↑/↓ (or k/j) move, Space toggles, a toggles all ports, c / t toggle the "also stop
 * children / parent" options (also reachable with the cursor), Enter confirms, q / Esc / Ctrl+C cancels.
 * Redraws in place and scrolls when the list is taller than the terminal.
 * @returns {Promise<{ targets: object[], children: boolean, tree: boolean }>}
 */
function pickCheckboxes(targets, initial) {
  const { stdin, stdout } = process;
  const cells = targets.map(cellsOf);
  const checked = new Set();
  const options = pickerOptions();
  const on = { children: initial.children, tree: initial.tree };
  const rowCount = targets.length + options.length; // port rows, then option rows
  let cursor = 0;
  let top = 0;
  let drawn = 0;

  const render = () => {
    const height = Math.max(3, Math.min(targets.length, (stdout.rows || 24) - PICKER_CHROME - options.length - 3));
    if (cursor < targets.length) {
      if (cursor < top) top = cursor;
      if (cursor >= top + height) top = cursor - height + 1;
    }

    const widths = columnWidths(cells, 6);
    const length = tableWidth(widths, 6) - 2;

    const left = `  pk  Select ports to free`;
    const right = `${checked.size} of ${targets.length} selected`;
    const title = `  ${c.bold('pk')}  ${c.dim('Select ports to free')}${' '.repeat(Math.max(2, length + 2 - left.length - right.length))}${checked.size ? c.green(right) : c.dim(right)}`;

    const rows = cells.slice(top, top + height).map((row, i) => {
      const index = top + i;
      const box = checked.has(index) ? '[x]' : '[ ]';
      if (index === cursor) return c.inverse(`❯ ${box} ${plainRow(row, widths)}`.padEnd(length + 2)); // selection bar, full table width
      return `  ${checked.has(index) ? c.green(box) : c.dim(box)} ${dataRow(row, widths)}`;
    });

    // the parent includes everything under it, so with it ticked "children" shows as included
    const optionRows = options.map((opt, i) => {
      const included = opt.key === 'children' && on.tree;
      const box = on[opt.key] || included ? '[x]' : '[ ]';
      const text = `${opt.label}${included ? ' (included)' : ''}`;
      if (targets.length + i === cursor) return c.inverse(`❯ ${box} ${text}  ${opt.flag}`.padEnd(length + 2));
      return `  ${on[opt.key] || included ? c.green(box) : c.dim(box)} ${text}  ${c.dim(opt.flag)}`;
    });
    const detail = cursor < targets.length ? extra(targets[cursor]) : options[cursor - targets.length].hint;

    const above = top;
    const below = targets.length - top - height;
    const more = [above && `↑ ${above} more`, below && `↓ ${below} more`].filter(Boolean).join(' · ');

    const lines = [
      title,
      `      ${headerRow(widths)}`,
      `  ${rule(length)}`,
      ...rows,
      `  ${labelledRule(more, length)}`,
      ...optionRows,
      c.dim(`  ${detail}`), // full owner and command of the highlighted port, or what the option does
      `  ${keyHints(PICKER_KEYS)}`,
    ];

    if (drawn) stdout.write(`\x1b[${drawn}F\x1b[J`); // back to the first row, clear everything below
    stdout.write(`${lines.join('\n')}\n`);
    drawn = lines.length;
  };

  return new Promise((resolve) => {
    const finish = (result) => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write(SHOW_CURSOR);
      resolve({ targets: result, children: on.children, tree: on.tree });
    };

    const toggleOption = (key) => {
      if (key === 'children' && on.tree) return; // already included by the parent
      on[key] = !on[key];
    };

    const onKey = (_, key = {}) => {
      if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) return finish([]);
      if (key.name === 'return') return finish([...checked].sort((a, b) => a - b).map((i) => targets[i]));
      const hot = key.ctrl ? undefined : options.find((o) => o.hotkey === key.name);
      if (key.name === 'up' || key.name === 'k') cursor = (cursor - 1 + rowCount) % rowCount;
      else if (key.name === 'down' || key.name === 'j') cursor = (cursor + 1) % rowCount;
      else if (key.name === 'space' && cursor >= targets.length) toggleOption(options[cursor - targets.length].key);
      else if (key.name === 'space') checked.has(cursor) ? checked.delete(cursor) : checked.add(cursor);
      else if (hot) toggleOption(hot.key);
      else if (key.name === 'a') {
        if (checked.size === targets.length) checked.clear();
        else targets.forEach((_t, i) => checked.add(i));
      } else return;
      render();
    };

    process.once('exit', () => stdout.write(SHOW_CURSOR)); // never leave the terminal without a cursor
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', onKey);
    stdout.write(HIDE_CURSOR);
    render();
  });
}

/** Typed fallback for when raw keypresses are unavailable (e.g. output is piped). */
async function pickTyped(targets, initial) {
  console.log(c.bold('\nPorts in use:\n'));
  printTargets(targets, { numbered: true });
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt(`${c.cyan('?')} Free which? ${c.dim('(e.g. 1 3, 2-4, a = all, Enter = cancel)')} `);
  rl.prompt();
  try {
    // The line iterator ends cleanly on Ctrl+D / closed stdin, unlike a pending rl.question()
    for await (const answer of rl) {
      if (!answer.trim()) return { ...initial, targets: [] };
      try {
        return { ...initial, targets: parseSelection(answer, targets.length).map((i) => targets[i]) };
      } catch (err) {
        console.error(c.red(`✖ ${err.message}`));
        rl.prompt();
      }
    }
    return { ...initial, targets: [] };
  } finally {
    rl.close();
  }
}

/**
 * Show listening ports and let the user choose which to free, and whether to also stop children or the
 * parent (the flags give the starting state). The typed fallback has no checkboxes, so only the flags apply.
 * @param {object[]} targets
 * @param {{ children: boolean, tree: boolean }} initial
 * @returns {Promise<{ targets: object[], children: boolean, tree: boolean }>}
 */
export async function pickTargets(targets, { children, tree }) {
  const initial = { children, tree };
  return canUseCheckboxes() ? pickCheckboxes(targets, initial) : pickTyped(targets, initial);
}

/**
 * `--tree` closes whole apps, so say which parents would go and ask first. Returns false when the
 * user declines. Throws when there is no terminal to ask on (pass --yes to skip the question).
 * Nothing to ask when no target has a parent that would be stopped.
 */
export async function confirmParents(targets) {
  const table = readProcessTable();
  const plans = targets
    .filter((t) => t.kind === 'process')
    .map((t) => ({ t, plan: planKill(table, t.pid, 'parent', process.pid) }))
    .filter(({ plan }) => plan.parent);
  if (plans.length === 0) return true;
  if (!process.stdin.isTTY) throw new Error('--tree asks before stopping a parent, but there is no terminal to ask on. Pass --yes to skip the question.');

  console.log(c.yellow('\n! --tree will also stop these parents, and everything running under them:\n'));
  for (const { t, plan } of plans) {
    const others = plan.pids.length - 2;
    const more = others > 0 ? c.dim(` + ${others} other process${others === 1 ? '' : 'es'}`) : '';
    console.log(`  ${c.bold(`:${t.port}`)}  ${printable(t.name)} ${c.dim(`(PID ${t.pid})`)} ${c.dim('→')} ${c.bold(printable(plan.parent.name))} ${c.dim(`(PID ${plan.parent.pid})`)}${more}`);
  }
  console.log(c.dim('\n  Unsaved work in those programs is lost.'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt(`\n${c.cyan('?')} Stop them? ${c.dim('[y/N]')} `);
  rl.prompt();
  try {
    for await (const answer of rl) return /^y(es)?$/i.test(answer.trim()); // Ctrl+D ends the loop: counts as no
    return false;
  } finally {
    rl.close();
  }
}
