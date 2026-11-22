import process from 'node:process';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { c } from './colors.js';
import { describe } from './targets.js';

export function printTargets(targets) {
  const width = String(targets.length).length;
  targets.forEach((t, i) => {
    const num = c.cyan(String(i + 1).padStart(width));
    console.log(`  ${num}  ${c.bold(`:${t.port}`.padEnd(7))} ${describe(t)}`);
  });
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

/**
 * Checkbox picker: ↑/↓ (or k/j) move, Space toggles, a toggles all, Enter confirms, q / Esc / Ctrl+C cancels.
 * Redraws in place and scrolls when the list is taller than the terminal.
 */
function pickCheckboxes(targets) {
  const { stdin, stdout } = process;
  const checked = new Set();
  let cursor = 0;
  let top = 0;
  let drawn = 0;

  const render = () => {
    const height = Math.max(3, Math.min(targets.length, (stdout.rows || 24) - 4));
    if (cursor < top) top = cursor;
    if (cursor >= top + height) top = cursor - height + 1;

    const rows = targets.slice(top, top + height).map((t, i) => {
      const index = top + i;
      const pointer = index === cursor ? c.cyan('❯') : ' ';
      const box = checked.has(index) ? c.green('[x]') : c.dim('[ ]');
      return `${pointer} ${box} ${c.bold(`:${t.port}`.padEnd(7))} ${describe(t)}`;
    });
    rows.push('', c.dim(`${checked.size}/${targets.length} selected · space toggle · a all · enter confirm · q cancel`));

    if (drawn) stdout.write(`\x1b[${drawn}F\x1b[J`); // back to the first row, clear everything below
    stdout.write(`${rows.join('\n')}\n`);
    drawn = rows.length;
  };

  return new Promise((resolve) => {
    const finish = (result) => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write(SHOW_CURSOR);
      resolve(result);
    };

    const onKey = (_, key = {}) => {
      if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) return finish([]);
      if (key.name === 'return') return finish([...checked].sort((a, b) => a - b).map((i) => targets[i]));
      if (key.name === 'up' || key.name === 'k') cursor = (cursor - 1 + targets.length) % targets.length;
      else if (key.name === 'down' || key.name === 'j') cursor = (cursor + 1) % targets.length;
      else if (key.name === 'space') checked.has(cursor) ? checked.delete(cursor) : checked.add(cursor);
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
async function pickTyped(targets) {
  printTargets(targets);
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt(`${c.cyan('?')} Free which? ${c.dim('(e.g. 1 3, 2-4, a = all, Enter = cancel)')} `);
  rl.prompt();
  try {
    // The line iterator ends cleanly on Ctrl+D / closed stdin, unlike a pending rl.question()
    for await (const answer of rl) {
      if (!answer.trim()) return [];
      try {
        return parseSelection(answer, targets.length).map((i) => targets[i]);
      } catch (err) {
        console.error(c.red(`✖ ${err.message}`));
        rl.prompt();
      }
    }
    return [];
  } finally {
    rl.close();
  }
}

/** Show listening ports and let the user choose which to free. Returns the chosen targets. */
export async function pickTargets(targets) {
  console.log(c.bold('\nPorts in use:\n'));
  return canUseCheckboxes() ? pickCheckboxes(targets) : pickTyped(targets);
}
