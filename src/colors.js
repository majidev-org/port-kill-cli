import process from 'node:process';

// ANSI colors (zero dependencies). Disabled when output is piped or NO_COLOR is set.
const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (t) => (enabled ? `\x1b[${code}m${t}\x1b[0m` : String(t));

export const c = {
  green: wrap(32),
  red: wrap(31),
  yellow: wrap(33),
  blue: wrap(34),
  cyan: wrap(36),
  dim: wrap(2),
  bold: wrap(1),
};
