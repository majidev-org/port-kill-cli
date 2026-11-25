#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';
import { basename } from 'node:path';
import { parseArgs, portLabel } from '../src/args.js';
import { c } from '../src/colors.js';
import { confirmParents, pickTargets, printTargets } from '../src/interactive.js';
import { scopeOf } from '../src/tree.js';
import { freeHint } from '../src/ui.js';
import { describe, findTargets, freeTarget, printable, targetKey } from '../src/targets.js';

const { version } = createRequire(import.meta.url)('../package.json');

/**
 * The name to suggest in hints: the one the user typed, `npx cross-port-kill` under npx, and `pk` when
 * the name is lost (Windows shims run cli.js directly). pk-udp/pk-tcp hints carry /udp already, so plain pk.
 */
function commandName() {
  if (process.env.npm_command === 'exec') return 'npx cross-port-kill';
  const name = basename(process.argv[1] ?? '').replace(/\.(js|cmd|ps1)$/i, '');
  return ['pk', 'kp', 'cpk', 'ckp', 'port-kill', 'kill-port', 'cross-port-kill', 'cross-kill-port'].includes(name) ? name : 'pk';
}

function printHelp() {
  const section = (title) => c.bold(c.cyan(title));
  const row = (usage, text) => `    ${c.bold(usage.padEnd(24))}${text}`;
  const flag = (usage, text) => `    ${c.yellow(usage.padEnd(24))}${text}`;
  console.log(`
  ${c.bold('pk')} ${c.dim(`v${version}`)}  ${c.dim('· find and free ports on Linux, macOS and Windows')}

  ${section('USAGE')}
${row('pk', 'Tick ports to free from an interactive checklist')}
${row('pk <port...> [options]', 'Free one or more ports')}

  ${section('EXAMPLES')}
${row('pk 3000', 'Free port 3000')}
${row('pk 3000 5173 8080', 'Free several ports')}
${row('pk 3000-3005', 'Free a range of ports')}
${row('pk 3000 --info', 'Show what holds port 3000, without killing')}
${row('pk 5353 --udp', 'Free UDP port 5353 (or: pk 5353/udp, pk-udp 5353)')}
${row('pk --info', 'List every port in use')}

  ${section('OR JUST SAY IT')}
${row('pk kill 3000', 'Free it (also: free, stop, close)')}
${row('pk port 3000', 'Show what holds it, and the command to free it (also: show, check, list)')}
${row('pk what is on 3000', 'Questions only ever look, never kill (also: who uses 3000, is 3000 free)')}
${row('pk kill -9 3000', 'Force it (also: pk force 3000)')}

  ${section('PORTS CAN BE WRITTEN AS')}
${row('3000  :3000', 'A port, with or without the colon')}
${row('localhost:3000', 'Any host:port or URL, e.g. [::1]:3000 or http://localhost:5173')}
${row('3000-3005  3000,5173', 'A range, or a list (also 3000..3005)')}
${row('5353/udp  udp:5353', 'With a protocol (also: pk udp 5353)')}

  ${section('OPTIONS')}
${flag('-i, --info', 'Inspect only (do not kill)')}
${flag('-f, --force', 'Force kill immediately (SIGKILL / taskkill /F / docker kill)')}
${flag('-c, --children', 'Also stop everything running under it (always so on Windows)')}
${flag('    --tree', 'Stop its parent and everything under that, after asking (not on Windows)')}
${flag('-y, --yes', 'Do not ask before --tree stops a parent')}
${flag('-u, --udp', 'Use UDP ports instead of TCP (with --tcp: both)')}
${flag('-t, --tcp', 'Use TCP ports (the default)')}
${flag('-p, --port <ports>', 'Ports as an option, kill-port style (with -m, --method tcp|udp)')}
${flag('-v, --version', 'Show version')}
${flag('-h, --help', 'Show this help message')}

  ${c.dim('Also available as kp, cpk, ckp, port-kill, kill-port, cross-port-kill and cross-kill-port; pk-udp and pk-tcp are pk --udp and pk --tcp. Ports published by Docker are freed by stopping the container.')}
`);
}

function errorMessage(err) {
  // child_process errors carry the real reason (e.g. "Access is denied", "permission denied") in stderr
  const detail = err.stderr?.toString().trim() || err.message;
  if (err.code === 'EPERM' || /access is denied|permission denied/i.test(detail)) {
    return `permission denied. Try running with ${c.bold('sudo')} or as Administrator.`;
  }
  return printable(detail);
}

