import { c } from './colors.js';
import { isDockerProxy, listContainerPorts, stopContainer } from './docker.js';
import { killPid } from './kill.js';
import { addProcessDetails, listListeners, reach } from './listeners.js';

/**
 * A target is something occupying a port that pk can free: a host process or a Docker container.
 * `address` is the bind address; `user` and `command` come from `ps` and may be absent (Windows, no ps).
 * @typedef {{ kind: 'process', port: number, pid: number, name: string, address: string, user?: string, command?: string }
 *         | { kind: 'container', port: number, id: string, name: string, image: string, address: string }} Target
 */

/**
 * Find everything occupying the given ports (or all listening ports when none are given).
 * Ports published by a container map to the container, not to Docker's proxy process.
 * @param {number[]} [ports]
 * @returns {Promise<Target[]>}
 */
export async function findTargets(ports) {
  const pendingContainers = listContainerPorts(); // docker runs in the background while the sync port listing below blocks
  const listeners = listListeners();
  const containers = await pendingContainers;
  const dockerPorts = new Set(containers.map((t) => t.port));
  const processes = listeners.filter((l) => !(dockerPorts.has(l.port) && isDockerProxy(l.name)));

  const wanted = ports?.length ? new Set(ports) : null;
  const found = [
    ...containers.map((t) => ({ kind: 'container', ...t })),
    ...processes.map((t) => ({ kind: 'process', ...t })),
  ]
    .filter((t) => !wanted || wanted.has(t.port))
    .sort((a, b) => a.port - b.port);
  return addProcessDetails(found);
}

/** Identity of the thing to stop; one container or process can hold several ports. */
export const targetKey = (t) => (t.kind === 'container' ? `container:${t.id}` : `process:${t.pid}`);

/**
 * Make untrusted text (a process can name itself anything) safe to print: control characters,
 * including ESC and newlines, could otherwise rewrite the terminal or forge output lines, and
 * bidi overrides / zero-width / line-separator characters can visually reorder or hide text.
 */
export const printable = (text) =>
  String(text).replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ');

export const describe = (t) =>
  t.kind === 'container'
    ? `Docker container ${c.bold(printable(t.name))} ${c.dim(`(${t.id})`)}`
    : `${c.bold(printable(t.name))} ${c.dim(`(PID ${t.pid})`)}`;

/** Plain, sanitized text for each table column of a target (see ui.js). */
export const cellsOf = (t) => ({
  port: `:${t.port}`,
  name: printable(t.name),
  id: t.kind === 'container' ? t.id.slice(0, 12) : String(t.pid),
  user: t.kind === 'container' ? 'container' : printable(t.user ?? ''),
  access: printable(reach(t.address)),
  command: printable(t.kind === 'container' ? t.image : (t.command ?? '')),
});

const MAX_COMMAND = 100;

/** Owner and command (or container image), uncolored; '' when nothing is known. */
export function extra(t) {
  const parts = [];
  if (t.user) parts.push(`user ${printable(t.user)}`);
  if (t.command) {
    const cmd = printable(t.command);
    parts.push(`cmd ${cmd.length > MAX_COMMAND ? `${cmd.slice(0, MAX_COMMAND - 1)}…` : cmd}`);
  }
  if (t.image) parts.push(`image ${printable(t.image)}`);
  return parts.join(' · ');
}

// Freeing several targets at once re-checks them at the same moments (before SIGTERM, before SIGKILL).
// One scan shared for 100 ms serves all of them instead of one full scan each; it never outlives the
// 300 ms graceful wait, so the escalation check always sees fresh data.
let scan = { at: 0, listeners: [] };
function recentListeners() {
  if (Date.now() - scan.at > 100) scan = { listeners: listListeners(), at: Date.now() };
  return scan.listeners;
}

const holdsPort = (t) => recentListeners().some((l) => l.pid === t.pid && l.port === t.port);

/** @returns {Promise<string>} how the target was stopped, for reporting. Async so a sync throw becomes a rejection. */
export async function freeTarget(t, force, scope = 'holder') {
  return t.kind === 'container' ? stopContainer(t.id, force) : killPid(t.pid, force, () => holdsPort(t), scope);
}
