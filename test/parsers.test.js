import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/args.js';
import { isLocalEndpoint, parseDockerPs } from '../src/docker.js';
import { parseSelection } from '../src/interactive.js';
import { parseLsof, parseNetstat, parseSs, reach } from '../src/listeners.js';
import { killPid } from '../src/kill.js';
import { cellsOf, printable } from '../src/targets.js';
import { parseProcessTable, planKill, scopeOf } from '../src/tree.js';
import { columnWidths, fit } from '../src/ui.js';

const tcp = (...ports) => ports.map((port) => ({ port, protocol: 'tcp' }));
const udp = (...ports) => ports.map((port) => ({ port, protocol: 'udp' }));

test('parseArgs: ports, ranges, flags', () => {
  const opts = parseArgs(['3000', '3000-3002', '-f', '--info']);
  assert.deepEqual(opts.ports, tcp(3000, 3001, 3002));
  assert.deepEqual(opts.protocols, ['tcp']);
  assert.equal(opts.force, true);
  assert.equal(opts.info, true);
});

test('parseArgs: --udp switches every port to UDP, --tcp --udp checks both', () => {
  assert.deepEqual(parseArgs(['5353', '-u']).ports, udp(5353));
  assert.deepEqual(parseArgs(['--udp']).protocols, ['udp']);
  assert.deepEqual(parseArgs(['53', '--tcp', '--udp']).ports, [...tcp(53), ...udp(53)]);
  assert.deepEqual(parseArgs(['-t']).protocols, ['tcp']);
});

test('parseArgs: a /tcp or /udp suffix sets the protocol of that argument only', () => {
  assert.deepEqual(parseArgs(['5353/udp', '3000']).ports, [...udp(5353), ...tcp(3000)]);
  assert.deepEqual(parseArgs(['3000/tcp', '--udp']).ports, tcp(3000));
  assert.deepEqual(parseArgs(['4000-4001/UDP']).ports, udp(4000, 4001));
  assert.deepEqual(parseArgs(['53/udp', '53/udp', '53']).ports, [...udp(53), ...tcp(53)]); // duplicates collapse
});

test('parseArgs: forgiving port formats', () => {
  const ports = (...args) => parseArgs(args).ports;
  for (const same of [':3000', 'localhost:3000', '127.0.0.1:3000', '0.0.0.0:3000', '[::1]:3000', ':::3000', '*:3000', 'http://localhost:3000/', 'HTTP://LOCALHOST:3000/app?x=1']) {
    assert.deepEqual(ports(same), tcp(3000), same);
  }
  assert.deepEqual(ports('http://localhost'), tcp(80));
  assert.deepEqual(ports('https://example.test/'), tcp(443));
  assert.deepEqual(ports('3000,5173'), tcp(3000, 5173));
  assert.deepEqual(ports('3000,', '5173'), tcp(3000, 5173)); // "pk 3000, 5173"
  for (const range of ['3000..3002', '3000–3002', '3000-3002', 'localhost:3000-3002']) assert.deepEqual(ports(range), tcp(3000, 3001, 3002), range);
  for (const same of ['5353/udp', '5353:udp', 'udp/5353', 'udp:5353', 'UDP:5353', 'localhost:5353/udp']) assert.deepEqual(ports(same), udp(5353), same);
});

test('parseArgs: forgiving options', () => {
  assert.deepEqual(parseArgs(['udp', '5353']).ports, udp(5353));
  assert.deepEqual(parseArgs(['5353', 'UDP']).ports, udp(5353));
  for (const word of ['list', 'ls', 'info']) assert.equal(parseArgs([word]).info, true, word);
  assert.equal(parseArgs(['help']).help, true);
  assert.equal(parseArgs(['--UDP']).udp, true);
  assert.equal(parseArgs(['-udp']).udp, true);
  assert.equal(parseArgs(['-tree']).tree, true);
  const combined = parseArgs(['-ui', '5353']);
  assert.equal(combined.info, true);
  assert.deepEqual(combined.ports, udp(5353));
  // kill-port's syntax
  assert.deepEqual(parseArgs(['--port', '3000']).ports, tcp(3000));
  assert.deepEqual(parseArgs(['-p', '3000,3001']).ports, tcp(3000, 3001));
  assert.deepEqual(parseArgs(['--port=3000', '--method', 'udp']).ports, udp(3000));
  assert.deepEqual(parseArgs(['-p', '53', '-m', 'UDP']).ports, udp(53));
});

