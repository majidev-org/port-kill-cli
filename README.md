<p align="center">
  <img src="https://raw.githubusercontent.com/majidev-org/port-kill-cli/main/assets/logo.svg" alt="pk – port-kill-cli logo" width="300">
</p>

# port-kill-cli (`pk`)

[![npm version](https://img.shields.io/npm/v/@majidev-org/port-kill-cli)](https://www.npmjs.com/package/@majidev-org/port-kill-cli)
[![Publish](https://github.com/majidev-org/port-kill-cli/actions/workflows/publish.yml/badge.svg)](https://github.com/majidev-org/port-kill-cli/actions/workflows/publish.yml)
[![node](https://img.shields.io/node/v/@majidev-org/port-kill-cli)](https://nodejs.org)
[![license: MIT](https://img.shields.io/npm/l/@majidev-org/port-kill-cli)](LICENSE)

A fast, zero-dependency, cross-platform CLI to find and kill processes occupying ports on **Linux**, **macOS**, and **Windows**.

Stop Googling `lsof` vs `netstat`—just run `pk 3000`.

[npm package](https://www.npmjs.com/package/@majidev-org/port-kill-cli) · [Source](https://github.com/majidev-org/port-kill-cli) · [Report an issue](https://github.com/majidev-org/port-kill-cli/issues) · [Security policy](SECURITY.md) · [Privacy](PRIVACY.md) · [Terms](TERMS.md)

## Features
- **Zero Dependencies:** Instant startup with `npx`—no bloated `node_modules` tree.
- **Cross-Platform:** Works seamlessly on Linux (`lsof` / `ss`), macOS (`lsof`), and Windows (`netstat` / `taskkill`).
- **Safe & Graceful:** Sends `SIGTERM` first so servers clean up properly, escalating to `SIGKILL` only if needed. Before every signal it re-checks that the PID still holds the port, so a recycled PID is never killed by mistake.
- **Process Info:** Displays the exact process name and PID freed.
- **Multi-Port & Ranges:** Kill single ports, multiple ports, or port ranges in one command.
- **Docker-Aware:** Ports published by a Docker container are freed with `docker stop` instead of killing Docker's proxy (which would break Docker networking).
- **Interactive Mode:** Run `pk` with no arguments to see every port in use and pick which ones to free.

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

### Install globally for the `pk` shortcut
```bash
npm install -g @majidev-org/port-kill-cli
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
    "predev": "npx @majidev-org/port-kill-cli 3000",
    "dev": "next dev"
  }
}
```

## Security

`pk` runs every system tool without a shell, validates ports as integers in 1–65535, and strips control characters from process names before printing them (a process can name itself anything, including terminal escape codes). On Windows, commands are resolved from `System32` so a stray `netstat.exe` in the current folder is never run. Killing another user's process needs `sudo` or Administrator rights. See [SECURITY.md](SECURITY.md) for the full list and how to report a vulnerability.

## Branch protection

`main` is protected on GitHub:

- Changes arrive through a pull request, and the [CI workflow](.github/workflows/ci.yml) must pass on Linux, macOS and Windows.
- Force pushes and branch deletion are blocked, history stays linear, and review conversations must be resolved.
- Admins are not forced through these rules, so the repository owner can still push release commits (`npm version`) directly. Releases only publish when the tag points at a commit on `main`.

Release tags (`v*`) are protected by a [tag ruleset](https://github.com/majidev-org/port-kill-cli/rules): only repository admins can create them, and nobody can move or delete one. Because a tag push triggers the npm publish, this keeps write-access collaborators from releasing.

Settings: *Settings → Branches* in the [repository](https://github.com/majidev-org/port-kill-cli/settings/branches). See GitHub's [branch protection docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Releasing

Publishing is automated by [.github/workflows/publish.yml](.github/workflows/publish.yml). Pushing a `vX.Y.Z` tag runs the tests on Linux, macOS and Windows, checks the tag is on `main` and matches `package.json`, and publishes to npm.

One-time setup: the workflow publishes with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (short-lived OIDC credentials), so no npm token is stored in GitHub. On npmjs.com open the package's **Settings → Trusted Publisher**, choose GitHub Actions, and enter organization `majidev-org`, repository `port-kill-cli`, workflow `publish.yml`.

See npm's [trusted publishing docs](https://docs.npmjs.com/trusted-publishers) and GitHub's [OIDC guide](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) for how this works.

```bash
npm version patch          # bumps package.json and creates the vX.Y.Z tag
git push --follow-tags     # triggers the publish workflow
```

## Development

```bash
npm test                   # unit tests for the parsers (node:test, no dependencies)
```

See [TESTING.md](TESTING.md) for linking the CLI locally and manual test scenarios. Bugs and ideas are welcome in the [issue tracker](https://github.com/majidev-org/port-kill-cli/issues).

## Branding

Logo and icons live in [assets/](assets/): [logo.svg](assets/logo.svg), [icon.svg](assets/icon.svg) (plus [icon-512.png](assets/icon-512.png) and [logo.png](assets/logo.png)) and [social-preview.png](assets/social-preview.png) (1280×640, for the GitHub social card). They are not part of the npm package. The SVGs are hand-drawn shapes with no font dependency; regenerate the PNGs with headless Chrome, e.g. `google-chrome --headless --window-size=512,512 --default-background-color=00000000 --screenshot=assets/icon-512.png assets/icon.svg`.

## Terms, Privacy & License

`pk` terminates processes, so read the [Terms of Use](TERMS.md) before using it on systems you don't own. It collects no data; see the [Privacy Policy](PRIVACY.md). Vulnerabilities go through the [Security Policy](SECURITY.md).

## License
[MIT](LICENSE) © [Majid Ali](https://majidev.netlify.app)
