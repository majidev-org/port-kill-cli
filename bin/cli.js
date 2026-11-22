#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';
import { parseArgs } from '../src/args.js';
import { c } from '../src/colors.js';
import { confirmParents, pickTargets, printTargets } from '../src/interactive.js';
import { describe, findTargets, freeTarget, printable, targetKey } from '../src/targets.js';

const { version } = createRequire(import.meta.url)('../package.json');

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
${row('pk --info', 'List every port in use')}

  ${section('OPTIONS')}
${flag('-i, --info', 'Inspect only (do not kill)')}
${flag('-f, --force', 'Force kill immediately (SIGKILL / taskkill /F / docker kill)')}
${flag('    --tree', 'Also stop the parent that started it, after asking (not on Windows)')}
${flag('-y, --yes', 'Do not ask before --tree stops a parent')}
${flag('-v, --version', 'Show version')}
${flag('-h, --help', 'Show this help message')}

  ${c.dim('Also available as kp, kill-port and port-kill. Ports published by Docker are freed by stopping the container.')}
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
async function freeAll(targets, { force, tree, yes }) {
  if (tree && !yes && !(await confirmParents(targets))) return console.log(c.dim('• Cancelled, nothing was stopped.'));

  const groups = new Map();
  for (const t of targets) {
    const key = targetKey(t);
    if (!groups.has(key)) groups.set(key, { target: t, ports: [] });
    groups.get(key).ports.push(t.port);
  }

  // Free everything concurrently (the graceful SIGTERM wait overlaps), but report in port order.
  const entries = [...groups.values()];
  // Stopping a container can take seconds; say what is happening (cleared before the results print).
  const busy = process.stdout.isTTY && targets.length > 0;
  if (busy) process.stdout.write(c.dim(`  Freeing ${targets.length === 1 ? 'port' : `${targets.length} ports`}…`));
  const outcomes = await Promise.allSettled(entries.map(({ target }) => freeTarget(target, force, tree)));

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
    const targets = await findTargets();
    if (targets.length === 0) return console.log(c.dim('• No ports in use.'));
    if (opts.info) return printTargets(targets);
    return freeAll(await pickTargets(targets), opts);
  }

  const targets = await findTargets(opts.ports);
  const busy = new Set(targets.map((t) => t.port));
  const free = opts.ports.filter((port) => !busy.has(port));
  if (free.length <= 10) {
    for (const port of free) console.log(c.dim(`• Port ${port} is already free.`));
  } else {
    console.log(c.dim(`• ${free.length} of ${opts.ports.length} ports are already free.`)); // pk 1-65535 must not print 65k lines
  }

  if (opts.info) {
    if (targets.length > 0) {
      printTargets(targets);
      console.log(c.dim(`  ${targets.length} in use`));
    }
    return;
  }
  await freeAll(targets, opts);
}

main().catch((err) => {
  process.exitCode = 1;
  console.error(c.red(`✖ ${printable(err.message)}`));
});
