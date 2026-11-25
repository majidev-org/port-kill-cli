#!/usr/bin/env node
// Builds the animated terminal demos in assets/ (demo.svg and demo-*.svg), one per use case.
//
//   node scripts/make-demo.mjs
//
// Tables, colors and result lines come from the CLI's own helpers (src/ui.js, src/targets.js), so the
// demos stay in step with the real output. A few layouts are copied instead because they are not
// exported: the picker (pickCheckboxes in src/interactive.js), the --tree question (confirmParents)
// and the "how" strings of src/kill.js. Update them here if those change. Not part of the npm package.

import { writeFileSync } from 'node:fs';
import process from 'node:process';

process.stdout.isTTY = true; // colors.js only emits ANSI codes for a terminal
delete process.env.NO_COLOR;

const { c } = await import('../src/colors.js');
const { parseArgs, portLabel } = await import('../src/args.js');
const { cellsOf, describe, extra } = await import('../src/targets.js');
const { columnWidths, dataRow, freeHint, headerRow, keyHints, labelledRule, plainRow, rule, tableWidth } = await import('../src/ui.js');

// ---------------------------------------------------------------- sample data

const proc = (port, name, pid, address, command, protocol = 'tcp') =>
  ({ kind: 'process', port, protocol, name, pid, user: 'dev', address, command });
const NODE = proc(3000, 'node', 41210, '127.0.0.1', 'node server.js');
const VITE = proc(5173, 'node', 41288, '127.0.0.1', 'node node_modules/.bin/vite');
const PY = proc(8000, 'python3', 41302, '0.0.0.0', 'python3 -m http.server 8000');
const API = { kind: 'container', port: 8080, protocol: 'tcp', name: 'api', id: 'a1b2c3d4e5f6', address: '0.0.0.0', image: 'nginx:1.27' };
const MDNS = proc(5353, 'node', 41500, '0.0.0.0', 'node discovery.js', 'udp');
const PGADMIN = proc(5050, 'python3', 4180, '127.0.0.1', '/usr/pgadmin4/venv/bin/python3 pgAdmin4.py');

const GRACEFUL = 'SIGTERM (graceful)';

// ---------------------------------------------------------------- output, as the CLI prints it

const prompt = (typed, caret = false) => `${c.green('$')} ${typed}${caret ? '▋' : ''}`;

/**
 * What --info prints: printTargets() from src/interactive.js, then for named ports the "N in use" line
 * and the command to free them, or for a full listing how to pick one (see bin/cli.js).
 */
function table(targets, { named = false, protocols = ['tcp'] } = {}) {
  const rows = targets.map(cellsOf);
  const widths = columnWidths(rows, 2);
  const line = rule(tableWidth(widths, 2) - 2);
  const labels = [...new Set(targets.map((t) => portLabel(t.port, t.protocol)))];
  return [
    `  ${headerRow(widths)}`,
    `  ${line}`,
    ...rows.map((r) => `  ${dataRow(r, widths)}`),
    `  ${line}`,
    ...(named ? [c.dim(`  ${targets.length} in use`), freeHint(labels)] : [freeHint(labels, { all: true, protocols })]),
  ];
}

/** The error the real parser gives for these arguments, as bin/cli.js prints it. */
function parseError(args) {
  try {
    parseArgs(args);
  } catch (err) {
    return c.red(`✖ ${err.message}`);
  }
  throw new Error(`expected "${args.join(' ')}" to be rejected`);
}

const freed = (t, how = GRACEFUL) =>
  `${c.green('✔')} Freed port ${c.bold(portLabel(t.port, t.protocol))} ${c.dim(`— ${t.kind === 'container' ? 'stopped' : 'killed'}`)} ${describe(t)} ${c.dim(`via ${how}`)}`;
const summary = (n, of = n) => (n === of ? c.green : c.yellow)(`${n === of ? '✔' : '!'} Freed ${n} of ${of} ports`);
const alreadyFree = (label) => c.dim(`• Port ${label} is already free.`);
const freeing = (n) => c.dim(`  Freeing ${n === 1 ? 'port' : `${n} ports`}…`);

const PICKER_KEYS = [['↑↓', 'move'], ['space', 'toggle'], ['a', 'all'], ['c', 'children'], ['t', 'app'], ['enter', 'free selected'], ['q', 'quit']];
const OPTIONS = [
  { label: 'Also stop what it started', flag: '--children' },
  { label: 'Also close the app that started it', flag: '--tree' },
];

