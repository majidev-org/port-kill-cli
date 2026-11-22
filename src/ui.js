import process from 'node:process';
import { c } from './colors.js';

// Shared terminal layout: one table renderer for `--info`, the checkbox picker and the numbered fallback,
// so all three line up the same way. Cells are plain strings (already sanitized by targets.js); this file
// only pads, truncates and colors them.

const GAP = '  ';
/** [cell key, header title, max width]; the last column takes whatever width is left. */
const COLUMNS = [
  ['port', 'PORT', 7],
  ['name', 'PROCESS', 26],
  ['id', 'PID/ID', 12],
  ['user', 'USER', 14],
  ['access', 'ACCESS', 14],
  ['command', 'COMMAND'],
];
const PIPED_COMMAND_WIDTH = 100; // no terminal to measure when output is piped

export const fit = (text, width) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`);

/** Column widths for these rows, given the space already used by a prefix (pointer, checkbox, number). */
export function columnWidths(rows, indent, termWidth = process.stdout.columns) {
  const widths = {};
  for (const [key, title, cap] of COLUMNS.slice(0, -1)) {
    widths[key] = Math.min(cap, Math.max(title.length, ...rows.map((r) => r[key].length)));
  }
  const used = indent + Object.values(widths).reduce((sum, w) => sum + w + GAP.length, 0);
  widths.command = termWidth ? Math.max(12, termWidth - used - 1) : PIPED_COMMAND_WIDTH;
  return widths;
}

/** Total printed width of a row (without the right margin), for rules and right-aligned text. */
export const tableWidth = (widths, indent, termWidth = process.stdout.columns) => {
  const total = indent + COLUMNS.reduce((sum, [key]) => sum + widths[key], 0) + GAP.length * (COLUMNS.length - 1);
  return termWidth ? Math.min(total, termWidth - 1) : total;
};

const tone = {
  port: (t) => c.bold(c.cyan(t)),
  id: c.dim,
  user: c.dim,
  access: (t) => (t.startsWith('all ') ? c.yellow(t) : t.startsWith('localhost') ? c.green(t) : t),
  command: c.dim,
};

const cell = (row, key, widths, last) => {
  const text = fit(row[key], widths[key]);
  return last ? text : text.padEnd(widths[key]);
};

const render = (row, widths, style) =>
  COLUMNS.map(([key], i) => {
    const text = cell(row, key, widths, i === COLUMNS.length - 1);
    return style ? style(key, text) : text;
  }).join(GAP);

export const headerRow = (widths) =>
  c.dim(c.bold(render(Object.fromEntries(COLUMNS.map(([key, title]) => [key, title])), widths)));

/** A data row with per-column colors. */
export const dataRow = (row, widths) => render(row, widths, (key, text) => (tone[key] ? tone[key](text) : text));

/** The same row without colors, for the inverse-video selection bar (nested resets would cancel it). */
export const plainRow = (row, widths) => render(row, widths);

export const rule = (length) => c.dim('─'.repeat(Math.max(0, length)));

/** A rule with a label, e.g. "─ ↓ 7 more ───────". */
export const labelledRule = (label, length) =>
  label ? c.dim(`─ ${label} ${'─'.repeat(Math.max(0, length - label.length - 3))}`) : rule(length);

/** Key hints like "↑↓ move · space toggle", key names bold. */
export const keyHints = (pairs) => pairs.map(([key, label]) => `${c.bold(key)} ${c.dim(label)}`).join(c.dim('  ·  '));
