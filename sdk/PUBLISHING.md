# Publishing `mockshift-sdk`

Maintainer guide for releasing the SDK. The user-facing docs live in
`README.md`; this file is intentionally excluded from the npm tarball (see the
`files` field in `package.json`).

## Package facts

| Field | Value |
| --- | --- |
| npm name | `mockshift-sdk` (published 2026-10-19, owner `keera_innovations`) |
| Current version | `0.3.1` (`latest`) |
| Scoped alternative | `@mockshift/sdk` (not used) |
| License | MIT |
| Node engine | `>=18.0.0` |
| Peer dependency | `express >=4` (optional) |
| Entry points | `.`, `./express`, `./capture`, `./package.json` |
| Binary | `mockshift-sdk` |

## One-time prerequisites

1. Create an account on <https://www.npmjs.com/signup> and verify the email.
2. Enable two-factor authentication (required by npm for publishing).
3. Log in on the machine that will publish:

```bash
npm login
```

For CI, create a **Granular** access token at
<https://www.npmjs.com/settings/> → Access Tokens with:

- `Bypass two-factor authentication` checked. Without it npm returns
  `E403 ... Two-factor authentication or granular access token with bypass 2fa
  enabled is required to publish packages`.
- `Packages and scopes` → `Read and write (publish and stage)` → `All Packages`.

Store it in `~/.npmrc` as `//registry.npmjs.org/:_authToken=<token>` (mode 600)
or expose it as `NPM_TOKEN`.

A stage-only token accepts `npm publish` but only stages the version: the
registry then shows a `0.0.0-stage` placeholder until a maintainer approves the
staged package with 2FA.

## Preflight (always run first)

```bash
cd sdk

# 1. Unit tests must pass
npm test

# 2. Inspect exactly what will be uploaded (tarball contents)
npm pack --dry-run

# 3. Optional: install the packed tarball into a scratch project
npm pack
mkdir -p /tmp/sdk-smoke && cd /tmp/sdk-smoke && npm init -y
npm install /workspace/sdk/mockshift-sdk-0.2.0.tgz
node -e "console.log(Object.keys(require('mockshift-sdk')))"
```

`prepublishOnly` re-runs `npm test` automatically before every publish, so a
red test suite cannot be released.

## Publish to the public npm registry

```bash
cd sdk

# Bump the version (creates a git tag `vX.Y.Z`)
npm version patch   # bugfix: 0.2.0 -> 0.2.1
npm version minor   # backwards-compatible feature: 0.2.0 -> 0.3.0
npm version major   # breaking change: 0.2.0 -> 1.0.0

# Publish (add --access public only if you move to a scoped name)
npm publish

# Push the version commit and tag
git push origin master --follow-tags
```

Verify:

```bash
npm view mockshift-sdk version
npm view mockshift-sdk dist.tarball
npx mockshift-sdk --help
```

### Scoped name (`@mockshift/sdk`, optional)

Scoped packages default to private; publish publicly with:

```bash
npm publish --access public
```

## Release automation (GitHub Actions)

Add `NPM_TOKEN` (granular token with publish access and 2FA bypass) to the
repository secrets, then a workflow
such as:

```yaml
name: publish-sdk
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # enables provenance
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
        working-directory: sdk
      - run: npm publish --provenance
        working-directory: sdk
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`--provenance` links the published tarball to the GitHub build, which npm shows
on the package page.

## Hosting alternatives (not public npm)

- **GitHub Packages** — publish to `npm.pkg.github.com` under a scope, then
  consumers add an `@mockshift:registry` line to `.npmrc`.
- **Private registry (Verdaccio, Artifactory, Nexus)** — point
  `publishConfig.registry` at your host and run `npm publish`.
- **Install straight from git / a tarball** — no registry needed:

```bash
npm install github:Ranjithramesh67/MockShift#master
npm install /path/to/mockshift-sdk-0.2.0.tgz
```

## Version policy

Follow semantic versioning. Because the package is pre-1.0, treat `0.x`
minor bumps as the place for new features and document breaking changes in the
release notes. The backend sync contract is documented in
`../docs/SDK.md` (sync protocol + server-side behaviour) — update it whenever
the manifest shape changes.
