# Local Development & Testing Guide

Follow these steps to link, run, and test `port-kill-cli` (`pk`) locally on your machine before publishing to npm.

---

## 1. Link the CLI Locally
Inside the `port-kill-cli` project directory, run:

```bash
chmod +x bin/cli.js
npm link
```

This creates a global symlink on your system so you can run `pk` and `port-kill` from any directory.

Verify it works:
```bash
pk --help
```

---

## 2. Spin Up Dummy Servers to Test Killing

### Test A: Single Port (`pk 3000`)
1. Start a lightweight dummy HTTP server in the background on port `3000`:
   ```bash
   node -e "require('http').createServer().listen(3000)" &
   ```
2. Check that your CLI detects it without killing it (`--info`):
   ```bash
   pk 3000 --info
   ```
   *Expected output:* `ℹ Port 3000 is in use by node (PID <number>)`
3. Kill the process:
   ```bash
   pk 3000
   ```
   *Expected output:* `✔ Freed port 3000 (killed node, PID <number>)`
4. Run `pk 3000` a second time to verify empty-port handling:
   *Expected output:* `• Port 3000 is already free.`

---

### Test B: Multiple Ports & Ranges (`pk 4001-4003`)
1. Start three dummy servers on ports `4001`, `4002`, and `4003`:
   ```bash
   node -e "require('http').createServer().listen(4001)" &
   node -e "require('http').createServer().listen(4002)" &
   node -e "require('http').createServer().listen(4003)" &
   ```
2. Kill all three using a port range:
   ```bash
   pk 4001-4003
   ```
   *Expected output:* Three green `✔ Freed port ...` lines.

---

### Test C: Stubborn Process (`--force`)
1. Start a Node process that ignores graceful `SIGTERM` signals:
   ```bash
   node -e "process.on('SIGTERM', () => {}); require('http').createServer().listen(5000)" &
   ```
2. Run `pk 5000` (without `--force`) to verify it waits 300ms and automatically escalates to `SIGKILL`:
   ```bash
   pk 5000
   ```
3. Repeat step 1 and test immediate force kill:
   ```bash
   pk 5000 --force
   ```

---

### Test D: Invalid Input & Edge Cases
Run these commands to confirm clean error handling:
```bash
pk 99999       # Should print: ✖ Invalid port: "99999"
pk abc         # Should print: ✖ Invalid port: "abc"
pk             # Should display the help menu
```

---

## 3. Clean Up Local Link (Optional)
If you ever want to unlink your local development version (for example, to test installing the live published version from npm):

```bash
npm unlink -g @majidev-org/port-kill-cli
```

---

### Test C: Docker Containers
1. Start a container that publishes a port:
   ```bash
   docker run -d --rm -p 8099:80 --name pk-test nginx
   ```
2. Inspect it:
   ```bash
   pk 8099 --info
   ```
   *Expected output:* `ℹ Port 8099 is in use by Docker container pk-test (<id>)`
3. Free it:
   ```bash
   pk 8099
   ```
   *Expected output:* `✔ Freed port 8099 — stopped Docker container pk-test (<id>)`

---

### Test D: Interactive Mode
1. Start a dummy server: `node -e "require('http').createServer().listen(4001)" &`
2. Run `pk` with no arguments. A numbered list of ports in use appears.
3. Type the number next to `:4001` and press Enter. *Expected:* `✔ Freed port 4001 — killed node (PID <number>)`
4. Run `pk` again and press Enter without typing. *Expected:* nothing is killed.

---

### Unit Tests
```bash
npm test
```
