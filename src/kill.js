import process from 'node:process';
import { exec } from './exec.js';
import { planKill, readProcessTable } from './tree.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const alive = (pid) => {
  try {
    process.kill(pid, 0); // Throws ESRCH if process already exited
    return true;
  } catch {
    return false;
  }
};

/**
 * Kill a process, but only while it still holds the port it was found on. Pids are reused, and the
 * target list can be stale (the interactive picker waits on the user), so `stillHolds` is checked
 * right before signalling and again before escalating to SIGKILL.
 * On Linux/macOS everything running under the holder goes with it (as `taskkill /T` does on Windows),
 * and with `withParent` its parent too; see planKill for what is always spared. Those other pids come
 * from one `ps` snapshot taken just before signalling, which is why they are not re-checked like the holder.
 * @param {number} pid
 * @param {boolean} force
 * @param {() => boolean} stillHolds
 * @param {boolean} [withParent]
 * @returns {Promise<string>} how the process was ended, for reporting
 */
export async function killPid(pid, force, stillHolds, withParent = false) {
  // process.kill(0) and negative pids signal whole process groups; pid 1 is init. Never valid here.
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`refusing to signal invalid PID ${pid}`);
  if (!stillHolds()) throw new Error('process is no longer listening on that port (already exited?)');

  if (process.platform === 'win32') {
    exec('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return 'taskkill /T /F';
  }

  const { pids, parent, note } = planKill(readProcessTable(), pid, withParent, process.pid);
  const others = pids.length - 1 - (parent ? 1 : 0);
  const also = [
    parent && `parent ${parent.name} (PID ${parent.pid})`,
    others > 0 && `${others} other process${others === 1 ? '' : 'es'}`,
  ].filter(Boolean);
  const detail = (also.length ? ` + ${also.join(' and ')}` : '') + (note ? ` (${note})` : '');

  // The holder's failures are the caller's (permission denied, already gone); the rest are best effort.
  const signal = (target, sig) => {
    try {
      process.kill(target, sig);
      return true;
    } catch (err) {
      if (target === pid) throw err;
      return false;
    }
  };

  if (force) {
    for (const p of pids) signal(p, 'SIGKILL');
    return `SIGKILL (forced)${detail}`;
  }

  // Graceful SIGTERM first, escalate to SIGKILL for whatever is still alive
  for (const p of pids) signal(p, 'SIGTERM');
  await sleep(300);
  let escalated = false;
  for (const p of pids) {
    if (alive(p) && (p !== pid || stillHolds())) escalated = signal(p, 'SIGKILL') || escalated;
  }
  return `${escalated ? 'SIGTERM, then SIGKILL' : 'SIGTERM (graceful)'}${detail}`;
}
