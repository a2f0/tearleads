# Publishing @tearleads/windowing

Part of the [@tearleads/windowing](../README.md).

## Publishing

Inside this workspace the package exports its TypeScript source. The npm
package is built separately, into `dist/`, with its own generated manifest:

```sh
bun run --cwd packages/windowing package        # build dist/
bun run --cwd packages/windowing package:smoke  # pack, install, render, typecheck, and bundle outside the workspace
```

The built package is ES modules with declarations and source maps, plus every
stylesheet. React and react-dom are peer dependencies from 19.2, the first
release with `useEffectEvent`; Phosphor icons is its one dependency. The
stylesheets and the entry module (which imports [`tokens.css`][tokens]) are
declared side effects, so bundlers that trust `sideEffects` keep the token
defaults. [`src/publishedPackage.test.ts`][package-tests] checks the built
manifest, documentation links, and that no module reaches outside the package,
so a new workspace import fails the package's tests rather than the publish.
The declarations drop the stylesheet imports tsc keeps
in them, which a consumer's typecheck could not resolve. The smoke script
installs the lowest React the peer range admits, typechecks against the
declarations with TypeScript's defaults, and bundles a named import with webpack.

Merging to `main` publishes. When [`packages/windowing`][windowing-source] changes
there, [`.github/workflows/windowing-publish.yml`][windowing-publish] publishes
the version in [`package.json`][workspace-manifest] if it is a stable `x.y.z`
newer than npm's `latest`; a merge that
leaves the version alone, a re-run, or a run that finishes after a newer release
succeeds without publishing, as decided by `agent-tool release plan`.
The workflow authenticates with
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers): npm accepts
the job's GitHub OIDC token instead of an npm token, and attaches provenance to
each version. On npmjs.com the package's trusted publisher names the `a2f0`
owner, the `tearleads` repository, the
[`windowing-publish.yml`][windowing-publish] workflow, and
the `npm` environment, which the repository restricts to `main`. Renaming the
workflow or the environment breaks publishing until that setting matches.

To publish by hand instead, run from the repository root with an account that
owns the `@tearleads` npm scope:

```sh
npm login --registry https://registry.npmjs.org
bun run publish:npm:dry-run windowing
bun run publish:npm windowing
```

Windowing has no workspace dependencies, and its React peers and Phosphor
dependency already exist on npm, so it publishes on its own.
[`scripts/release/publishNpmPackage.sh`][publish-npm-package] publishes each npm
package by its directory name; `bun run --cwd packages/windowing publish:npm`
runs it for
windowing, and the workflow runs it too.

The command rebuilds into a fresh temporary directory, publishes its generated
consumer manifest with public access to `https://registry.npmjs.org`, and
removes the directory on success or failure. A temporary `.npmrc` overrides any
scope-specific registry without changing your npm configuration. A dry run
builds and previews the same package without uploading. It accepts
`--dry-run`, `--tag <tag>` (default `latest`), and `--otp <code>`; for example:

```sh
bun run publish:npm windowing --dry-run --tag next
bun run publish:npm windowing --tag next --otp 123456
```

Run `package:smoke` separately before a release to verify the packed package in
an external consumer. It needs the network to install the consumer dependencies.

`ship-pr` bumps changed workspace packages before review and merge; the generated
manifest copies `version` from [`package.json`][workspace-manifest]. For a release
outside that flow, bump the version yourself before publishing. The manifest
names this repository,
which npm requires of a version with provenance, and declares
`"license": "UNLICENSED"`.

[tokens]: https://github.com/a2f0/tearleads/blob/main/packages/windowing/src/tokens.css
[package-tests]: https://github.com/a2f0/tearleads/blob/main/packages/windowing/src/publishedPackage.test.ts
[windowing-source]: https://github.com/a2f0/tearleads/tree/main/packages/windowing
[windowing-publish]: https://github.com/a2f0/tearleads/blob/main/.github/workflows/windowing-publish.yml
[workspace-manifest]: https://github.com/a2f0/tearleads/blob/main/packages/windowing/package.json
[publish-npm-package]: https://github.com/a2f0/tearleads/blob/main/scripts/release/publishNpmPackage.sh
