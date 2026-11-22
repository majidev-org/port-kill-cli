import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// End-to-end: runs the real CLI against a real listening process, so every OS in CI exercises its
// own listing tool (lsof/ss/netstat) and kill path (signals/taskkill).
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const pk = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NO_COLOR: '1' } });

/** Start a server on a free port and resolve once it is listening. */
async function startServer({ ignoreSigterm = false } = {}) {
  const code = `${ignoreSigterm ? "process.on('SIGTERM',()=>{});" : ''}
    const s=require('http').createServer().listen(0,()=>console.log(s.address().port));
    setInterval(()=>{},1e6);`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [chunk] = await once(child.stdout, 'data');
  return { child, port: Number(String(chunk).trim()) };
}

const exited = (child) =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : Promise.race([once(child, 'exit'), new Promise((_, rej) => setTimeout(() => rej(new Error('process still running')), 10_000))]);

test('e2e: --info reports, pk frees the port, second run says already free', async (t) => {
  const { child, port } = await startServer();
  t.after(() => child.kill('SIGKILL'));

  const info = pk(String(port), '--info');
  assert.match(info.stdout, new RegExp(`Port ${port} is in use by .*\\(PID ${child.pid}\\)`), info.stdout + info.stderr);
  assert.equal(child.exitCode, null, '--info must not kill');

  const kill = pk(String(port));
  assert.equal(kill.status, 0, kill.stdout + kill.stderr);
  assert.match(kill.stdout, new RegExp(`Freed port ${port}`));
  await exited(child);

  assert.match(pk(String(port)).stdout, new RegExp(`Port ${port} is already free`));
});

test('e2e: --force kills a process that ignores SIGTERM', { skip: process.platform === 'win32' && 'no SIGTERM on Windows' }, async (t) => {
  const { child, port } = await startServer({ ignoreSigterm: true });
  t.after(() => child.kill('SIGKILL'));

  assert.equal(pk(String(port), '--force').status, 0);
  await exited(child);
});

test('e2e: graceful kill escalates when SIGTERM is ignored', { skip: process.platform === 'win32' && 'no SIGTERM on Windows' }, async (t) => {
  const { child, port } = await startServer({ ignoreSigterm: true });
  t.after(() => child.kill('SIGKILL'));

  assert.equal(pk(String(port)).status, 0);
  await exited(child);
});
