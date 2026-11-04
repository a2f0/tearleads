# @tearleads/cli

The `tearleads` command line: a Tearleads client for the terminal, built on the
[client SDK](../client-sdk/README.md). It signs in to an existing account
with the account's recovery key and works on it like any other device.

It is workspace-only for now and runs from source with Bun on macOS.

## Quick start

From the repository root:

```sh
bun install                 # links the CLI's workspace dependencies
bun run build:runtime       # SQLite and the client SDK, which the CLI loads
bun run tearleads login     # paste the recovery key from Identity Manager
bun run tearleads whoami
bun run tearleads orgs
bun run tearleads ls
```

`login` reads the recovery key (seed phrase) without echoing it, or from
piped stdin, checks that it signs in, and saves it in the macOS login
Keychain under `com.tearleads.cli.recovery-key`. `logout` removes it.

## Usage

```text
Usage: tearleads <command> [--env production|staging] [--org <id>] [--trace]

Commands:
  login    Save a recovery key (seed phrase) for the target in the Keychain.
  logout   Remove the target's saved recovery key.
  whoami   Show the signed-in user, signing fingerprint, and organization.
  orgs     List the organizations you belong to.
  ls       List the folders of your organization, or of --org <id>.
```

`--env` defaults to `production` (`https://api.tearleads.com`). Each target
keeps its own saved key.

## Tracing

Add `--trace` (or set `TEARLEADS_TRACE=1`) to see where a command spends its
time. Progress goes to stderr, so stdout stays the command's normal output:

```sh
bun run tearleads ls --trace
bun run tearleads ls --trace 2> trace.log
```

Each line starts with the wall-clock time and the seconds since the command
started. The trace shows each step (opening the local database, deriving keys,
signing in, reading memberships, listing folders, pulling folder metadata,
revoking the session) with its duration; every API request by method and path
template, with its outcome, client time, and the API's reported server and
database time; each sync lane run; and the SDK's own log lines. A summary at
the end totals each step and lists the endpoints that took the most time.

Requests show path templates, never IDs, queries, or bodies. SDK log lines
and labeled output from dependencies (`console.warn: ...`) can include folder
names, so treat a saved trace like the account's data.

## How it works

Every command starts a fresh client with an in-memory SQLite database, signs
in, pulls what it needs from the API, and revokes its session before it exits.
Nothing but the recovery key outlives a command, so each run costs a full
pull of the folders it lists. Organization names show as "name not synced"
until their profile documents are pulled, which this version does not yet do.

A command fails rather than print a partial result when any API request
fails or gets no response, and also when its session cannot be revoked.
Names from the API are printed with control characters escaped.
`ls --org <id>` refuses an organization you do not belong to or whose sync
you paused, so it never downloads paused content.

The recovery key is the whole identity: anyone holding it can act as you.
It reaches the Keychain through `security -i` on stdin, never through a
process argument.

## Tests

```sh
bun run --cwd packages/cli test
```

The end-to-end tests boot the API in-process, register accounts the way the
app does, and drive the CLI against it.
