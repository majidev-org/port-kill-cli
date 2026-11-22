# Terms of Use

By installing or running `pk` / `port-kill` (`@majidev-org/port-kill-cli`) you agree to these terms. They sit alongside the [MIT License](LICENSE), which governs copying and modification of the code; if the two conflict, the license wins.

## 1. What the tool does

`pk` finds processes and Docker containers using network ports and **terminates them**: `SIGTERM` then `SIGKILL` on Linux and macOS, `taskkill /F` on Windows, `docker stop` or `docker kill` for containers. Termination can cause **unsaved work to be lost, data to be corrupted, or services to go down**.

## 2. Your responsibility

- You choose what to kill. Check with `pk <port> --info` or the interactive list first if you are unsure.
- `--force` skips graceful shutdown. Use it knowingly.
- Only use `pk` on systems, processes and containers you own or are authorized to manage. Using it against shared, production or third-party systems without permission is your responsibility alone.
- Running with `sudo` or as Administrator lets `pk` stop any process, including important system ones. Don't, unless you mean to.
- Don't use `pk` for anything unlawful, or to interfere with other people's systems.

## 3. No warranty, limited liability

The software is provided **"as is"**, without warranty of any kind, as set out in the [MIT License](LICENSE). The author is not liable for any loss, damage or downtime arising from its use. `pk` re-checks that a process still holds its port before signalling it (see [SECURITY.md](SECURITY.md)), but this reduces risk and does not eliminate it.

## 4. Support and changes

Support is best-effort through the [issue tracker](https://github.com/majidev-org/port-kill-cli/issues). Features, behavior and these terms may change in new releases; the latest version of this file in the repository applies. Only the latest release receives security fixes.

## 5. Third-party names

Docker, Linux, macOS, Windows, npm, GitHub and other names are trademarks of their owners and are used only to describe compatibility. This project is not affiliated with or endorsed by them.

## Related

[Privacy Policy](PRIVACY.md) · [Security Policy](SECURITY.md) · [License](LICENSE)
