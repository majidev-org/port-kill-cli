import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

// Windows searches the working directory before PATH when resolving a command, so running pk
// inside an untrusted folder holding a netstat.exe/docker.exe would execute it. Running from
// System32 makes that lookup hit the real system tools first.
const cwd = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : undefined;

// The 1 MiB default overflows on hosts with many sockets (netstat -ano lists every connection).
const maxBuffer = 64 * 1024 * 1024;

export const exec = (cmd, args, options) => execFileSync(cmd, args, { maxBuffer, ...options, cwd });
