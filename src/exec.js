import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

// Windows searches the working directory before PATH when resolving a command, so running pk
// inside an untrusted folder holding a netstat.exe/docker.exe would execute it. Running from
// System32 makes that lookup hit the real system tools first.
const cwd = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : undefined;

// The 1 MiB default overflows on hosts with many sockets (netstat -ano lists every connection).
const maxBuffer = 64 * 1024 * 1024;

export const exec = (cmd, args, options) => execFileSync(cmd, args, { maxBuffer, ...options, cwd });

const execFileAsync = promisify(execFile);

/** Like `exec` but does not block, so a slow tool (docker) can run while another is being read. Resolves to stdout. */
export const execAsync = async (cmd, args, options) => (await execFileAsync(cmd, args, { maxBuffer, ...options, cwd })).stdout;
