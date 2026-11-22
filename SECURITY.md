# Security Policy

See also: [Terms of Use](TERMS.md) · [Privacy Policy](PRIVACY.md) · [License](LICENSE)

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private
[**Report a vulnerability**](https://github.com/majidev-org/port-kill-cli/security/advisories/new) form
(Security tab of the repository). If that is unavailable, reach the author through
[majidev.netlify.app](https://majidev.netlify.app) and ask for a private channel.

Only the latest published version is supported; fixes ship as a new patch release on
[npm](https://www.npmjs.com/package/@majidev-org/port-kill-cli).

## What `pk` does to stay safe

| Risk | Mitigation |
| :--- | :--- |
| Command injection | All tools (`lsof`, `ss`, `docker`, `taskkill`, …) run through `execFileSync` with an argument array. No shell is involved, and ports are validated as integers in 1–65535. |
| Terminal escape / log forging via process names | Control characters (including ESC, C1 codes and newlines) are replaced with spaces before names or error text are printed ([src/targets.js](src/targets.js)). |
| Windows current-directory command hijacking | Commands are launched from `System32` ([src/exec.js](src/exec.js)), so a `netstat.exe` or `docker.exe` in the working directory is not executed. |
| Killing a recycled PID | Before signalling, and again before escalating to `SIGKILL`, `pk` confirms the PID still listens on the port it was found on ([src/kill.js](src/kill.js)). |
| Breaking Docker networking | Ports published by containers are freed with `docker stop` / `docker kill`, never by killing Docker's proxy process. |
| Unprivileged use | `pk` never elevates. Another user's process needs `sudo` or Administrator, and the error message says so. |
| Unreviewed or rewritten history | `main` is a [protected branch](README.md#branch-protection): pull requests with passing CI on three operating systems, no force pushes, no deletion, linear history. |
| Unauthorized releases | `v*` tags are covered by a [tag ruleset](https://github.com/majidev-org/port-kill-cli/rules): only repository admins can create them, and none can be moved or deleted. Publishing also requires the tag to be on `main`. |
| Supply chain | Zero runtime dependencies. Releases are published from tags on `main` by [GitHub Actions](.github/workflows/publish.yml) with pinned action SHAs, read-only default permissions, npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (no stored npm token) and [provenance](https://docs.npmjs.com/generating-provenance-statements). |

## Known limitations

- Killing by PID can never be perfectly atomic. The re-check above shrinks the race to milliseconds but cannot remove it.
- The Windows `System32` lookup is untested on a real Windows machine.
- Branch protection does not apply to repository admins, so the owner's account is the trust anchor. Use a strong password and 2FA on it.
- On Unix, commands are found through your `PATH`; keep it free of untrusted directories.
