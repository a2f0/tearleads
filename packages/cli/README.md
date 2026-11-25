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
Usage: tearleads <command> [--env production|staging|development] [--org <id>] [--trace]

Commands:
  login    Save a recovery key (seed phrase) for the target in the Keychain.
  register Create the account for a recovery key, then save it like login.
  logout   Remove the target's saved recovery key.
  whoami   Show the signed-in user, signing fingerprint, and organization.
  orgs     List the organizations you belong to.
  verify-seed  Read back the original fixture contents and attachment bytes.
  seed     Sync the Continuity screenshot dataset to your personal organization.
           With --roster, also seed its groups and their members.
  ls       List the folders of your organization, or of --org <id>.
```

`--env` defaults to `production` (`https://api.tearleads.com`). `staging` is
`https://api-staging.tearleads.com`, and `development` is the local API
started by `scripts/dev/runApi.sh` (`http://localhost:3001`, the URL the app
uses in dev). Each target keeps its own saved key.

`register` creates the account a recovery key derives, the way a new app
install does, then saves the key like `login`. An account that already exists
is left as it is.

Creating an account means agreeing to the Tearleads
[Privacy Policy](https://tearleads.com/privacy-policy/) and
[Terms of Service](https://tearleads.com/terms-of-service/). Before `register`,
or `seed --roster` for its member accounts, creates one, it prints both
documents' addresses and their effective date, then asks you to type `yes`; the
API records that revision and the time on the account. `--accept-terms` agrees
without asking, which is the only way to agree when no terminal can ask, such as
with `--key-stdin`. Nothing is asked when the account already exists.

`--key-stdin` reads a one-time recovery key for `register`, `seed`, or
`verify-seed` and keeps it out of the Keychain. `--api-url <origin>` points
those commands at an API other than the named targets, such as a test API on
a random port; it requires `--key-stdin`, so no saved key is ever sent there.
Plain `http` is accepted only for a loopback host.

```sh
printf '%s\n' "$RECOVERY_KEY" |
  bun run tearleads register --key-stdin --accept-terms --api-url http://127.0.0.1:32001
```

## Seed an account with Continuity

From the repository root on macOS, run the Quick start install and build steps,
then choose the environment where the account already exists.

```sh
bun run tearleads login --env staging
bun run tearleads seed --env staging
```

Paste the account's recovery key at the login prompt. For production, use
`--env production` on both commands; for a local API, `--env development`.
`scripts/dev/seedFromContinuity.sh <dev|staging|prod>` runs the install,
build, login, and traced `seed --roster` in one step, unlocking the login
Keychain first for shells outside the desktop session (SSH, tmux, screen); see
[Roster and groups](#roster-and-groups) for the seats that costs. Once the command
reports success, open the web app in that environment and sign in with the
same identity.
[Staging web app](https://app-staging.tearleads.com) ·
[Production web app](https://app.tearleads.com)

The command writes the pinned screenshot dataset into your personal
organization. Contacts and avatars appear in Contacts. Notes, photos, ID
documents, equipment, and health trackers sync under your root folder.
The import commits each document with an encrypted fingerprint of its fixture.
If it stops partway, run the
same command again. For the same dataset version it reuses the documents,
preserves moved documents and edits, and resumes missing uploads when the
recorded digest and byte length still match. Edited names and MIME types are preserved.
Before it resumes uploads, it checks that the document's first committed update
is its own, with the fixture fingerprint and content. A fingerprint copied into
a later edit does not count. If the check fails, run seed again, or permanently
delete that document on the web to skip it.
The command only adds attachments. If another device removes a slot during an
upload, the web app follows the edit and an encrypted fixture blob can remain
bound on the server. [Attachment binding follow-up](https://github.com/a2f0/tearleads/issues/3070)
A signed purge proof keeps a permanently deleted fixture out of future imports.
A changed seed manifest can produce a new set of documents.

### Roster and groups

`seed --roster` also seeds the dataset's organization groups (today a Family
group of three relatives). Each member gets an account whose recovery key is
derived from yours and the member's Continuity ID, so no one else can derive
it and every run reaches the same accounts. The command signs in as each
member to make their identity link, verifies the link as an Org Manager admin
would, adds the member to your roster under their contact name, and then to
the group, creating the group when your organization has none by that name.
A rerun finds the same members and changes nothing.

Each member takes a seat in your organization, so on a billed organization
this raises the seat count. The screenshot run passes `--roster`; leave it
off for an account you only want documents in.

To diagnose an import, run the read-only check in a fresh local session:

```sh
bun run tearleads verify-seed --env production --trace
```

It discovers the documents through their folders, checks the original fixture
fields, rows and original folder links, and compares every decrypted attachment
with the pinned bytes.
Verification honors the SDK retry delay for deferred documents and gives the
verification session one hour, including discovery continuation requests.
Each CLI process has a 65-minute limit and attempts logout on interruption.
An edit, removal or missing download fails the check and identifies the fixture.
Add `--trace` to `seed` for per-file staging, confirmation and skip messages.

## Tracing

Use `bun run tearleads seed --env production --trace` to see each fixture file
being staged, confirmed, or skipped, with its document key and upload timing.

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
