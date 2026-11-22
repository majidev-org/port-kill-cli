const FLAGS = {
  '-i': 'info',
  '--info': 'info',
  '-f': 'force',
  '--force': 'force',
  '-c': 'children',
  '--children': 'children',
  '--tree': 'tree',
  '-y': 'yes',
  '--yes': 'yes',
  '-h': 'help',
  '--help': 'help',
  '-v': 'version',
  '--version': 'version',
};

export const isValidPort = (p) => Number.isInteger(p) && p > 0 && p <= 65535;

/**
 * Parse CLI arguments into options. Throws an Error with a user-facing message on bad input.
 * @returns {{ info: boolean, force: boolean, children: boolean, tree: boolean, yes: boolean, help: boolean, version: boolean, ports: number[] }}
 */
export function parseArgs(argv) {
  const opts = { info: false, force: false, children: false, tree: false, yes: false, help: false, version: false, ports: [] };
  const ports = new Set();

  for (const arg of argv) {
    if (arg.startsWith('-')) {
      const key = FLAGS[arg];
      if (!key) throw new Error(`Unknown option: "${arg}"`);
      opts[key] = true;
      continue;
    }

    const match = arg.match(/^(\d+)(?:-(\d+))?$/);
    const start = Number(match?.[1]);
    const end = Number(match?.[2] ?? match?.[1]);
    if (!match || !isValidPort(start) || !isValidPort(end) || end < start) {
      throw new Error(`Invalid port or range: "${arg}" (expected 1–65535, e.g. 3000 or 3000-3005)`);
    }
    for (let p = start; p <= end; p++) ports.add(p);
  }

  opts.ports = [...ports];
  return opts;
}
