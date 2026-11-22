#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';
import { parseArgs } from '../src/args.js';
import { c } from '../src/colors.js';
import { pickTargets, printTargets } from '../src/interactive.js';
import { describe, findTargets, freeTarget, printable, targetKey } from '../src/targets.js';

function printHelp() {
  console.log(`
${c.bold('pk / kp / port-kill / kill-port')} — Cross-platform port cleaner

${c.bold('Usage:')}
  pk | kp                                      Tick ports to free from an interactive checklist
  pk | kp <port> [more-ports...] [options]

${c.bold('Examples:')}  (pk and kp are the same command)
  pk 3000 | kp 3000                            Kill process on port 3000
  pk 3000 5173 8080 | kp 3000 5173 8080        Kill multiple ports
  pk 3000-3005 | kp 3000-3005                  Kill a range of ports
  pk 3000 --info | kp 3000 --info              Show what is running on port 3000 without killing
  pk --info | kp --info                        List every port in use

  Ports published by Docker are freed by stopping the container.

${c.bold('Options:')}
  -i, --info           Inspect only (do not kill)
  -f, --force          Force kill immediately (SIGKILL / /F / docker kill)
  -v, --version        Show version
  -h, --help           Show this help message
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
async function freeAll(targets, force) {
  const groups = new Map();
  for (const t of targets) {
    const key = targetKey(t);
    if (!groups.has(key)) groups.set(key, { target: t, ports: [] });
    groups.get(key).ports.push(t.port);
  }

  for (const { target, ports } of groups.values()) {
    const portList = c.bold(ports.join(', '));
    try {
      await freeTarget(target, force);
      const verb = target.kind === 'container' ? 'stopped' : 'killed';
      console.log(`${c.green('✔')} Freed port ${portList} ${c.dim(`— ${verb}`)} ${describe(target)}`);
    } catch (err) {
      process.exitCode = 1;
      console.error(`${c.red('✖')} Failed to free port ${portList} held by ${describe(target)}: ${errorMessage(err)}`);
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(c.red(`✖ ${err.message}`));
    process.exitCode = 1;
    return;
  }

  if (opts.help) return printHelp();
  if (opts.version) {
    return console.log(createRequire(import.meta.url)('../package.json').version);
  }

  // No ports: list everything (--info) or pick interactively; scripts without a TTY get help
  if (opts.ports.length === 0) {
    if (!opts.info && !process.stdin.isTTY) return printHelp();
    const targets = findTargets();
    if (targets.length === 0) return console.log(c.dim('• No ports in use.'));
    if (opts.info) return printTargets(targets);
    return freeAll(await pickTargets(targets), opts.force);
  }

  const targets = findTargets(opts.ports);
  const busy = new Set(targets.map((t) => t.port));
  for (const port of opts.ports) {
    if (!busy.has(port)) console.log(c.dim(`• Port ${port} is already free.`));
  }

  if (opts.info) {
    for (const t of targets) console.log(`${c.cyan('ℹ')} Port ${c.bold(t.port)} is in use by ${describe(t)}`);
    return;
  }
  await freeAll(targets, opts.force);
}

main().catch((err) => {
  process.exitCode = 1;
  console.error(c.red(`✖ ${printable(err.message)}`));
});
