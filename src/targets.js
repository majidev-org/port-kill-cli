import { c } from './colors.js';
import { isDockerProxy, listContainerPorts, stopContainer } from './docker.js';
import { killPid } from './kill.js';
import { listListeners } from './listeners.js';

/**
 * A target is something occupying a port that pk can free: a host process or a Docker container.
 * @typedef {{ kind: 'process', port: number, pid: number, name: string }
 *         | { kind: 'container', port: number, id: string, name: string }} Target
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
  return [
    ...containers.map((t) => ({ kind: 'container', ...t })),
    ...processes.map((t) => ({ kind: 'process', ...t })),
  ]
    .filter((t) => !wanted || wanted.has(t.port))
    .sort((a, b) => a.port - b.port);
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

const holdsPort = (t) => listListeners().some((l) => l.pid === t.pid && l.port === t.port);

export function freeTarget(t, force) {
  return t.kind === 'container' ? stopContainer(t.id, force) : killPid(t.pid, force, () => holdsPort(t));
}