/** Free the given targets, reporting each container/process once with all ports it held. */
async function freeAll(targets, { force, children, tree, yes }) {
  if (tree && !yes && !(await confirmParents(targets))) return console.log(c.dim('• Cancelled, nothing was stopped.'));

  const groups = new Map();
  for (const t of targets) {
    const key = targetKey(t);
    if (!groups.has(key)) groups.set(key, { target: t, ports: [] });
    groups.get(key).ports.push(portLabel(t.port, t.protocol));
  }

  const scope = scopeOf({ children, tree });

  // Free everything concurrently (the graceful SIGTERM wait overlaps), but report in port order.
  const entries = [...groups.values()];
  // Stopping a container can take seconds; say what is happening (cleared before the results print).
  const busy = process.stdout.isTTY && targets.length > 0;
  if (busy) process.stdout.write(c.dim(`  Freeing ${targets.length === 1 ? 'port' : `${targets.length} ports`}…`));
  const outcomes = await Promise.allSettled(entries.map(({ target }) => freeTarget(target, force, scope)));

  if (busy) process.stdout.write('\r\x1b[2K');

  let freed = 0;
  for (const [i, { target, ports }] of entries.entries()) {
    const portList = c.bold(ports.join(', '));
    try {
      if (outcomes[i].status === 'rejected') throw outcomes[i].reason;
      const how = outcomes[i].value;
      freed += ports.length;
      const verb = target.kind === 'container' ? 'stopped' : 'killed';
      console.log(`${c.green('✔')} Freed port ${portList} ${c.dim(`— ${verb}`)} ${describe(target)} ${c.dim(`via ${printable(how)}`)}`);
    } catch (err) {
      process.exitCode = 1;
      console.error(`${c.red('✖')} Failed to free port ${portList} held by ${describe(target)}: ${errorMessage(err)}`);
    }
  }

  if (targets.length > 1) {
    const color = freed === targets.length ? c.green : c.yellow;
    console.log(color(`${freed === targets.length ? '✔' : '!'} Freed ${freed} of ${targets.length} ports`));
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(c.red(`✖ ${printable(err.message)}`)); // the message echoes the user's argument
    process.exitCode = 1;
    return;
  }

  if (opts.help) return printHelp();
  if (opts.version) {
    return console.log(version);
  }

  if (opts.tree && process.platform === 'win32') {
    console.error(c.red('✖ --tree is not supported on Windows (taskkill /T already stops everything under the process)'));
    process.exitCode = 1;
    return;
  }

  // No ports: list everything (--info) or pick interactively; scripts without a TTY get help
  if (opts.ports.length === 0) {
    if (!opts.info && !process.stdin.isTTY) return printHelp();
    const targets = await findTargets([], opts.protocols);
    const which = opts.protocols.length === 1 ? `${opts.protocols[0].toUpperCase()} ` : '';
    if (targets.length === 0) return console.log(c.dim(`• No ${which}ports in use.`));
    if (opts.info) {
      printTargets(targets);
      const labels = [...new Set(targets.map((t) => portLabel(t.port, t.protocol)))];
      return console.log(freeHint(labels, { command: commandName(), all: true, protocols: opts.protocols }));
    }
    const picked = await pickTargets(targets, opts);
    return freeAll(picked.targets, { ...opts, ...picked });
  }

  const targets = await findTargets(opts.ports);
  const busy = new Set(targets.map((t) => portLabel(t.port, t.protocol)));
  const free = opts.ports.map(({ port, protocol }) => portLabel(port, protocol)).filter((label) => !busy.has(label));
  if (free.length <= 10) {
    for (const label of free) console.log(c.dim(`• Port ${label} is already free.`));
  } else {
    console.log(c.dim(`• ${free.length} of ${opts.ports.length} ports are already free.`)); // pk 1-65535 must not print 65k lines
  }

  if (opts.info) {
    if (targets.length > 0) {
      printTargets(targets);
      console.log(c.dim(`  ${targets.length} in use`));
      const labels = [...new Set(targets.map((t) => portLabel(t.port, t.protocol)))];
      console.log(freeHint(labels, { command: commandName() }));
    }
    return;
  }
  await freeAll(targets, opts);
}

main().catch((err) => {
  process.exitCode = 1;
  console.error(c.red(`✖ ${printable(err.message)}`));
});
