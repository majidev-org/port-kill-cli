# Local Development & Testing Guide

Follow these steps to link, run, and test `port-kill-cli` (`pk`) locally before publishing to npm. See the [README](README.md) for usage and [SECURITY.md](SECURITY.md) for the safety checks these tests exercise.

**Requirements:** [Node.js](https://nodejs.org) 18+; `lsof` (or `ss` on Linux); optionally [Docker](https://docs.docker.com/get-docker/) for Test E.

---

## 1. Link the CLI Locally
Inside the `port-kill-cli` project directory, run:

```bash
chmod +x bin/cli.js
npm link
```

This creates a global symlink so you can run `pk` and `port-kill` from any directory. Verify it works:

```bash
pk --help
pk --version
```

---

## 2. Automated Tests
```bash
npm test
```
The same suite runs in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) on Linux, macOS and Windows for every pull request. Those three checks must pass before merging into `main`.
Runs the `node:test` suite in [test/](test/): argument parsing, the `lsof` / `ss` / `netstat` / `docker ps` parsers, interactive selection parsing, and sanitizing of untrusted process names.

---

## 3. Manual Scenarios

Each scenario starts a throwaway server with `node -e "require('http').createServer().listen(<port>)" &`.

### Test A: Single Port (`pk 3000`)
1. Start a dummy server:
   ```bash
   node -e "require('http').createServer().listen(3000)" &
   ```
2. Inspect it without killing (`--info`):
   ```bash
   pk 3000 --info
   ```
   *Expected:* `ℹ Port 3000 is in use by node (PID <number>)`
3. Kill it:
   ```bash
   pk 3000
   ```
   *Expected:* `✔ Freed port 3000 — killed node (PID <number>)`
4. Run `pk 3000` again. *Expected:* `• Port 3000 is already free.`

### Test B: Multiple Ports & Ranges (`pk 4001-4003`)
1. Start three servers on ports `4001`, `4002` and `4003`.
2. Kill them with a range:
   ```bash
   pk 4001-4003
   ```
   *Expected:* three green `✔ Freed port …` lines.

### Test C: Stubborn Process (`--force`)
1. Start a process that ignores `SIGTERM`:
   ```bash
   node -e "process.on('SIGTERM', () => {}); require('http').createServer().listen(5000)" &
   ```
2. Run `pk 5000`. It sends `SIGTERM`, waits 300 ms, confirms the PID still holds the port, then escalates to `SIGKILL`. *Expected:* `✔ Freed port 5000 …`
3. Repeat step 1, then run `pk 5000 --force` for an immediate `SIGKILL`.

### Test D: Invalid Input & Edge Cases
```bash
pk 99999       # ✖ Invalid port or range: "99999" (expected 1–65535, e.g. 3000 or 3000-3005)
pk abc         # ✖ Invalid port or range: "abc" (expected 1–65535, e.g. 3000 or 3000-3005)
pk 3005-3000   # ✖ Invalid port or range … (end before start)
pk --nope      # ✖ Unknown option: "--nope"
pk < /dev/null # prints the help menu (no interactive prompt without a TTY)
```

### Test E: Docker Containers
1. Start a container that publishes a port:
   ```bash
   docker run -d --rm -p 8099:80 --name pk-test nginx
   ```
2. Inspect it:
   ```bash
   pk 8099 --info
   ```
   *Expected:* `ℹ Port 8099 is in use by Docker container pk-test (<id>)`
3. Free it:
   ```bash
   pk 8099
   ```
   *Expected:* `✔ Freed port 8099 — stopped Docker container pk-test (<id>)`

### Test F: Interactive Mode
1. Start a dummy server on port `4001`.
2. Run `pk` with no arguments. A numbered list of ports in use appears.
3. Type the number next to `:4001` and press Enter. *Expected:* `✔ Freed port 4001 — killed node (PID <number>)`
4. Run `pk` again and press Enter without typing. *Expected:* nothing is killed.

### Test G: Stale Target Is Refused (PID-reuse protection)
1. Start a dummy server on port `4001`, run `pk`, and **do not answer the prompt yet**.
2. In another terminal, stop the server: `pk 4001` (or `kill <pid>`).
3. Back in the first terminal, select the `:4001` entry. *Expected:* `✖ Failed to free port 4001 … process is no longer listening on that port (already exited?)`, and nothing else is signalled.

### Test H: Hostile Process Name (terminal injection)
Linux only. Start a process whose name contains an escape sequence:
```bash
node -e "process.title='evil\x1b[2J\nfake'; require('http').createServer().listen(4002)" &
pk 4002 --info
```
*Expected:* the name prints on a single line (`lsof` already escapes control bytes as text like `\x1b`; `pk` additionally replaces any that slip through, e.g. from `ss`, with spaces). The screen is not cleared and no fake output line appears. Clean up with `pk 4002`.

---

## 4. Clean Up the Local Link (Optional)
To test the published package instead of your local checkout:

```bash
npm unlink -g @majidev-org/port-kill-cli
```