/** The checkbox picker as pickCheckboxes() draws it. */
function picker(targets, checked, cursor) {
  const cells = targets.map(cellsOf);
  const widths = columnWidths(cells, 6);
  const length = tableWidth(widths, 6) - 2;
  const left = '  pk  Select ports to free';
  const right = `${checked.size} of ${targets.length} selected`;
  const pad = ' '.repeat(Math.max(2, length + 2 - left.length - right.length));
  const rows = cells.map((row, i) => {
    const box = checked.has(i) ? '[x]' : '[ ]';
    if (i === cursor) return c.inverse(`❯ ${box} ${plainRow(row, widths)}`.padEnd(length + 2));
    return `  ${checked.has(i) ? c.green(box) : c.dim(box)} ${dataRow(row, widths)}`;
  });
  return [
    `  ${c.bold('pk')}  ${c.dim('Select ports to free')}${pad}${checked.size ? c.green(right) : c.dim(right)}`,
    `      ${headerRow(widths)}`,
    `  ${rule(length)}`,
    ...rows,
    `  ${labelledRule('', length)}`,
    ...OPTIONS.map((o) => `  ${c.dim('[ ]')} ${o.label}  ${c.dim(o.flag)}`),
    c.dim(`  ${extra(targets[cursor])}`),
    `  ${keyHints(PICKER_KEYS)}`,
  ];
}

// ---------------------------------------------------------------- sessions

/** A terminal session recorded as frames: [seconds on screen, terminal lines]. */
class Session {
  constructor({ cols = 96 } = {}) {
    this.cols = cols;
    process.stdout.columns = cols; // tables fill the terminal width, as in a real terminal
    this.lines = [];
    this.frames = [];
    this.poster = 0;
  }

  show(seconds, extra = []) {
    this.frames.push([seconds, [...this.lines, ...extra]]);
  }

  /** Type a command at the prompt, then press Enter. */
  type(command, { before = 0.5, perChar = 0.07, after = 0.35 } = {}) {
    this.show(before, [prompt('', true)]);
    for (let i = 1; i <= command.length; i++) this.show(i === command.length ? after : perChar, [prompt(command.slice(0, i), true)]);
    this.lines.push(prompt(command));
    return this;
  }

  print(lines, seconds = 1.8) {
    this.lines.push(...lines);
    this.show(seconds);
    return this;
  }

  /** Show `lines` under the output for a moment without keeping them (the "Freeing…" status line). */
  flash(lines, seconds = 0.6) {
    this.show(seconds, lines);
    return this;
  }

  /** Mark the latest frame as the still image for prefers-reduced-motion. */
  still() {
    this.poster = this.frames.length - 1;
    return this;
  }

  clear() {
    this.lines = [];
    return this;
  }

  end(seconds = 2.6) {
    this.show(seconds, [prompt('', true)]);
    return this;
  }
}

const scenes = [];
const scene = (file, title, desc, build) => scenes.push({ file, title, desc, session: build() });

scene('demo.svg', 'pk',
  'A terminal runs pk. A checklist of four ports appears; port 3000 (node) and port 8080 (a Docker container running nginx) are ticked and Enter is pressed. pk reports port 3000 freed by killing node via SIGTERM (graceful) and port 8080 freed by stopping the Docker container via docker stop, then "Freed 2 of 2 ports". Next, pk --info lists the two ports still in use, 5173 and 8000.',
  () => {
    const s = new Session();
    const targets = [NODE, VITE, PY, API];
    s.type('pk');
    const checked = new Set();
    let cursor = 0;
    const pick = (seconds) => s.show(seconds, picker(targets, checked, cursor));
    pick(1.1);
    checked.add(0); pick(0.8);
    cursor = 1; pick(0.4);
    cursor = 2; pick(0.4);
    cursor = 3; pick(0.7);
    checked.add(3); pick(1.1);
    s.still();
    s.lines.push(...picker(targets, checked, cursor));
    s.flash([freeing(2)], 1.0).print([freed(NODE), freed(API, 'docker stop'), summary(2)], 2.6);
    s.clear().type('pk --info').print(table([VITE, PY]), 0.1).end(3.2);
    return s;
  });

