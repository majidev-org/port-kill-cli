# port-kill-cli (`pk`)

A fast, zero-dependency, cross-platform CLI to find and kill processes occupying ports on **Linux**, **macOS**, and **Windows**.

Stop Googling `lsof` vs `netstat`—just run `pk 3000`.

## Features
- **Zero Dependencies:** Instant startup with `npx`—no bloated `node_modules` tree.
- **Cross-Platform:** Works seamlessly on Linux (`lsof` / `ss`), macOS (`lsof`), and Windows (`netstat` / `taskkill`).
- **Safe & Graceful:** Sends `SIGTERM` first so servers clean up properly, escalating to `SIGKILL` only if needed.
- **Process Info:** Displays the exact process name and PID freed.
- **Multi-Port & Ranges:** Kill single ports, multiple ports, or port ranges in one command.
- **Docker-Aware:** Ports published by a Docker container are freed with `docker stop` instead of killing Docker's proxy (which would break Docker networking).
- **Interactive Mode:** Run `pk` with no arguments to see every port in use and pick which ones to free.

## Installation & Quick Start

### Run without installing (`npx`)
```bash
npx @majidev/port-kill-cli 3000
```

### Install globally for the `pk` shortcut
```bash
npm install -g @majidev/port-kill-cli
pk 3000
```

## Usage & Examples

```bash
# Kill a single port
pk 3000

# Kill multiple ports at once
pk 3000 5173 8080

# Kill a range of ports
pk 3000-3005

# Inspect what is running on a port without killing it
pk 3000 --info

# Force kill immediately (skips graceful SIGTERM)
pk 3000 --force

# Pick ports to free from an interactive list
pk

# List every port in use (processes and Docker containers)
pk --info

# Show help menu
pk --help
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
    "predev": "npx @majidev/port-kill-cli 3000",
    "dev": "next dev"
  }
}
```

## Releasing

Publishing is automated by [.github/workflows/publish.yml](.github/workflows/publish.yml). Pushing a `vX.Y.Z` tag runs the tests on Linux, macOS and Windows, checks the tag matches `package.json`, and publishes to npm.

One-time setup: create an npm **Automation** access token and add it to the GitHub repo as the `NPM_TOKEN` secret.

```bash
npm version patch          # bumps package.json and creates the vX.Y.Z tag
git push --follow-tags     # triggers the publish workflow
```

## Development

```bash
npm test                   # unit tests for the parsers (node:test, no dependencies)
```

## License
MIT
