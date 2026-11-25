# Privacy Policy

`pk` (`cross-port-kill`) is a local command-line tool. **It collects no data.**

## What it does and does not do

- **No network access.** The code makes no HTTP, DNS or socket calls of its own. Nothing is uploaded, and there is no telemetry, analytics, crash reporting or update check.
- **No files written.** `pk` stores no configuration, cache, logs or history.
- **Local reads only.** To find what holds a port it runs your system's own tools (`lsof`, `ss`, `netstat`, `tasklist`, `docker ps`) and reads their output in memory. That output (process names, PIDs, container names, ports) is printed to your terminal and discarded when the command exits.
- **No account, no cookies, no tracking.**
- **Zero runtime dependencies**, so no third-party code runs inside the tool.

You can confirm this yourself: the whole source is a few small files in [bin/](bin/) and [src/](src/).

## Third parties

Distribution happens through services that have their own policies and may log downloads or visits:

- [npm Privacy Policy](https://docs.npmjs.com/policies/privacy) when you install with `npm` or `npx`.
- [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) when you visit the repository or open an issue.

If you open an issue or security report, whatever you write there is handled by GitHub and visible as you choose when posting. Don't paste secrets, and note that `pk --info` output lists process names on your machine.

## Changes

Any change to this policy is made in this file and recorded in the repository's [git history](https://github.com/majidev-org/port-kill-cli/commits/main/PRIVACY.md).

## Contact

Questions: [open an issue](https://github.com/majidev-org/port-kill-cli/issues) or see [majidev.netlify.app](https://majidev.netlify.app). For vulnerabilities, follow [SECURITY.md](SECURITY.md).