scene('demo-free.svg', 'pk 3000',
  'A terminal frees ports. pk 3000 frees port 3000 by killing node via SIGTERM (graceful). pk 3000 5173 8000 says port 3000 is already free and frees 5173 and 8000, then "Freed 2 of 2 ports". pk 4000-4003 says ports 4001 and 4003 are already free and frees 4000 and 4002.',
  () => {
    const s = new Session({ cols: 84 });
    const r0 = proc(4000, 'node', 41400, '127.0.0.1', 'node worker.js');
    const r2 = proc(4002, 'node', 41402, '127.0.0.1', 'node worker.js');
    s.type('pk 3000').flash([freeing(1)], 0.5).print([freed(NODE)], 1.4);
    s.type('pk 3000 5173 8000').print([alreadyFree(3000)], 0.1).flash([freeing(2)], 0.6).print([freed(VITE), freed(PY), summary(2)], 1.6).still();
    s.type('pk 4000-4003').print([alreadyFree(4001), alreadyFree(4003)], 0.1).flash([freeing(2)], 0.6).print([freed(r0), freed(r2), summary(2)], 0.1);
    return s.end(3.2);
  });

scene('demo-info.svg', 'pk --info',
  'A terminal inspects ports without killing anything. pk 3000 --info shows node on port 3000, localhost only, with its PID, user and command, then "1 in use". pk --info lists every port in use: two node servers, a python3 server reachable on all interfaces, and a Docker container running nginx.',
  () => {
    const s = new Session();
    s.type('pk 3000 --info').print(table([NODE], { named: true }), 2.0);
    s.type('pk --info').print(table([NODE, VITE, PY, API]), 0.1).still();
    return s.end(3.6);
  });

scene('demo-docker.svg', 'pk 8080',
  'A terminal frees a port published by Docker. pk 8080 --info shows the container api running nginx:1.27 on port 8080, listed as a container rather than as the Docker proxy process. pk 8080 then frees the port by stopping the container via docker stop.',
  () => {
    const s = new Session({ cols: 90 });
    s.type('pk 8080 --info').print(table([API], { named: true }), 2.0);
    s.type('pk 8080').flash([freeing(1)], 1.3).print([freed(API, 'docker stop')], 0.1).still();
    s.type('pk 8080').print([alreadyFree(8080)], 0.1);
    return s.end(3.2);
  });

scene('demo-force.svg', 'pk 9000',
  'A terminal frees ports held by processes that ignore SIGTERM. pk 9000 sends SIGTERM, waits, and escalates: "Freed port 9000 — killed node via SIGTERM, then SIGKILL". pk 9001 --force kills immediately: "via SIGKILL (forced)".',
  () => {
    const s = new Session({ cols: 84 });
    const stubborn = proc(9000, 'node', 42100, '127.0.0.1', 'node stubborn.js');
    const stuck = proc(9001, 'node', 42101, '127.0.0.1', 'node stuck.js');
    s.type('pk 9000').flash([freeing(1)], 0.8).print([freed(stubborn, 'SIGTERM, then SIGKILL')], 1.8).still();
    s.type('pk 9001 --force').flash([freeing(1)], 0.3).print([freed(stuck, 'SIGKILL (forced)')], 0.1);
    return s.end(3.2);
  });

scene('demo-tree.svg', 'pk --tree',
  'A terminal stops more than the port holder. pk 3000 --children frees port 3000 and also stops the 4 worker processes under it. pk 5050 --tree lists the parent it would stop, pgadmin4, warns that unsaved work is lost and asks "Stop them? [y/N]". After answering y, port 5050 is freed and the parent pgadmin4 is stopped too.',
  () => {
    const s = new Session({ cols: 100 });
    s.type('pk 3000 --children').flash([freeing(1)], 0.6).print([freed(NODE, `${GRACEFUL} + 4 other processes`)], 1.8);
    s.type('pk 5050 --tree').print([
      '',
      c.yellow('! --tree will also stop these parents, and everything running under them:'),
      '',
      `  ${c.bold(':5050')}  python3 ${c.dim('(PID 4180)')} ${c.dim('→')} ${c.bold('pgadmin4')} ${c.dim('(PID 4100)')}`,
      c.dim(''),
      c.dim('  Unsaved work in those programs is lost.'),
      '',
    ], 0.1);
    const ask = `${c.cyan('?')} Stop them? ${c.dim('[y/N]')} `;
    s.show(1.4, [`${ask}▋`]);
    s.show(0.5, [`${ask}y▋`]);
    s.lines.push(`${ask}y`);
    s.flash([freeing(1)], 0.6).print([freed(PGADMIN, `${GRACEFUL} + parent pgadmin4 (PID 4100)`)], 0.1).still();
    return s.end(3.4);
  });

