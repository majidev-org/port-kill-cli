import process from 'node:process';
import { isValidPort } from './args.js';
import { exec } from './exec.js';

const run = (cmd, args) =>
  exec(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });

const portOf = (addr = '') => {
  const port = Number(addr.slice(addr.lastIndexOf(':') + 1));
  return isValidPort(port) ? port : null;
};

/**
 * List every process listening on a TCP port, in a single system call.
 * @returns {{ port: number, pid: number, name: string }[]} sorted by port
 */
export function listListeners() {
  const raw = process.platform === 'win32' ? listWindows() : listUnix();
  const seen = new Set();
  return raw
    .filter(({ port, pid }) => {
      const key = `${port}:${pid}`; // IPv4 + IPv6 sockets of the same process collapse to one entry
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.port - b.port || a.pid - b.pid);
}

// A tool that is missing, timed out or overflowed never looked at the ports. Any other failure is an
// answer (lsof exits 1 when nothing listens). Reporting "port is free" without having looked would be
// wrong, so when no tool could look, listing fails loudly instead of returning [].
const couldNotLook = (err) => ['ENOENT', 'ETIMEDOUT', 'ENOBUFS'].includes(err.code);

function listUnix() {
  let lsofError;
  try {
    return parseLsof(run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']));
  } catch (err) {
    lsofError = err; // missing (minimal Linux images) or found nothing: fall back to ss
  }
  try {
    return parseSs(run('ss', ['-tlnp']));
  } catch (err) {
    if (couldNotLook(lsofError) && couldNotLook(err)) {
      throw new Error('could not list listening ports: lsof/ss is missing or timed out (install lsof)');
    }
    return [];
  }
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
      if (port && pid) results.push({ port, pid, name });
    }
  }
  return results;
}

/** Parse `ss -tlnp` output. Rows without pid info (other users' processes) are skipped. */
export function parseSs(out) {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const port = portOf(line.trim().split(/\s+/)[3]);
    if (!port) continue;
    for (const m of line.matchAll(/\("([^"]+)",pid=(\d+)/g)) {
      results.push({ port, pid: Number(m[2]), name: m[1] });
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
    if (port && pid > 0) results.push({ port, pid });
  }
  return results;
}
