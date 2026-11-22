import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// End-to-end: runs the real CLI against a real listening process, so every OS in CI exercises its
// own listing tool (lsof/ss/netstat) and kill path (signals/taskkill).
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const pk = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NO_COLOR: '1' } });

test('e2e: package.json exposes pk, kp, kill-port and port-kill as the same CLI', async () => {
  const { bin } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(bin, { 'port-kill': './bin/cli.js', pk: './bin/cli.js', kp: './bin/cli.js', 'kill-port': './bin/cli.js' });
});

// PATH='' makes lsof/ss unfindable on Unix. Windows resolves tools from System32 regardless of PATH.
test('e2e: fails loudly, never "already free", when no tool can list ports', { skip: process.platform === 'win32' && 'tools live in System32' }, () => {
  const r = spawnSync(process.execPath, [cli, '3000'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', PATH: '' } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /could not list listening ports/);
  assert.doesNotMatch(r.stdout, /already free/);
});

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
  assert.match(info.stdout, new RegExp(`:${port}\\b.*\\b${child.pid}\\b`), info.stdout + info.stderr);
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

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
const settled = async (pid) => {
  for (let i = 0; i < 50 && !gone(pid); i++) await new Promise((r) => setTimeout(r, 100));
  return gone(pid);
};

// A process (the "app") that starts a server (the port holder) as its own child and prints "<port> <holder pid>".
async function startApp() {
  const holder = `const s=require('http').createServer().listen(0,()=>console.log(s.address().port+' '+process.pid));setInterval(()=>{},1e6);`;
  const app = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(holder)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1e6);`;
  const child = spawn(process.execPath, ['-e', app], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [chunk] = await once(child.stdout, 'data');
  const [port, holderPid] = String(chunk).trim().split(' ').map(Number);
  return { child, port, holderPid };
}

test('e2e: kills what runs under the port holder too', { skip: process.platform === 'win32' && 'taskkill /T covers this' }, async (t) => {
  const grandchild = `setInterval(()=>{},1e6)`;
  const code = `const s=require('http').createServer().listen(0,()=>{
    const g=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}]);
    console.log(s.address().port+' '+g.pid)});setInterval(()=>{},1e6);`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  const [chunk] = await once(child.stdout, 'data');
  const [port, grandchildPid] = String(chunk).trim().split(' ').map(Number);
  t.after(() => { try { process.kill(grandchildPid, 'SIGKILL'); } catch {} });

  const r = pk(String(port));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\+ 1 other process\b/);
  await exited(child);
  assert.ok(await settled(grandchildPid), 'the holder\'s child must be gone');
});

test('e2e: the parent survives without --tree and is stopped with --tree --yes', { skip: process.platform === 'win32' && '--tree is not supported on Windows' }, async (t) => {
  const first = await startApp();
  t.after(() => first.child.kill('SIGKILL'));
  assert.equal(pk(String(first.port)).status, 0);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(first.child.exitCode, null, 'without --tree the parent keeps running');
  first.child.kill('SIGKILL');

  const second = await startApp();
  t.after(() => second.child.kill('SIGKILL'));
  const refused = pk(String(second.port), '--tree'); // spawnSync has no terminal, so it cannot be asked
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--tree asks before stopping a parent.*--yes/);
  assert.equal(second.child.exitCode, null, 'nothing is stopped without an answer');

  const r = pk(String(second.port), '--tree', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, / \+ parent \S+ \(PID \d+\)/);
  await exited(second.child);
  assert.ok(await settled(second.holderPid));
});

test('e2e: --tree is rejected on Windows', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const r = pk('3000', '--tree');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--tree is not supported on Windows/);
});

test('e2e: a selected port held under another selected process is freed, not reported as failed', { skip: process.platform === 'win32' && 'taskkill /T covers this' }, async (t) => {
  // the app listens itself and starts a server as its child, so one run holds both ports
  const holder = `const s=require('http').createServer().listen(0,()=>console.log(s.address().port));setInterval(()=>{},1e6);`;
  const app = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(holder)}],{stdio:['ignore','inherit','inherit']});
    const s=require('http').createServer().listen(0,()=>console.log(s.address().port));setInterval(()=>{},1e6);`;
  const child = spawn(process.execPath, ['-e', app], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  let seen = '';
  while (seen.trim().split(/\s+/).filter(Boolean).length < 2) {
    const [chunk] = await once(child.stdout, 'data');
    seen += chunk;
  }
  const ports = seen.trim().split(/\s+/).map(Number);

  const r = pk(...ports.map(String));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /Failed to free/);
  assert.match(r.stdout, /Freed 2 of 2 ports/);
  await exited(child);
});