test('parseArgs: words say what to do', () => {
  const run = (...args) => parseArgs(args);
  for (const verb of ['kill', 'free', 'stop', 'close', 'KILL', 'kill-port']) {
    const o = run(verb, '3000');
    assert.deepEqual([o.info, o.ports], [false, tcp(3000)], verb);
  }
  for (const look of ['port', 'show', 'check', 'find', 'status', 'list']) {
    const o = run(look, '3000');
    assert.deepEqual([o.info, o.ports], [true, tcp(3000)], look);
  }
  assert.equal(run('kill', 'port', '3000').info, false); // "kill port 3000": the verb wins over "port"
  assert.equal(run('kill', 'the', 'port', 'on', '3000').info, false);
  assert.equal(run('what', 'is', 'on', '3000?').info, true);
  assert.equal(run('who', 'uses', '3000').info, true);
  assert.equal(run("what's", 'on', ':3000').info, true);
  assert.equal(run('is', '3000', 'free?').info, true); // a question never kills, even with "free" in it
  assert.equal(run('kill', '3000', '--info').info, true); // an explicit flag wins
  assert.equal(run('kill', '-9', '3000').force, true);
  assert.equal(run('force', 'kill', '3000').force, true);
  assert.deepEqual(run('kill', 'udp', '5353').ports, udp(5353));
  assert.equal(run('kill', '3000', 'children').children, true);
});

test('parseArgs: a protocol named on its own lists those ports', () => {
  const run = (...args) => parseArgs(args);
  const look = (o) => [o.info, o.protocols, o.ports.length];
  assert.deepEqual(look(run('udp')), [true, ['udp'], 0]);
  assert.deepEqual(look(run('tcp')), [true, ['tcp'], 0]);
  assert.deepEqual(look(run('udp', 'ports')), [true, ['udp'], 0]);
  assert.deepEqual(look(run('tcp', 'udp', 'ports')), [true, ['tcp', 'udp'], 0]);
  assert.deepEqual(look(run('tcp', 'and', 'udp')), [true, ['tcp', 'udp'], 0]);
  assert.deepEqual(look(run('both')), [true, ['tcp', 'udp'], 0]);
  assert.deepEqual(look(run('all', 'udp', 'ports')), [true, ['udp'], 0]);
  assert.deepEqual(look(run('show', 'me', 'open', 'udp', 'ports')), [true, ['udp'], 0]);
  // Not a listing: a kill word picks, a port frees, and the flags keep opening the picker
  assert.equal(run('kill', 'udp').info, false);
  assert.equal(run('udp', '5353').info, false);
  assert.equal(run('--udp').info, false);
});

test('parseArgs: mistyped words suggest the closest one', () => {
  assert.throws(() => parseArgs(['kil', '3000']), /Unknown word: "kil". Did you mean "kill"\?/);
  assert.throws(() => parseArgs(['prot', '3000']), /Did you mean "port"\?/);
  assert.throws(() => parseArgs(['banana']), /pk --help/);
});

test('parseArgs: unknown options suggest the closest one', () => {
  assert.throws(() => parseArgs(['--forse']), /Did you mean "--force"/);
  assert.throws(() => parseArgs(['--udpp']), /Did you mean "--udp"/);
  assert.throws(() => parseArgs(['--zzzzzz']), /pk --help/);
  assert.throws(() => parseArgs(['--port']), /needs a value/);
  assert.throws(() => parseArgs(['--method', 'sctp']), /Invalid protocol/);
});

