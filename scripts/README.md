# Repository scripts

The top level holds commands you run directly: local app launchers, release
builds and uploads, deployments, screenshots, backups, and maintenance tools.
For example, run `./scripts/runApp.sh`, `./scripts/buildIosRelease.sh`, or
`./scripts/deployStaging.sh` from the repository root.

For website-only deployments, run `./scripts/deployStagingWebsite.sh` or
`./scripts/deployProductionWebsite.sh`. Both use the shared deployment helper in
`packages/website/scripts/deployWebsite.sh`; see the
[website deployment guide](../packages/website/README.md) for credentials and
dry-run options.

Automated checks and supporting code live in subfolders. Use the root
`package.json` commands, such as `bun run check:fast`, `bun run lint:architecture`,
or `bun run test:static-analysis`, to run checks and tooling tests.

| Folder | Contents |
| --- | --- |
| `architecture/` | Architecture checks and reports, dependency rules, workspace and subsystem registries. |
| `checks/` | Check entry points, static analysis helpers, baselines, and regression fixtures. |
| `git/` | Hook installation, hook implementations, and push timing reports. |
| `keychain/` | Manual macOS keychain utilities. |
| `lib/` | Shared shell functions and build helpers called by other scripts, with their tests. |
| `localstack/` | Local S3 setup, shutdown, and reset commands. |
| `postgres/` | Development database setup, migration, and reset commands. |
| `protocol/` | Formal protocol checks, trace generation and projection, negative controls, and their tests. |
| `testing/` | Test runners used by package scripts and automated checks. |

## Adding a script

- Keep a command at the top level when it is intended to be run directly for
  development, releases, deployment, or maintenance.
- Put shared shell functions and internal command wrappers in `lib/`.
- Keep domain-specific helpers and tests beside their tooling in `checks/`,
  `architecture/`, or `protocol/`; put test launchers in `testing/`.
- Wire automated commands through the root `package.json`. When moving a file,
  update its imports, shell source paths, test fixtures, documentation, and Turbo
  inputs together.
