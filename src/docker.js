import { exec } from './exec.js';

const docker = (args) =>
  exec('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });

/**
 * Only a daemon on this machine publishes this machine's ports. A remote context (DOCKER_HOST or
 * `docker context use` pointing at tcp:// or ssh://) would match a port number to a container on
 * another host and stop the wrong one.
 */
export function isLocalEndpoint(endpoint) {
  if (/^(unix|npipe):/i.test(endpoint)) return true;
  try {
    const { protocol, hostname } = new URL(endpoint);
    return protocol === 'tcp:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * List host ports published by running Docker containers.
 * Returns [] when Docker is not installed, the daemon is not reachable, or it is not on this machine.
 * @returns {{ port: number, id: string, name: string, image: string, address: string }[]}
 */
export function listContainerPorts() {
  try {
    const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
    if (!isLocalEndpoint(endpoint)) return [];
    return parseDockerPs(docker(['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}']));
  } catch {
    return [];
  }
}

/** Parse `docker ps` rows like: `a1b2c3\tweb\tnginx:1.27\t0.0.0.0:8080->80/tcp, :::8080->80/tcp` */
export function parseDockerPs(out) {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const [id, name, image = '', ports = ''] = line.split('\t');
    // The id ends up as an argument of `docker stop`; only a hex id is accepted so it can never look like a flag.
    if (!/^[0-9a-f]+$/i.test(id) || !name) continue;
    const seen = new Set();
    for (const mapping of ports.split(', ')) {
      const m = mapping.match(/^(.*):(\d+)(?:-(\d+))?->/); // greedy: ":::8080->" gives address "::"
      if (!m) continue;
      const start = Number(m[2]);
      const end = Number(m[3] ?? m[2]);
      for (let port = start; port <= end; port++) {
        if (seen.has(port)) continue;
        seen.add(port);
        results.push({ port, id, name, image, address: m[1] });
      }
    }
  }
  return results;
}

/** Host-side helper processes that forward traffic into containers. Killing them breaks Docker. */
export const isDockerProxy = (name = '') => /docker|vpnkit|wslrelay/i.test(name);

/** @returns {string} how the container was stopped */
export function stopContainer(id, force) {
  const verb = force ? 'kill' : 'stop';
  exec('docker', [verb, id], { stdio: ['ignore', 'ignore', 'pipe'] });
  return `docker ${verb}`;
}
