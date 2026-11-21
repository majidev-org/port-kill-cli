import { execFileSync } from 'node:child_process';
import process from 'node:process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function killPid(pid, force) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return;
  }

  if (force) {
    process.kill(pid, 'SIGKILL');
    return;
  }

  // Graceful SIGTERM first, escalate to SIGKILL if still alive
  process.kill(pid, 'SIGTERM');
  await sleep(300);
  try {
    process.kill(pid, 0); // Throws ESRCH if process already exited
    process.kill(pid, 'SIGKILL');
  } catch {}
}