scene('demo-udp.svg', 'pk udp ports',
  "A terminal frees a UDP port. pk 5353 says port 5353 is already free, because ports are TCP by default. pk udp ports lists the UDP ports in use: node bound to 5353 on all interfaces, and suggests 'To free one: pk 5353/udp' or picking from a list with pk --udp. pk 5353/udp frees it: 'Freed port 5353/udp — killed node via SIGTERM (graceful)'.",
  () => {
    const s = new Session({ cols: 84 });
    s.type('pk 5353').print([alreadyFree(5353)], 1.4);
    s.type('pk udp ports').print(table([MDNS], { protocols: ['udp'] }), 2.2);
    s.type('pk 5353/udp').flash([freeing(1)], 0.5).print([freed(MDNS)], 0.1).still();
    return s.end(3.2);
  });

scene('demo-words.svg', 'pk port 3000',
  "A terminal uses plain words. pk port 3000 shows node holding port 3000 and ends with 'To free it: pk 3000'. pk kill 3000 frees it. pk what is on 8080 shows the Docker container api and how to free it; a question only ever looks. pk kil 5173 is a typo and pk answers: Unknown word 'kil'. Did you mean 'kill'?",
  () => {
    const s = new Session({ cols: 92 });
    s.type('pk port 3000').print(table([NODE], { named: true }), 1.8);
    s.type('pk kill 3000').flash([freeing(1)], 0.5).print([freed(NODE)], 1.2);
    s.type('pk what is on 8080').print(table([API], { named: true }), 0.1).still();
    s.show(1.6);
    s.type('pk kil 5173').print([parseError(['kil', '5173'])], 0.1);
    return s.end(3.2);
  });

scene('demo-formats.svg', 'pk localhost:3000',
  "A terminal frees ports written in different ways, as pasted from an error message or a browser. pk localhost:3000 frees node on 3000. pk http://localhost:5173/ frees the vite server. pk :::8000, the address from an EADDRINUSE error, frees python3 on 8000. pk udp:5353 frees UDP port 5353. pk --forse 9000 is a typo and pk answers: Did you mean '--force'?",
  () => {
    const s = new Session({ cols: 86 });
    s.type('pk localhost:3000').flash([freeing(1)], 0.4).print([freed(NODE)], 0.9);
    s.type('pk http://localhost:5173/').flash([freeing(1)], 0.4).print([freed(VITE)], 0.9);
    s.type('pk :::8000').flash([freeing(1)], 0.4).print([freed(PY)], 0.9);
    s.type('pk udp:5353').flash([freeing(1)], 0.4).print([freed(MDNS)], 0.1).still();
    s.show(0.9);
    s.type('pk --forse 9000').print([parseError(['--forse', '9000'])], 0.1);
    return s.end(3.2);
  });

// ---------------------------------------------------------------- ANSI → SVG

const FONT = 15;
const CW = 9; // character cell width
const LH = 22; // line height
const PAD_X = 22;
const BAR = 40; // title bar height

const PALETTE = {
  fg: '#cdd6f4', dim: '#9399b2', bg: '#1e1e2e', bar: '#181825', border: '#313244',
  31: '#f38ba8', 32: '#a6e3a1', 33: '#f9e2af', 34: '#89b4fa', 36: '#89dceb',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Split one ANSI line into styled runs with their starting column. */
function runs(line) {
  const out = [];
  let state = {};
  let col = 0;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      for (const code of m[1].split(';').map(Number)) {
        if (code === 0) state = {};
        else if (code === 1) state = { ...state, bold: true };
        else if (code === 2) state = { ...state, dim: true };
        else if (code === 7) state = { ...state, inverse: true };
        else if (PALETTE[code]) state = { ...state, color: PALETTE[code] };
      }
    } else if (part) {
      // the caret is drawn as a block of its own
      for (const [i, piece] of part.split('▋').entries()) {
        if (i > 0) out.push({ caret: true, col: col++ });
        if (!piece) continue;
        const len = [...piece].length;
        out.push({ text: piece, col, len, ...state });
        col += len;
      }
    }
  }
  return out;
}

