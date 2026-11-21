import process from 'node:process';
import { createInterface } from 'node:readline';
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

/** Show listening ports and let the user choose which to free. Returns the chosen targets. */
export async function pickTargets(targets) {
  console.log(c.bold('\nPorts in use:\n'));
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