test('parseArgs: rejects bad input', () => {
  for (const bad of ['abc', '0', '70000', '3005-3000', '3000-abc', '--nope', '3000/sctp', '3000/', '/udp', 'localhost', 'ftp://host', 'http://', '-x', '--info=1', 'kil', 'localhost']) {
    assert.throws(() => parseArgs([bad]), undefined, bad);
  }
});

test('parseLsof', () => {
  const out = 'p123\ncnode\nf20\nn*:3000\nf21\nn[::1]:3000\np456\ncpython3\nf3\nn127.0.0.1:8000\n';
  assert.deepEqual(parseLsof(out), [
    { port: 3000, protocol: 'tcp', pid: 123, name: 'node', address: '*' },
    { port: 3000, protocol: 'tcp', pid: 123, name: 'node', address: '[::1]' },
    { port: 8000, protocol: 'tcp', pid: 456, name: 'python3', address: '127.0.0.1' },
  ]);
});

test('parseLsof: protocol per socket, connected UDP client sockets skipped', () => {
  const out = 'p123\ncnode\nPTCP\nn*:3000\nPUDP\nn*:5353\nPUDP\nn10.0.0.2:51000->8.8.8.8:53\n';
  assert.deepEqual(parseLsof(out), [
    { port: 3000, protocol: 'tcp', pid: 123, name: 'node', address: '*' },
    { port: 5353, protocol: 'udp', pid: 123, name: 'node', address: '*' },
  ]);
});

test('parseSs', () => {
  const out = [
    'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0      511    *:3000             *:*               users:(("node",pid=123,fd=20))',
    'LISTEN 0      4096   127.0.0.53%lo:53   0.0.0.0:*',
  ].join('\n');
  assert.deepEqual(parseSs(out), [{ port: 3000, protocol: 'tcp', pid: 123, name: 'node', address: '*' }]);
});

test('parseSs: UDP alone, and the Netid column of -tulnp', () => {
  const udpOnly = [
    'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'UNCONN 0      0      0.0.0.0:5353       0.0.0.0:*         users:(("avahi",pid=7,fd=12))',
  ].join('\n');
  assert.deepEqual(parseSs(udpOnly, 'udp'), [{ port: 5353, protocol: 'udp', pid: 7, name: 'avahi', address: '0.0.0.0' }]);

  const both = [
    'Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'udp   UNCONN 0      0      0.0.0.0:5353       0.0.0.0:*         users:(("avahi",pid=7,fd=12))',
    'tcp   LISTEN 0      511    *:3000             *:*               users:(("node",pid=123,fd=20))',
  ].join('\n');
  assert.deepEqual(parseSs(both), [
    { port: 5353, protocol: 'udp', pid: 7, name: 'avahi', address: '0.0.0.0' },
    { port: 3000, protocol: 'tcp', pid: 123, name: 'node', address: '*' },
  ]);
});

test('parseNetstat: listening TCP and bound UDP sockets, IPv4 and IPv6', () => {
  const out = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234',
    '  TCP    [::]:5173              [::]:0                 ABHÖREN         99',
    '  TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     1234',
    '  UDP    0.0.0.0:5353           *:*                                    77',
    '  UDP    [::]:5353              *:*                                    77',
  ].join('\r\n');
  assert.deepEqual(parseNetstat(out), [
    { port: 3000, protocol: 'tcp', pid: 1234, address: '0.0.0.0' },
    { port: 5173, protocol: 'tcp', pid: 99, address: '[::]' },
    { port: 5353, protocol: 'udp', pid: 77, address: '0.0.0.0' },
    { port: 5353, protocol: 'udp', pid: 77, address: '[::]' },
  ]);
});

