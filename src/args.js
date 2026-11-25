// Argument parsing is deliberately forgiving: people type what they remember, paste what an error
// message or a browser showed them, or use another tool's syntax (pk also answers to `kill-port`).
// Anything that clearly names a port is accepted; anything else fails with a hint.

/** Long option name -> option key. Matched case-insensitively, with one or two leading dashes. */
const LONG = {
  info: 'info',
  force: 'force',
  children: 'children',
  tree: 'tree',
  tcp: 'tcp',
  udp: 'udp',
  yes: 'yes',
  help: 'help',
  version: 'version',
};

/** Short flags; they can be combined (`-ui` = `-u -i`). `-9` is `kill -9` habit for --force. */
const SHORT = { i: 'info', f: 'force', c: 'children', t: 'tcp', u: 'udp', y: 'yes', h: 'help', v: 'version', 9: 'force' };

/** Options that take a value: `--port 3000`, `-p 3000`, `--port=3000` (kill-port's syntax). */
const VALUED = { port: 'port', p: 'port', method: 'method', m: 'method', protocol: 'method' };

/**
 * Plain words, so people can type what they mean: `pk kill 3000`, `pk port 3000`, `pk what is on 3000`.
 * Ports are numbers, so no word clashes with one. When in doubt the answer is to look, not to kill:
 * a question (`is`, `what`, `who`, `which`) only ever shows info, even next to a kill word.
 */
const KILL_WORDS = ['kill', 'free', 'stop', 'close', 'end', 'release', 'terminate', 'kill-port', 'killport', 'port-kill'];
const INFO_WORDS = ['port', 'ports', 'info', 'list', 'ls', 'show', 'check', 'find', 'status', 'inspect'];
const QUESTION_WORDS = ['is', 'what', 'whats', "what's", 'who', 'whos', "who's", 'which'];
const FILLER_WORDS = ['on', 'at', 'the', 'using', 'uses', 'used', 'by', 'in', 'of', 'for', 'please', 'up', 'and', 'all', 'only', 'open', 'busy', 'listening', 'active', 'running', 'my', 'me'];
const OPTION_WORDS = { force: 'force', children: 'children', tree: 'tree', help: 'help', version: 'version' };
const PROTOCOL_WORDS = { tcp: ['tcp'], udp: ['udp'], both: ['tcp', 'udp'] };
const ALL_WORDS = [...KILL_WORDS, ...INFO_WORDS, ...QUESTION_WORDS, ...FILLER_WORDS, ...Object.keys(OPTION_WORDS), ...Object.keys(PROTOCOL_WORDS)];

const DEFAULT_PORT = { 'http:': 80, 'ws:': 80, 'https:': 443, 'wss:': 443 };

export const isValidPort = (p) => Number.isInteger(p) && p > 0 && p <= 65535;

export const PROTOCOLS = ['tcp', 'udp'];

/** "3000" for TCP (the default everyone means), "5353/udp" otherwise. */
export const portLabel = (port, protocol = 'tcp') => (protocol === 'tcp' ? String(port) : `${port}/${protocol}`);

const EXAMPLES = 'e.g. 3000, 3000-3005, :3000, localhost:3000 or 5353/udp';

/** Edit distance, for "did you mean" on mistyped options and words. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

const closest = (name, names) => {
  const [best] = names.map((n) => [n, distance(name, n)]).sort((a, b) => a[1] - b[1]);
  return best && best[1] <= Math.min(2, Math.floor(name.length / 2)) ? best[0] : null;
};

function unknownOption(arg) {
  const name = arg.replace(/^-+/, '').split('=')[0].toLowerCase();
  const best = closest(name, [...Object.keys(LONG), 'port', 'method']);
  const hint = best ? ` Did you mean "--${best}"?` : ' Run pk --help to see the options.';
  return new Error(`Unknown option: "${arg}".${hint}`);
}

/**
 * Turn one port argument into a range and an optional protocol. Accepts:
 *   3000   3000-3005   3000..3005   3000–3005        a port or an inclusive range
 *   :3000  localhost:3000  127.0.0.1:3000  [::1]:3000  :::3000  *:3000   a bind address (host ignored)
 *   http://localhost:5173/path                        a URL (its port, or 80/443 by default)
 *   5353/udp  5353:udp  udp/5353  udp:5353  3000-3005/tcp   a protocol before or after
 * @returns {{ start: number, end: number, protocol?: string }}
 */
export function parsePortSpec(arg) {
  const fail = () => new Error(`Invalid port or range: "${arg}" (expected 1–65535, ${EXAMPLES})`);
  let text = arg.trim().toLowerCase();
  let protocol;

  const url = text.match(/^([a-z][a-z0-9+.-]*:)\/\//);
  if (url) {
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      throw fail();
    }
    const port = parsed.port ? Number(parsed.port) : DEFAULT_PORT[parsed.protocol];
    if (!port) throw fail();
    return { start: port, end: port };
  }

  const before = text.match(/^(tcp|udp)[:/](.+)$/);
  const after = text.match(/^(.+?)[:/](tcp|udp)$/);
  if (before) [, protocol, text] = before;
  else if (after) [, text, protocol] = after;

  // host:port, [v6]:port, :::port, :port. The port is after the last colon.
  if (text.includes(':')) text = text.slice(text.lastIndexOf(':') + 1);

  const m = text.match(/^(\d+)(?:\s*(?:-|\.\.|–|—)\s*(\d+))?$/);
  const start = Number(m?.[1]);
  const end = Number(m?.[2] ?? m?.[1]);
  if (!m || !isValidPort(start) || !isValidPort(end) || end < start) throw fail();
  return { start, end, protocol };
}

