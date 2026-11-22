import process from 'node:process';
import { isValidPort } from './args.js';
import { exec } from './exec.js';

const run = (cmd, args) =>
  exec(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });

const portOf = (addr = '') => {
  const port = Number(addr.slice(addr.lastIndexOf(':') + 1));
  return isValidPort(port) ? port : null;
};

// "127.0.0.53%lo:53" -> "127.0.0.53", "[::1]:3000" -> "[::1]", "*:3000" -> "*"
const addressOf = (addr = '') => addr.slice(0, addr.lastIndexOf(':')).replace(/%.*$/, '');

const WILDCARD = new Set(['*', '0.0.0.0', '[::]', '::']);
const isLoopback = (a) => /^(127\.|\[?::1\]?$|localhost$)/.test(a);
const breadth = (a) => (WILDCARD.has(a) ? 2 : isLoopback(a) ? 0 : 1);

/** Human label for who can reach a listening address. */
export const reach = (address = '') =>
  WILDCARD.has(address) ? 'all interfaces' : isLoopback(address) ? 'localhost only' : address;

/**
 * List every process listening on a TCP port, in a single system call.
 * @returns {{ port: number, pid: number, name: string, address: string }[]} sorted by port
 */
export function listListeners() {
  const raw = process.platform === 'win32' ? listWindows() : listUnix();
  const merged = new Map();
  for (const l of raw) {
    const key = `${l.port}:${l.pid}`; // IPv4 + IPv6 sockets of the same process collapse to one entry
    const prev = merged.get(key);
    // keep the widest exposure, so *:3000 plus [::1]:3000 reports "all interfaces"
    if (!prev || breadth(l.address) > breadth(prev.address)) merged.set(key, l);
  }
  return [...merged.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/**
 * Add the owning user and full command line to process targets (Linux/macOS, via one `ps` call).
 * Best effort: when ps is missing or fails, targets are returned without those fields.
 */
export function addProcessDetails(targets) {
  const pids = [...new Set(targets.filter((t) => t.kind === 'process').map((t) => t.pid))];
  if (process.platform === 'win32' || pids.length === 0) return targets;

  let out;
  try {
    out = run('ps', ['-ww', '-o', 'pid=,user=,args=', '-p', pids.join(',')]);
  } catch (err) {
    out = err.stdout ?? ''; // ps exits 1 when one pid already vanished but still prints the others
  }
  const info = new Map();
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (m) info.set(Number(m[1]), { user: m[2], command: m[3] });
  }
  return targets.map((t) => (t.kind === 'process' ? { ...t, ...info.get(t.pid) } : t));
}

// A tool that is missing, timed out or overflowed never looked at the ports. Any other failure is an
// answer (lsof exits 1 when nothing listens). Reporting "port is free" without having looked would be
// wrong, so when no tool could look, listing fails loudly instead of returning [].
const couldNotLook = (err) => ['ENOENT', 'ETIMEDOUT', 'ENOBUFS'].includes(err.code);

const listLsof = () => parseLsof(run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']));
const listSs = () => parseSs(run('ss', ['-tlnp']));

// ss is about twice as fast as lsof, so Linux tries it first; lsof is the fallback (and the macOS tool).
function listUnix() {
  const errors = [];
  for (const list of process.platform === 'linux' ? [listSs, listLsof] : [listLsof]) {
    try {
      return list();
    } catch (err) {
      errors.push(err); // missing, or lsof's exit 1 for "nothing listens": try the next tool
    }
  }
  if (errors.every(couldNotLook)) {
    throw new Error('could not list listening ports: lsof/ss is missing or timed out (install lsof)');
  }
  return [];
}

function listWindows() {
  const names = new Map();
  try {
    for (const line of run('tasklist', ['/FO', 'CSV', '/NH']).split(/\r?\n/)) {
      const m = line.match(/^"([^"]*)","(\d+)"/);
      if (m) names.set(Number(m[2]), m[1]);
    }
  } catch {}
  // No catch: if netstat fails we have not seen the ports, and "port is free" would be a lie.
  return parseNetstat(run('netstat', ['-ano'])).map((l) => ({ ...l, name: names.get(l.pid) ?? 'unknown' }));
}

/** Parse `lsof -F pcn` output: p<pid>, c<command>, n<address> lines. */
export function parseLsof(out) {
  const results = [];
  let pid;
  let name = 'unknown';
  for (const line of out.split(/\r?\n/)) {
    const value = line.slice(1);
    if (line[0] === 'p') pid = Number(value);
    else if (line[0] === 'c') name = value;
    else if (line[0] === 'n') {
      const port = portOf(value);
      if (port && pid) results.push({ port, pid, name, address: addressOf(value) });
    }
  }
  return results;
}

/** Parse `ss -tlnp` output. Rows without pid info (other users' processes) are skipped. */
export function parseSs(out) {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const local = line.trim().split(/\s+/)[3];
    const port = portOf(local);
    if (!port) continue;
    for (const m of line.matchAll(/\("([^"]+)",pid=(\d+)/g)) {
      results.push({ port, pid: Number(m[2]), name: m[1], address: addressOf(local) });
    }
  }
  return results;
}

/**
 * Parse `netstat -ano` TCP rows. A listening socket has a foreign port of 0; checking that
 * instead of the "LISTENING" state keeps this working on non-English Windows.
 */
export function parseNetstat(out) {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const [proto, local, foreign, , pidStr] = line.trim().split(/\s+/);
    if (proto !== 'TCP' || !foreign?.endsWith(':0')) continue;
    const port = portOf(local);
    const pid = Number(pidStr);
    if (port && pid > 0) results.push({ port, pid, address: addressOf(local) });
  }
  return results;
}