test('parseDockerPs: published ports, ranges, IPv6 duplicates', () => {
  const out = [
    'a1b2\tweb\tnginx:1.27\t0.0.0.0:8080->80/tcp, :::8080->80/tcp',
    '--rm\tevil\talpine\t0.0.0.0:7000->80/tcp', // not a hex id: must never reach `docker stop`
    'c3d4\tdb\tpostgres\t5432/tcp',
    'e5f6\tmulti\tapp\t127.0.0.1:5000-5001->5000-5001/tcp, [::]:9229->9229/tcp',
    'f7a8\tdns\tcoredns\t0.0.0.0:53->53/udp, 0.0.0.0:53->53/tcp, :::53->53/udp',
  ].join('\n');
  const box = (port, protocol, id, name, image, address) => ({ port, protocol, id, name, image, address });
  assert.deepEqual(parseDockerPs(out), [
    box(8080, 'tcp', 'a1b2', 'web', 'nginx:1.27', '0.0.0.0'),
    box(5000, 'tcp', 'e5f6', 'multi', 'app', '127.0.0.1'),
    box(5001, 'tcp', 'e5f6', 'multi', 'app', '127.0.0.1'),
    box(9229, 'tcp', 'e5f6', 'multi', 'app', '[::]'),
    box(53, 'udp', 'f7a8', 'dns', 'coredns', '0.0.0.0'), // the same number over TCP is a separate port
    box(53, 'tcp', 'f7a8', 'dns', 'coredns', '0.0.0.0'),
  ]);
});

test('parseSelection', () => {
  assert.deepEqual(parseSelection('1 3', 5), [0, 2]);
  assert.deepEqual(parseSelection('2-4,1', 5), [1, 2, 3, 0]);
  assert.deepEqual(parseSelection('a', 3), [0, 1, 2]);
  assert.throws(() => parseSelection('6', 5));
  assert.throws(() => parseSelection('x', 5));
});

test('printable: neutralizes terminal escapes and newlines in untrusted names', () => {
  assert.equal(printable('node\x1b[2J\x9b0m\n✔ Freed'), 'node [2J 0m ✔ Freed');
});

test('printable: neutralizes bidi overrides, zero-width and line-separator characters', () => {
  assert.equal(printable('a\u202Eb\u200Bc\u2028d\u2066e\ufeff'), 'a b c d e ');
});

test('isLocalEndpoint: only a daemon on this machine may own local ports', () => {
  for (const ok of ['unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine', 'tcp://localhost:2375', 'tcp://127.0.0.1:2375', 'tcp://[::1]:2375']) {
    assert.equal(isLocalEndpoint(ok), true, ok);
  }
  for (const remote of ['tcp://203.0.113.1:2375', 'ssh://user@build-host', 'tcp://localhost.evil.example:2375', 'http://localhost:2375', '', 'garbage']) {
    assert.equal(isLocalEndpoint(remote), false, remote);
  }
});

test('reach: who can connect to a bind address', () => {
  assert.equal(reach('*'), 'all interfaces');
  assert.equal(reach('0.0.0.0'), 'all interfaces');
  assert.equal(reach('[::]'), 'all interfaces');
  assert.equal(reach('127.0.0.1'), 'localhost only');
  assert.equal(reach('[::1]'), 'localhost only');
  assert.equal(reach('192.168.1.5'), '192.168.1.5');
});

test('killPid: refuses pids that would signal process groups or init', async () => {
  for (const bad of [0, 1, -1, NaN, 1.5]) {
    await assert.rejects(killPid(bad, true, () => true), /invalid PID/, String(bad));
  }
});

test('fit: truncates with an ellipsis and never exceeds the width', () => {
  assert.equal(fit('abc', 5), 'abc');
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.equal(fit('abcdef', 4).length, 4);
});

test('cellsOf: sanitized cells for processes and containers', () => {
  const proc = { kind: 'process', port: 3000, pid: 42, name: 'no\x1bde', address: '*', user: 'me', command: 'node a\nb' };
  assert.deepEqual(cellsOf(proc), { port: ':3000', name: 'no de', id: '42', user: 'me', access: 'all interfaces', command: 'node a b' });
  const box = { kind: 'container', port: 80, id: 'a1b2c3d4e5f6a7b8', name: 'web', image: 'nginx', address: '127.0.0.1' };
  assert.deepEqual(cellsOf(box), { port: ':80', name: 'web', id: 'a1b2c3d4e5f6', user: 'container', access: 'localhost only', command: 'nginx' });
  assert.equal(cellsOf({ ...proc, protocol: 'tcp' }).port, ':3000');
  assert.equal(cellsOf({ ...proc, port: 5353, protocol: 'udp' }).port, ':5353/udp');
});

