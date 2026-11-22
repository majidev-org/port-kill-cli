import process from 'node:process';
import { exec } from './exec.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kill a process, but only while it still holds the port it was found on. Pids are reused, and the
 * target list can be stale (the interactive picker waits on the user), so `stillHolds` is checked
 * right before signalling and again before escalating to SIGKILL.
 * @param {number} pid
 * @param {boolean} force
 * @param {() => boolean} stillHolds
 * @returns {Promise<string>} how the process was ended, for reporting
 */
export async function killPid(pid, force, stillHolds) {
  if (!stillHolds()) throw new Error('process is no longer listening on that port (already exited?)');

  if (process.platform === 'win32') {
    exec('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return 'taskkill /T /F';
  }

  if (force) {
    process.kill(pid, 'SIGKILL');
    return 'SIGKILL (forced)';
  }

  // Graceful SIGTERM first, escalate to SIGKILL if still alive
  process.kill(pid, 'SIGTERM');
  await sleep(300);
  try {
    process.kill(pid, 0); // Throws ESRCH if process already exited
    if (stillHolds()) {
      process.kill(pid, 'SIGKILL');
      return 'SIGTERM, then SIGKILL';
    }
  } catch {}
  return 'SIGTERM (graceful)';
}
