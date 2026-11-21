import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/args.js';
import { parseDockerPs } from '../src/docker.js';
import { parseSelection } from '../src/interactive.js';
import { parseLsof, parseNetstat, parseSs } from '../src/listeners.js';

test('parseArgs: ports, ranges, flags', () => {
  const opts = parseArgs(['3000', '3000-3002', '-f', '--info']);
  assert.deepEqual(opts.ports, [3000, 3001, 3002]);
  assert.equal(opts.force, true);
  assert.equal(opts.info, true);
});

test('parseArgs: rejects bad input', () => {
  for (const bad of ['abc', '0', '70000', '3005-3000', '3000-abc', '--nope']) {
    assert.throws(() => parseArgs([bad]), undefined, bad);
  }
});

test('parseLsof', () => {
  const out = 'p123\ncnode\nf20\nn*:3000\nf21\nn[::1]:3000\np456\ncpython3\nf3\nn127.0.0.1:8000\n';
  assert.deepEqual(parseLsof(out), [
    { port: 3000, pid: 123, name: 'node' },
    { port: 3000, pid: 123, name: 'node' },
    { port: 8000, pid: 456, name: 'python3' },
  ]);
});

test('parseSs', () => {
  const out = [
    'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0      511    *:3000             *:*               users:(("node",pid=123,fd=20))',
    'LISTEN 0      4096   127.0.0.53%lo:53   0.0.0.0:*',
  ].join('\n');
  assert.deepEqual(parseSs(out), [{ port: 3000, pid: 123, name: 'node' }]);
});

test('parseNetstat: listening sockets only, IPv4 and IPv6', () => {
  const out = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234',
    '  TCP    [::]:5173              [::]:0                 ABHÖREN         99',
    '  TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     1234',
    '  UDP    0.0.0.0:5353           *:*                                    77',
  ].join('\r\n');
  assert.deepEqual(parseNetstat(out), [
    { port: 3000, pid: 1234 },
    { port: 5173, pid: 99 },
  ]);
});

test('parseDockerPs: published ports, ranges, IPv6 duplicates', () => {
  const out = [
    'a1b2\tweb\t0.0.0.0:8080->80/tcp, :::8080->80/tcp',
    'c3d4\tdb\t5432/tcp',
    'e5f6\tmulti\t0.0.0.0:5000-5001->5000-5001/tcp, [::]:9229->9229/tcp',
  ].join('\n');
  assert.deepEqual(parseDockerPs(out), [
    { port: 8080, id: 'a1b2', name: 'web' },
    { port: 5000, id: 'e5f6', name: 'multi' },
    { port: 5001, id: 'e5f6', name: 'multi' },
    { port: 9229, id: 'e5f6', name: 'multi' },
  ]);
});

test('parseSelection', () => {
  assert.deepEqual(parseSelection('1 3', 5), [0, 2]);
  assert.deepEqual(parseSelection('2-4,1', 5), [1, 2, 3, 0]);
  assert.deepEqual(parseSelection('a', 3), [0, 1, 2]);
  assert.throws(() => parseSelection('6', 5));
  assert.throws(() => parseSelection('x', 5));
});