function parseMethod(value) {
  const protocol = String(value ?? '').toLowerCase();
  if (!PROTOCOLS.includes(protocol)) throw new Error(`Invalid protocol: "${value ?? ''}" (expected tcp or udp)`);
  return protocol;
}

/**
 * Parse CLI arguments into options. Throws an Error with a user-facing message on bad input.
 *
 * Ports are TCP unless chosen otherwise: `--udp` switches every port to UDP, `--tcp --udp` checks
 * both, and a protocol written on a port (`5353/udp`, `udp:5353`) sets it for that one argument.
 * `protocols` is what the flags select; it also decides what `pk` and `pk --info` list.
 * @returns {{ info: boolean, force: boolean, children: boolean, tree: boolean, yes: boolean, help: boolean,
 *   version: boolean, tcp: boolean, udp: boolean, protocols: string[], ports: { port: number, protocol: string }[] }}
 */
export function parseArgs(argv) {
  const opts = { info: false, force: false, children: false, tree: false, yes: false, help: false, version: false, tcp: false, udp: false, ports: [] };
  const specs = [];
  const said = { kill: false, info: false, question: false, protocol: false };
  const addPorts = (value) => {
    for (const part of String(value).split(',').filter((p) => p.trim())) specs.push(parsePortSpec(part));
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-9') {
      opts.force = true; // kill -9
      continue;
    }
    if (/^-\d/.test(arg) || !arg.startsWith('-')) {
      const word = arg.toLowerCase().replace(/[?!.]+$/, ''); // "what's on 3000?" works too
      if (KILL_WORDS.includes(word)) said.kill = true;
      else if (INFO_WORDS.includes(word)) said.info = true;
      else if (QUESTION_WORDS.includes(word)) said.question = true;
      else if (FILLER_WORDS.includes(word)) continue;
      else if (PROTOCOL_WORDS[word]) {
        for (const proto of PROTOCOL_WORDS[word]) opts[proto] = true; // `pk udp`, `pk tcp udp`, `pk both`
        said.protocol = true;
      }
      else if (OPTION_WORDS[word]) opts[OPTION_WORDS[word]] = true;
      else if (/^[a-z'-]+$/.test(word) && !/^(tcp|udp)$/.test(word)) {
        const best = closest(word, ALL_WORDS);
        throw new Error(`Unknown word: "${arg}".${best ? ` Did you mean "${best}"?` : ' Run pk --help to see what pk understands.'}`);
      } else addPorts(arg.replace(/[?!]+$/, '')); // ports: "3000", "3000,5173", ":3000", "3000?"
      continue;
    }

    const [rawName, inline] = arg.replace(/^-+/, '').split(/=(.*)/s);
    const name = rawName.toLowerCase();
    const valued = VALUED[name];
    if (valued) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`Option "${arg}" needs a value, e.g. ${arg} ${valued === 'port' ? '3000' : 'udp'}`);
      if (valued === 'port') addPorts(value);
      else opts[parseMethod(value)] = true;
      continue;
    }
    if (inline !== undefined) throw unknownOption(arg);

    if (LONG[name]) {
      opts[LONG[name]] = true; // --udp, --UDP, -udp
      continue;
    }
    // -ui = -u -i. Short flags keep their case sensitivity loose too: -U works.
    const letters = arg.startsWith('--') ? null : [...name];
    if (letters?.length && letters.every((ch) => SHORT[ch])) {
      for (const ch of letters) opts[SHORT[ch]] = true;
      continue;
    }
    throw unknownOption(arg);
  }

  // A question only looks. Otherwise a kill word frees, and an info word without one looks.
  // A protocol named on its own (`pk udp`, `pk tcp udp ports`) means "show me those": a listing,
  // not the picker. The flags (--udp, pk-udp) keep opening the picker, and `pk kill udp` picks too.
  const protocolOnly = said.protocol && specs.length === 0;
  if (said.question || ((said.info || protocolOnly) && !said.kill)) opts.info = true;
  opts.protocols = opts.udp ? (opts.tcp ? ['tcp', 'udp'] : ['udp']) : ['tcp'];

  // A protocol written on the port wins over the flags for that argument. Duplicates collapse.
  const seen = new Set();
  for (const { start, end, protocol } of specs) {
    for (const proto of protocol ? [protocol] : opts.protocols) {
      for (let port = start; port <= end; port++) {
        const key = `${port}/${proto}`;
        if (seen.has(key)) continue;
        seen.add(key);
        opts.ports.push({ port, protocol: proto });
      }
    }
  }
  return opts;
}