function lineSvg(line, row) {
  const y = BAR + 18 + row * LH;
  const base = y + FONT - 1;
  let svg = '';
  for (const r of runs(line)) {
    const x = PAD_X + r.col * CW;
    if (r.caret) {
      svg += `<rect class="caret" x="${x}" y="${y - 1}" width="${CW}" height="${LH - 4}" fill="${PALETTE.fg}"/>`;
      continue;
    }
    let fill = r.color ?? (r.dim ? PALETTE.dim : PALETTE.fg);
    if (r.inverse) {
      svg += `<rect x="${x}" y="${y - 3}" width="${r.len * CW}" height="${LH}" fill="${fill === PALETTE.dim ? PALETTE.fg : fill}"/>`;
      fill = PALETTE.bg;
    }
    if (!r.text.trim()) continue;
    // textLength pins every run to the character grid, whatever monospace font the viewer has
    const weight = r.bold ? ' font-weight="700"' : '';
    svg += `<text x="${x}" y="${base}" textLength="${r.len * CW}" lengthAdjust="spacingAndGlyphs" fill="${fill}"${weight}>${esc(r.text)}</text>`;
  }
  return svg;
}

function render({ title, desc, session }) {
  const { frames, poster, cols } = session;
  const rows = Math.max(...frames.map(([, lines]) => lines.length));
  const W = PAD_X * 2 + cols * CW;
  const H = BAR + 18 + rows * LH + 14;
  const total = frames.reduce((sum, [s]) => sum + s, 0);
  const starts = [];
  frames.reduce((t, [s]) => (starts.push(t), t + s), 0);

  // Each distinct (row, content) is drawn once and shown only during the frames that contain it.
  const pieces = new Map();
  frames.forEach(([, lines], i) =>
    lines.forEach((line, row) => {
      const key = `${row}:${line}`;
      if (!pieces.has(key)) pieces.set(key, { svg: lineSvg(line, row), shown: new Set() });
      pieces.get(key).shown.add(i);
    }),
  );

  const pct = (t) => `${+((t / total) * 100).toFixed(3)}%`;
  const keyframes = new Map(); // signature -> animation name
  let body = '';
  for (const { svg, shown } of pieces.values()) {
    if (!svg) continue; // blank line
    const stops = [];
    let prev;
    frames.forEach((_f, i) => {
      const v = shown.has(i) ? 1 : 0;
      if (v !== prev) stops.push(`${pct(starts[i])}{opacity:${v}}`);
      prev = v;
    });
    stops.push(`100%{opacity:${prev}}`);
    const sig = stops.join('');
    if (!keyframes.has(sig)) keyframes.set(sig, `k${keyframes.size}`);
    body += `<g class="${keyframes.get(sig)}${shown.has(poster) ? ' p' : ''}">${svg}</g>\n`;
  }

  const css = [
    `text{font-family:'JetBrains Mono','SF Mono',Menlo,'DejaVu Sans Mono',Consolas,monospace;font-size:${FONT}px;white-space:pre}`,
    `g{opacity:0;animation-duration:${total.toFixed(2)}s;animation-iteration-count:infinite;animation-timing-function:step-end}`,
    ...[...keyframes].map(([sig, name]) => `.${name}{animation-name:${name}}@keyframes ${name}{${sig}}`),
    '.caret{animation:blink 1s step-end infinite}@keyframes blink{50%{opacity:0}}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}g.p{opacity:1}}',
  ].join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">cross-port-kill: ${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<style>
${css}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${PALETTE.bg}" stroke="${PALETTE.border}"/>
<path d="M12.5 0.5h${W - 25}a12 12 0 0 1 12 12v${BAR - 12}h-${W - 1}v-${BAR - 12}a12 12 0 0 1 12-12z" fill="${PALETTE.bar}"/>
<circle cx="24" cy="${BAR / 2}" r="6.5" fill="#f38ba8"/><circle cx="46" cy="${BAR / 2}" r="6.5" fill="#f9e2af"/><circle cx="68" cy="${BAR / 2}" r="6.5" fill="#a6e3a1"/>
<text x="${W / 2}" y="${BAR / 2 + 5}" text-anchor="middle" fill="${PALETTE.dim}">${esc(title)}</text>
${body}</svg>
`;
  return { svg, total, W, H, count: frames.length };
}

for (const s of scenes) {
  const { svg, total, W, H, count } = render(s);
  writeFileSync(new URL(`../assets/${s.file}`, import.meta.url), svg);
  console.error(`assets/${s.file}: ${W}×${H}, ${count} frames, ${total.toFixed(1)} s, ${(svg.length / 1024).toFixed(1)} KB`);
}
