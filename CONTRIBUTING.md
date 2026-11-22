# Contributing & Maintaining

Maintainer notes for [port-kill-cli](README.md) (`pk` / `kp`): repository protection, releasing, development and branding. This file is not part of the npm package. See also [TESTING.md](TESTING.md) and [SECURITY.md](SECURITY.md).

## Branch protection

`main` is protected on GitHub:

- Changes arrive through a pull request, and the [CI workflow](.github/workflows/ci.yml) must pass on Linux, macOS and Windows.
- Force pushes and branch deletion are blocked, history stays linear, and review conversations must be resolved.
- Admins are not forced through these rules, so the repository owner can still push release commits (`npm version`) directly. Releases only publish when the tag points at a commit on `main`.

Release tags (`v*`) are protected by a [tag ruleset](https://github.com/majidev-org/port-kill-cli/rules): only repository admins can create them, and nobody can move or delete one. Because a tag push triggers the npm publish, this keeps write-access collaborators from releasing.

Settings: *Settings → Branches* in the [repository](https://github.com/majidev-org/port-kill-cli/settings/branches). See GitHub's [branch protection docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Releasing

Publishing is automated by [.github/workflows/publish.yml](.github/workflows/publish.yml). Pushing a `vX.Y.Z` tag runs the tests on Linux, macOS and Windows, checks the tag is on `main` and matches `package.json`, and publishes to npm.

One-time setup: the workflow publishes with an npm access token stored as the `NPM_TOKEN` repository secret (*Settings → Secrets and variables → Actions*). Create a [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens) limited to this package with read and write permission, and set a short expiry. Provenance is still signed through GitHub's OIDC token (`id-token: write`).

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
