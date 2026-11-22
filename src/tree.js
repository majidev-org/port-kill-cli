import { basename } from 'node:path';
import process from 'node:process';
import { exec } from './exec.js';

// Programs `--tree` never stops as somebody's parent: ending one logs the user out or closes their terminal.
const PROTECTED_PARENTS = new Set([
  'init', 'systemd', 'launchd', 'login', 'sshd', 'tmux', 'screen',
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh',
]);

/**
 * Parse `ps -A -o pid=,ppid=,comm=` into pid -> { ppid, name } (macOS prints comm as a full path).
 * @returns {Map<number, { ppid: number, name: string }>}
 */
export function parseProcessTable(out) {
  const table = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), name: basename(m[3]) });
  }
  return table;
}

/** Every process and its parent, in one `ps` call. Best effort: empty when ps is missing or fails. */
export function readProcessTable() {
  try {
    return parseProcessTable(
      exec('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }),
    );
  } catch {
    return new Map();
  }
}

/** The widest thing the user asked to stop; the parent already includes everything under it. */
export const scopeOf = ({ children, tree }) => (tree ? 'parent' : children ? 'children' : 'holder');

/**
 * Decide which processes to signal when freeing a port held by `pid`, by `scope`:
 * - 'holder': just the holder (the default)
 * - 'children': the holder and everything under it
 * - 'parent': the holder's parent and everything under that
 * pk itself and the shells and programs above it (the terminal it runs in) are never included, nor
 * anything below them, and 'parent' leaves alone a parent that is init, a shell or a session manager
 * (it then falls back to 'children').
 * @param {Map<number, { ppid: number, name: string }>} table
 * @param {number} pid the process holding the port
 * @param {'holder' | 'children' | 'parent'} scope
 * @param {number} selfPid pk's own pid
 * @returns {{ pids: number[], parent?: { pid: number, name: string }, note: string }}
 *   pids always starts with the holder; `parent` is set when the parent is among them; `note` says why it was spared
 */
export function planKill(table, pid, scope, selfPid) {
  if (scope === 'holder') return { pids: [pid], parent: undefined, note: '' };

  const mine = new Set();
  for (let p = selfPid; p > 1 && !mine.has(p); p = table.get(p)?.ppid) mine.add(p);

  let root = pid;
  let parent;
  let note = '';
  if (scope === 'parent') {
    const ppid = table.get(pid)?.ppid;
    const name = table.get(ppid)?.name;
    if (name === undefined) note = 'parent not found';
    else if (ppid <= 1 || mine.has(ppid) || PROTECTED_PARENTS.has(name)) note = `parent ${name} (PID ${ppid}) left running`;
    else {
      root = ppid;
      parent = { pid: ppid, name };
    }
  }

  const children = new Map();
  for (const [p, { ppid }] of table) children.set(ppid, [...(children.get(ppid) ?? []), p]);

  const pids = [pid];
  const queue = [root];
  while (queue.length > 0) {
    const p = queue.shift();
    if (p !== pid) pids.push(p);
    for (const child of children.get(p) ?? []) if (!mine.has(child)) queue.push(child);
  }
  return { pids, parent, note };
}
