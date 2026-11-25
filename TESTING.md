# Local Development & Testing Guide

Follow these steps to link, run, and test `cross-port-kill` (`pk` / `kp`) locally before publishing to npm. See the [README](README.md) for usage and [SECURITY.md](SECURITY.md) for the safety checks these tests exercise.

**Requirements:** [Node.js](https://nodejs.org) 18+; `lsof` (or `ss` on Linux); optionally [Docker](https://docs.docker.com/get-docker/) for Test E.

---

## 1. Link the CLI Locally
Inside the `port-kill-cli` project directory, run:

```bash
chmod +x bin/cli.js
npm link
```

This creates a global symlink so you can run all ten commands (`pk`, `kp`, `cpk`, `ckp`, `port-kill`, `kill-port`, `cross-port-kill`, `cross-kill-port`, `pk-udp`, `pk-tcp`) from any directory. Verify it works:

```bash
pk --help
kp --version
cpk --version
ckp --version
port-kill --version
kill-port --version
cross-port-kill --version
cross-kill-port --version
pk-udp --version
pk-tcp --version            # all ten print the same version
```

---

## 2. Automated Tests
```bash
npm test
```
The same suite runs in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) on Linux, macOS and Windows for every pull request. Those three checks must pass before merging into `main`.
Runs the `node:test` suite in [test/](test/): argument parsing, process-tree planning, the `lsof` / `ss` / `netstat` / `docker ps` parsers, interactive selection parsing, and sanitizing of untrusted process names.

---

## 3. Manual Scenarios

Each scenario starts a throwaway server with `node -e "require('http').createServer().listen(<port>)" &`.

### Test A: Single Port (`pk 3000` / `kp 3000`)
1. Start a dummy server:
   ```bash
   node -e "require('http').createServer().listen(3000)" &
   ```
2. Inspect it without killing (`--info`):
   ```bash
   pk 3000 --info            # or: kp 3000 --info
   ```
   *Expected:* a table row `:3000  node  <pid>  <you>  localhost only  node -e …` (`all interfaces` if the server listens on `0.0.0.0`; user and command are blank on Windows), followed by `1 in use`
3. Kill it:
   ```bash
   pk 3000                   # or: kp 3000
   ```
   *Expected:* `✔ Freed port 3000 — killed node (PID <number>) via SIGTERM (graceful)`
4. Run `pk 3000` (or `kp 3000`) again. *Expected:* `• Port 3000 is already free.`

### Test B: Multiple Ports & Ranges (`pk 4001-4003` / `kp 4001-4003`)
1. Start three servers on ports `4001`, `4002` and `4003`.
2. Kill them with a range:
   ```bash
   pk 4001-4003              # or: kp 4001-4003
   ```
   *Expected:* three green `✔ Freed port …` lines, then `✔ Freed 3 of 3 ports`.

### Test C: Stubborn Process (`--force`)
1. Start a process that ignores `SIGTERM`:
   ```bash
   node -e "process.on('SIGTERM', () => {}); require('http').createServer().listen(5000)" &
   ```
2. Run `pk 5000` (or `kp 5000`). It sends `SIGTERM`, waits 300 ms, confirms the PID still holds the port, then escalates to `SIGKILL`. *Expected:* `✔ Freed port 5000 … via SIGTERM, then SIGKILL` (a server that ignores `SIGTERM`; a normal one reports `SIGTERM (graceful)`)
3. Repeat step 1, then run `pk 5000 --force` (or `kp 5000 --force`) for an immediate `SIGKILL`.

### Test C2: `--children` and `--tree` (Linux/macOS)
1. Start an "app" that runs a server as its child:
   ```bash
   node -e "require('child_process').spawn(process.execPath, ['-e', \"require('http').createServer().listen(5100)\"], {stdio: 'inherit'}); setInterval(() => {}, 1e6)" &
   ```
2. Run `pk 5100`. *Expected:* only the server is killed; the app keeps running (`pgrep -f setInterval`). If the server itself had started other processes, `pk 5100 --children` would stop them too and print `+ N other processes`; the app above would still keep running.
3. Repeat step 1, then run `pk 5100 --tree`. *Expected:* a list `:5100  node (PID <n>) → node (PID <m>)` and `? Stop them? [y/N]`. Answer `n` (or press Enter): `• Cancelled, nothing was stopped.` and both processes keep running. Run it again and answer `y`: `✔ Freed port 5100 … via SIGTERM (graceful) + parent node (PID <m>)`, and the app is gone too. With `--yes` the question is skipped, and `pk 5100 --tree < /dev/null` without `--yes` fails with `--tree asks before stopping a parent`.
4. Run `pk <port> --tree` for a server started directly from your shell. *Expected:* the shell is not killed; the output ends `(parent bash (PID <n>) left running)`.

