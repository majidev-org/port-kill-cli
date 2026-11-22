<p align="center">
  <img src="https://raw.githubusercontent.com/majidev-org/port-kill-cli/main/assets/logo.svg" alt="pk – port-kill-cli logo" width="300">
</p>

# port-kill-cli (`pk` / `kp`)

[![npm version](https://img.shields.io/npm/v/@majidev-org/port-kill-cli)](https://www.npmjs.com/package/@majidev-org/port-kill-cli)
[![Publish](https://github.com/majidev-org/port-kill-cli/actions/workflows/publish.yml/badge.svg)](https://github.com/majidev-org/port-kill-cli/actions/workflows/publish.yml)
[![node](https://img.shields.io/node/v/@majidev-org/port-kill-cli)](https://nodejs.org)
[![license: MIT](https://img.shields.io/npm/l/@majidev-org/port-kill-cli)](LICENSE)

A fast, zero-dependency, cross-platform CLI to find and kill processes occupying ports on **Linux**, **macOS**, and **Windows**.

Stop Googling `lsof` vs `netstat`—just run `pk 3000` (or `kp 3000`, same thing).

[npm package](https://www.npmjs.com/package/@majidev-org/port-kill-cli) · [Source](https://github.com/majidev-org/port-kill-cli) · [Report an issue](https://github.com/majidev-org/port-kill-cli/issues) · [Security policy](SECURITY.md) · [Privacy](PRIVACY.md) · [Terms](TERMS.md)

## Features
- **Zero Dependencies:** Instant startup with `npx`—no bloated `node_modules` tree.
- **Cross-Platform:** Works seamlessly on Linux (`lsof` / `ss`), macOS (`lsof`), and Windows (`netstat` / `taskkill`).
- **Safe & Graceful:** On Linux/macOS sends `SIGTERM` first so servers clean up properly, escalating to `SIGKILL` only if needed. Before every signal it re-checks that the PID still holds the port, so a recycled PID is never killed by mistake. Windows has no graceful signal for server processes, so `taskkill /T /F` is always used there.
- **Process Info:** Displays the exact process name and PID freed.
- **Multi-Port & Ranges:** Kill single ports, multiple ports, or port ranges in one command.
- **Docker-Aware:** Ports published by a Docker container are freed with `docker stop` instead of killing Docker's proxy (which would break Docker networking). Remote Docker contexts (`DOCKER_HOST=tcp://…`, `ssh://…`) are ignored, so a container on another machine is never stopped because its port number matches.
- **Interactive Mode:** Run `pk` (or `kp`) with no arguments to see every port in use and pick which ones to free.

## Requirements
- [Node.js](https://nodejs.org) 18 or newer.
- Linux/macOS: [`lsof`](https://man7.org/linux/man-pages/man8/lsof.8.html) (Linux falls back to [`ss`](https://man7.org/linux/man-pages/man8/ss.8.html) when `lsof` is missing).
- Windows: `netstat`, `tasklist` and `taskkill`, which ship with the OS.
- Optional: [Docker](https://docs.docker.com/get-docker/) to detect and stop containers that publish ports.

## Installation & Quick Start

### Run without installing (`npx`)
```bash
npx @majidev-org/port-kill-cli 3000
```

### Install globally for the `pk` / `kp` shortcuts
```bash
npm install -g @majidev-org/port-kill-cli
pk 3000                   # or: kp 3000 (also available as `port-kill` and `kill-port`)
```

## Usage & Examples

```bash
# Kill a single port
pk 3000                   # or: kp 3000

# Kill multiple ports at once
pk 3000 5173 8080         # or: kp 3000 5173 8080

# Kill a range of ports
pk 3000-3005              # or: kp 3000-3005

# Inspect what is running on a port without killing it
pk 3000 --info            # or: kp 3000 --info

# Force kill immediately (skips graceful SIGTERM)
pk 3000 --force           # or: kp 3000 --force

# Pick ports to free from an interactive list
pk                        # or: kp

# List every port in use (processes and Docker containers)
pk --info                 # or: kp --info

# Show help menu
pk --help                 # or: kp --help
```

## Options

| Flag | Alias | Description |
| :--- | :--- | :--- |
| `--info` | `-i` | Show the process name and PID using the port without killing it |
| `--force` | `-f` | Immediately force-kill the process (`SIGKILL` / `taskkill /F` / `docker kill`) |
| `--version` | `-v` | Print the installed version |
| `--help` | `-h` | Display usage instructions and options |

## Using in `package.json` Scripts
Ensure your dev port is always free before starting your server:

```json
{
  "scripts": {
    "predev": "npx @majidev-org/port-kill-cli 3000",
    "dev": "next dev"
  }
}
```

## Security

`pk` runs every system tool without a shell, validates ports as integers in 1–65535, and strips control, bidi and zero-width characters from process names before printing them (a process can name itself anything, including terminal escape codes). If no tool can list ports it fails with an error instead of claiming a port is free. On Windows, commands are resolved from `System32` so a stray `netstat.exe` in the current folder is never run. Killing another user's process needs `sudo` or Administrator rights. See [SECURITY.md](SECURITY.md) for the full list and how to report a vulnerability.

## Contributing

Bug reports and ideas are welcome in the [issue tracker](https://github.com/majidev-org/port-kill-cli/issues). To work on the code, see [CONTRIBUTING.md](CONTRIBUTING.md) and [TESTING.md](TESTING.md).

## Terms, Privacy & License

`pk` terminates processes, so read the [Terms of Use](TERMS.md) before using it on systems you don't own. It collects no data; see the [Privacy Policy](PRIVACY.md). Vulnerabilities go through the [Security Policy](SECURITY.md).

## License
[MIT](LICENSE) © [Majid Ali](https://majidev.netlify.app)
