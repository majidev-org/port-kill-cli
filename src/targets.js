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
 * @returns {Target[]}
 */
export function findTargets(ports) {
  const containers = listContainerPorts();
  const dockerPorts = new Set(containers.map((t) => t.port));
  const processes = listListeners().filter((l) => !(dockerPorts.has(l.port) && isDockerProxy(l.name)));

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

/** Who can reach the port, dimmed: "all interfaces", "localhost only" or the bind address. */
export const where = (t) => (t.address ? c.dim(reach(t.address)) : '');

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

const holdsPort = (t) => listListeners().some((l) => l.pid === t.pid && l.port === t.port);

/** @returns {Promise<string> | string} how the target was stopped, for reporting */
export function freeTarget(t, force) {
  return t.kind === 'container' ? stopContainer(t.id, force) : killPid(t.pid, force, () => holdsPort(t));
}