### Test D: Invalid Input & Edge Cases
```bash
pk 99999       # (or kp 99999)     ✖ Invalid port or range: "99999" (expected 1–65535, e.g. 3000, 3000-3005, :3000, localhost:3000 or 5353/udp)
pk abc         # (or kp abc)       ✖ Invalid port or range: "abc" (expected 1–65535, e.g. 3000, 3000-3005, :3000, localhost:3000 or 5353/udp)
pk 3005-3000   # (or kp 3005-3000) ✖ Invalid port or range … (end before start)
pk --nope      # (or kp --nope)    ✖ Unknown option: "--nope". Run pk --help to see the options.
pk --forse     # (or kp --forse)   ✖ Unknown option: "--forse". Did you mean "--force"?
pk < /dev/null # (or kp < /dev/null) prints the help menu (no interactive prompt without a TTY)
pk 3000/sctp   # (or kp 3000/sctp) ✖ Invalid port or range: "3000/sctp" (only /tcp and /udp)
```

### Test D1: Words
Start a dummy server on `4001` (as in Test A), then:
1. `pk port 4001`, `pk what is on 4001` and `pk is 4001 free`. *Expected:* each shows the server and ends with `To free it: pk 4001`. The server keeps running.
2. `pk kil 4001`. *Expected:* `✖ Unknown word: "kil". Did you mean "kill"?`, nothing is stopped.
3. `pk kill 4001`. *Expected:* `✔ Freed port 4001 …`.
4. `pk localhost:4001` and `pk http://localhost:4001/` work the same as `pk 4001` (restart the server between runs).

### Test D2: UDP Ports
1. Bind a UDP socket in a separate terminal:
   ```bash
   node -e "require('dgram').createSocket('udp4').bind(5454, () => console.log('bound 5454/udp'))"
   ```
2. Run `pk 5454`. *Expected:* `• Port 5454 is already free.` and the socket keeps running (TCP is the default).
3. Run `pk 5454 --udp --info` (or `pk 5454/udp --info`). *Expected:* a row for `:5454/udp` with the node PID.
4. Run `pk 5454/udp`. *Expected:* `✔ Freed port 5454/udp … via SIGTERM (graceful)` and the first terminal returns to the prompt.
5. Run `pk --udp`. *Expected:* the picker lists UDP ports only, each shown as `:<port>/udp`.
6. Docker: `docker run -d --rm --name pk-udp -p 5455:53/udp alpine sleep 600`, then `pk 5455` says already free and `pk 5455/udp` stops the container via `docker stop`.

### Test E: Docker Containers
1. Start a container that publishes a port:
   ```bash
   docker run -d --rm -p 8099:80 --name pk-test nginx
   ```
2. Inspect it:
   ```bash
   pk 8099 --info            # or: kp 8099 --info
   ```
   *Expected:* a table row `:8099  pk-test  <12-char id>  container  …  <image>`
3. Free it:
   ```bash
   pk 8099                   # or: kp 8099
   ```
   *Expected:* `✔ Freed port 8099 — stopped Docker container pk-test (<id>) via docker stop`
4. Remote contexts are ignored: with the container running again, `DOCKER_HOST=tcp://203.0.113.1:2375 pk 8099 --info` (or `kp`) must say `Port 8099 is already free.` and never touch the container.

### Test F: Interactive Mode
1. Start a dummy server on port `4001`.
2. Run `pk` (or `kp`) with no arguments. A checkbox list of ports in use appears.
3. Move to `:4001` with `↑`/`↓`, press `Space` to tick it (the counter reads `1/N selected`) and press Enter. *Expected:* `✔ Freed port 4001 — killed node (PID <number>)`, and no other port is touched.
3b. *Options (Linux/macOS):* two boxes sit under the list, **Also stop what it started** and **Also close the app that started it**. Press `c` and `t` to toggle them (or move onto one and press `Space`); ticking the app shows the children as `(included)`. The line under them explains the highlighted option. Tick a port that an app started plus the app option, press Enter, answer `n` at `Stop them? [y/N]`: *Expected:* `• Cancelled, nothing was stopped.` With `y` the app and its port holder are both stopped.
4. Run `pk` (or `kp`) again and press Enter without ticking anything, then once more and press `q`. *Expected:* nothing is killed either time, and the cursor is visible again afterwards.
5. Typed fallback: run `pk | cat`. A numbered list appears; type the number next to `:4001` and press Enter. *Expected:* same `✔ Freed port 4001 …` result.

### Test G: Stale Target Is Refused (PID-reuse protection)
1. Start a dummy server on port `4001`, run `pk` (or `kp`), and **do not answer the prompt yet**.
2. In another terminal, stop the server: `pk 4001` / `kp 4001` (or `kill <pid>`).
3. Back in the first terminal, tick the `:4001` entry with `Space` and press Enter. *Expected:* `✖ Failed to free port 4001 … process is no longer listening on that port (already exited?)`, and nothing else is signalled.

### Test H: Hostile Process Name (terminal injection)
Linux only. Start a process whose name contains an escape sequence:
```bash
node -e "process.title='evil\x1b[2J\nfake'; require('http').createServer().listen(4002)" &
pk 4002 --info            # or: kp 4002 --info
```
*Expected:* the name prints on a single line (`lsof` already escapes control bytes as text like `\x1b`; `pk` additionally replaces any that slip through, e.g. from `ss`, with spaces). The screen is not cleared and no fake output line appears. Clean up with `pk 4002` (or `kp 4002`).

---

## 4. Clean Up the Local Link (Optional)
To test the published package instead of your local checkout:

```bash
npm unlink -g cross-port-kill
```
