import { exec } from './exec.js';

/**
 * List host ports published by running Docker containers.
 * Returns [] when Docker is not installed or the daemon is not reachable.
 * @returns {{ port: number, id: string, name: string }[]}
 */
export function listContainerPorts() {
  try {
    const out = exec('docker', ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Ports}}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return parseDockerPs(out);
  } catch {
    return [];
  }
}

/** Parse `docker ps` rows like: `a1b2c3\tweb\t0.0.0.0:8080->80/tcp, :::8080->80/tcp` */
export function parseDockerPs(out) {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const [id, name, ports = ''] = line.split('\t');
    if (!id || !name) continue;
    const seen = new Set();
    for (const m of ports.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
      const start = Number(m[1]);
      const end = Number(m[2] ?? m[1]);
      for (let port = start; port <= end; port++) {
        if (seen.has(port)) continue;
        seen.add(port);
        results.push({ port, id, name });
      }
    }
  }
  return results;
}

/** Host-side helper processes that forward traffic into containers. Killing them breaks Docker. */
export const isDockerProxy = (name = '') => /docker|vpnkit|wslrelay/i.test(name);

export function stopContainer(id, force) {
  exec('docker', [force ? 'kill' : 'stop', id], { stdio: ['ignore', 'ignore', 'pipe'] });
}
