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
 * List every process listening on a TCP port or bound to a UDP port, in a single system call.
 * UDP has no "listening": a bound, unconnected socket is what receives on a port, so that is what
 * counts. Connected UDP sockets are clients (a DNS lookup, a QUIC connection) and are skipped.
 * @param {string[]} [protocols] 'tcp' and/or 'udp'
 * @returns {{ port: number, protocol: string, pid: number, name: string, address: string }[]} sorted by port
 */
export function listListeners(protocols = ['tcp']) {
  const raw = (process.platform === 'win32' ? listWindows() : listUnix(protocols)).filter((l) => protocols.includes(l.protocol));
  const merged = new Map();
  for (const l of raw) {
    const key = `${l.port}/${l.protocol}:${l.pid}`; // IPv4 + IPv6 sockets of the same process collapse to one entry
    const prev = merged.get(key);
    // keep the widest exposure, so *:3000 plus [::1]:3000 reports "all interfaces"
    if (!prev || breadth(l.address) > breadth(prev.address)) merged.set(key, l);
  }
  return [...merged.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.pid - b.pid);
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

// One lsof call per protocol: combined with a TCP state filter (-sTCP:LISTEN), lsof drops -iUDP files.
// lsof exits 1 when it finds nothing; that is an answer, unlike a missing or timed-out lsof.
const LSOF_SELECT = { tcp: ['-iTCP', '-sTCP:LISTEN'], udp: ['-iUDP'] };
function listLsof(protocols) {
  return protocols.flatMap((protocol) => {
    let out;
    try {
      out = run('lsof', ['-nP', ...LSOF_SELECT[protocol], '-F', 'pcPn']);
    } catch (err) {
      if (couldNotLook(err) || err.status !== 1) throw err;
      out = String(err.stdout ?? '');
    }
    return parseLsof(out);
  });
}
// -l lists listening TCP sockets and unconnected (bound) UDP sockets
const listSs = (protocols) =>
  parseSs(run('ss', [`-${protocols.includes('tcp') ? 't' : ''}${protocols.includes('udp') ? 'u' : ''}lnp`]), protocols[0]);

// ss is about twice as fast as lsof, so Linux tries it first; lsof is the fallback (and the macOS tool).
function listUnix(protocols) {
  const errors = [];
  for (const list of process.platform === 'linux' ? [listSs, listLsof] : [listLsof]) {
    try {
      return list(protocols);
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
  // -ano lists TCP and UDP in one call; listListeners keeps the protocols asked for.
  return parseNetstat(run('netstat', ['-ano'])).map((l) => ({ ...l, name: names.get(l.pid) ?? 'unknown' }));
}

/**
 * Parse `lsof -F pcPn` output: p<pid>, c<command>, then per socket P<protocol> and n<address>.
 * Without P lines (older callers) every socket is TCP. A UDP name with "->" is a connected client
 * socket (local->remote), not something serving the port, so it is skipped.
 */
export function parseLsof(out) {
  const results = [];
  let pid;
  let name = 'unknown';
  let protocol = 'tcp';
  for (const line of out.split(/\r?\n/)) {
    const value = line.slice(1);
    if (line[0] === 'p') pid = Number(value);
    else if (line[0] === 'c') name = value;
    else if (line[0] === 'P') protocol = value.toLowerCase();
    else if (line[0] === 'n') {
      if (value.includes('->') || !['tcp', 'udp'].includes(protocol)) continue;
      const port = portOf(value);
      if (port && pid) results.push({ port, protocol, pid, name, address: addressOf(value) });
    }
  }
  return results;
}

/**
 * Parse `ss -tlnp` / `-ulnp` / `-tulnp` output. With both -t and -u, ss adds a Netid column (tcp/udp)
 * first; with one of them there is none and every row is `protocol`.
 * Rows without pid info (other users' processes) are skipped.
 */
export function parseSs(out, protocol = 'tcp') {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    const netid = ['tcp', 'udp'].includes(cols[0]) ? cols[0] : null;
    const local = cols[netid ? 4 : 3];
    const port = portOf(local);
    if (!port) continue;
    for (const m of line.matchAll(/\("([^"]+)",pid=(\d+)/g)) {
      results.push({ port, protocol: netid ?? protocol, pid: Number(m[2]), name: m[1], address: addressOf(local) });
    }
  }
  return results;
}

/**
 * Parse `netstat -ano` TCP and UDP rows. A listening TCP socket has a foreign port of 0; checking
 * that instead of the "LISTENING" state keeps this working on non-English Windows. UDP rows have no
 * state column (`UDP  0.0.0.0:5353  *:*  77`) and every one is a bound socket.
 */
export function parseNetstat(out) {
  const results = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    const [proto, local, foreign] = cols;
    let pidStr;
    if (proto === 'TCP' && foreign?.endsWith(':0')) pidStr = cols[4];
    else if (proto === 'UDP' && foreign === '*:*') pidStr = cols[3];
    else continue;
    const port = portOf(local);
    const pid = Number(pidStr);
    if (port && pid > 0) results.push({ port, protocol: proto.toLowerCase(), pid, address: addressOf(local) });
  }
  return results;
}
