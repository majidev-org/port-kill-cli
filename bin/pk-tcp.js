#!/usr/bin/env node
// `pk-tcp`: pk with --tcp already given. A separate file rather than a check of the command name,
// because npm's Windows shims run bin/cli.js directly and the typed name is lost.
// The flag only sets the default: a suffix (`3000/tcp`, `5353/udp`) still wins, and adding
// --udp checks both protocols.
import process from 'node:process';

process.argv.splice(2, 0, '--tcp');
await import('./cli.js');