test('columnWidths: the command column takes the remaining terminal width', () => {
  const rows = [cellsOf({ kind: 'process', port: 3000, pid: 1234, name: 'node', address: '127.0.0.1', user: 'me', command: 'x'.repeat(300) })];
  const wide = columnWidths(rows, 2, 120);
  const narrow = columnWidths(rows, 2, 80);
  assert.ok(wide.command > narrow.command);
  assert.equal(columnWidths(rows, 2, undefined).command, 100); // piped: fixed cap, no terminal to measure
});

// 10 systemd > 20 code(main) > 30 code(helper, holds the port) > 40 worker; 20 also has 31 (sibling helper);
// 10 > 50 bash > 60 pk, so 50 and 60 are pk's own lineage
const table = parseProcessTable(
  ['1 0 systemd', '10 1 systemd', '20 10 code', '30 20 code', '40 30 node', '31 20 code', '50 10 /bin/bash', '60 50 node', '70 60 node'].join('\n'),
);

test('parseProcessTable: pid, ppid and basename of comm', () => {
  assert.deepEqual(parseProcessTable('  50   10 /bin/bash\n'), new Map([[50, { ppid: 10, name: 'bash' }]]));
});

test("planKill: 'children' is the holder and everything under it, nothing above", () => {
  assert.deepEqual(planKill(table, 30, 'children', 60), { pids: [30, 40], parent: undefined, note: '' });
});

test("planKill: 'parent' is the parent and its whole subtree", () => {
  const plan = planKill(table, 30, 'parent', 60);
  assert.deepEqual(plan.pids.sort((a, b) => a - b), [20, 30, 31, 40]);
  assert.deepEqual(plan.parent, { pid: 20, name: 'code' });
});

test('planKill: the holder alone is the default, and nothing is looked up', () => {
  assert.deepEqual(planKill(new Map(), 30, 'holder', 60), { pids: [30], parent: undefined, note: '' });
});

test('planKill: spares init, shells and session managers as parent', () => {
  assert.deepEqual(planKill(table, 20, 'parent', 60), { pids: [20, 30, 31, 40], parent: undefined, note: 'parent systemd (PID 10) left running: protected' });
  assert.match(planKill(table, 60, 'parent', 999).note, /parent bash \(PID 50\) left running: protected/);
  assert.equal(planKill(table, 999, 'parent', 60).note, 'parent not found');
});

test('planKill: never signals pk or the processes it runs under, nor anything below them', () => {
  // the holder is pk's grandparent: its subtree is pruned at pk's lineage
  const own = parseProcessTable(['10 1 term', '50 10 bash', '60 50 pk', '55 10 helper', '90 50 sibling'].join('\n'));
  assert.deepEqual(planKill(own, 10, 'children', 60).pids.sort((a, b) => a - b), [10, 55]);
  // a parent that pk runs under is spared even though it is not a shell
  const editor = parseProcessTable(['20 1 code', '30 20 code', '40 30 pk'].join('\n'));
  assert.deepEqual(planKill(editor, 30, 'parent', 40), { pids: [30], parent: undefined, note: 'parent code (PID 20) left running: pk is running inside it' });
});

test('scopeOf: the parent includes the children, which include the holder', () => {
  assert.equal(scopeOf({ children: false, tree: false }), 'holder');
  assert.equal(scopeOf({ children: true, tree: false }), 'children');
  assert.equal(scopeOf({ children: false, tree: true }), 'parent');
  assert.equal(scopeOf({ children: true, tree: true }), 'parent');
});
