# @tearleads/api-cli

Server-side operations CLI for the Tearleads API, shipped as a standalone Bun
executable (`tearleads-api-cli`) deployed to `/opt/tearleads/bin` alongside the
API server.

It is a separate deployable entry package: it depends on `@tearleads/api-shared`
for server infrastructure and **must not** import `packages/api` (enforced by the
`api-cli-does-not-depend-on-api` dependency-cruiser rule).

```text
Usage: tearleads-api-cli <command>

Commands:
  blob-store:list-keys [--prefix <prefix>] [--with-size]    List configured S3 blob store keys
  make-admin <fingerprint>      Grant root (global admin) access to the identity with this signing key fingerprint
  migrate    Initialize the current API database schema
  revoke-admin <fingerprint>    Revoke root (global admin) access from the identity with this signing key fingerprint
```

A missing command prints usage to stderr and exits `1`; an unknown command
prints only `Unknown command: <name>` — no usage — and exits `1`. `-h` /
`--help` prints usage to stdout and exits `0`.

## Commands

### `migrate`

Initializes the current Drizzle baseline for the API's Postgres, local SQLite,
or remote
Turso database. Defaults `API_DATABASE` to `postgres` when unset, then calls
`initializeApiDatabase` from `@tearleads/api-shared/postgres`. Turso uses the
SQLite migration bundle.

In the compiled executable both dialects' migration files are **embedded** — the
build bundles `packages/api-shared/{drizzle,drizzle-sqlite}/**/*.{sql,json}` as
assets. The command materializes only the selected dialect into a temp directory
(`tearleads-api-migrations-*`), passes it as `migrationsFolder`, and removes it
afterwards. Run from source, no files are embedded and `initializeApiDatabase`
uses its own dialect-specific default folder.

Once the migration starts, both the success and failure paths attempt to close
the database and remove the temp folder; each attempt is guarded, so a failing
close or `rm` is reported rather than masking the other. The paths differ in
which error wins: when the migration itself fails, that error propagates and the
cleanup error is only logged; when the migration succeeds, a cleanup failure is
thrown. Cleanup is not reached at all if the `@tearleads/api-shared/postgres`
import fails, which happens after the temp folder is created.

Locally, prefer the wrapper — it fails early with setup instructions when no
Postgres connection variable (`DATABASE_URL`, `PGHOST`, …) is set, `pg_isready`
is available, and no server answers on the local socket or `localhost:5432`:

```bash
sh scripts/postgres/runPostgresMigration.sh
```

On deploy, `packages/api/scripts/deployStagingApi.sh` and its production sibling
run it over SSH through the operator wrapper:

```bash
sudo /usr/local/bin/tearleads-api-cli migrate
```

Run the tier's Ansible playbook before deploying API artifacts for the first
time. It installs the wrapper
and root-owned `/etc/tearleads/migrations.env`. The full
`scripts/deployProduction.sh` and `scripts/deployStaging.sh` do this in order;
`--skip-infra` requires that configuration to exist already. Production migrations
use a dedicated PlanetScale login on direct port 5432, while runtime traffic
uses the read/write login on pooled port 6432.

### `blob-store:list-keys`

Paginates `ListObjectsV2` over the configured S3 blob bucket and writes one key
per line to stdout. Blob uploads and promoted objects use
`organizations/<organizationId>/blob-stages/<stageId>` keys. To list one
organization's objects, pass `--prefix organizations/<organizationId>/`. If
`BLOB_OBJECT_STORE_S3_KEY_PREFIX` is configured, prepend that deployment prefix
too, for example `--prefix staging/organizations/<organizationId>/`.

| Flag | Effect |
| --- | --- |
| `--prefix <prefix>` (or `--prefix=<prefix>`) | Limit the listing to keys under `<prefix>` |
| `--with-size` | Prefix each line with the object size as `<size>\t<key>` |

Arguments are parsed in a single pass, so a literal `--with-size` passed as the
`--prefix` *value* stays the prefix instead of being read as the flag. Unknown
arguments and a `--prefix` with no value throw. A truncated S3 response without
a continuation token is an error rather than a silent short listing.

Requires these environment variables (read at command time, all validated):

| Variable | Required | Notes |
| --- | --- | --- |
| `BLOB_OBJECT_STORE` | yes | Must be `s3` |
| `BLOB_OBJECT_STORE_S3_BUCKET` | yes | |
| `BLOB_OBJECT_STORE_S3_REGION` | yes | |
| `BLOB_OBJECT_STORE_S3_ENDPOINT` | no | Set for Garage / non-AWS S3 |
| `BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE` | no | `1`/`true` or `0`/`false`; any other value throws |
| `BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID` | no | Must be set together with the secret |
| `BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY` | no | Must be set together with the key id |

With neither credential set, the AWS SDK's default credential chain applies.

For the deployed S3 buckets, use the repo wrapper — it resolves the server
over Tailscale SSH, sources `/etc/tearleads/api.env`, and invokes this command
remotely:

```bash
scripts/listBlobBucketKeys.sh <staging|prod> [prefix] [--with-size]
```

### `make-admin` / `revoke-admin`

Sets or clears `users.is_root` for the identity registered with the given
signing key fingerprint (the 64-character lowercase hex value shown as
`signingKeyFingerprint` in the app and API). Root identities may call the
API's internal `/root` operator routes, which list platform identities with
their last activity, live sessions, organization memberships, and
per-organization billing standing. Root is a plain operational boolean for
internal staff and technical support; it grants no access-plane keys and is
never exposed as a user-facing feature.

```bash
tearleads-api-cli make-admin <fingerprint>
tearleads-api-cli revoke-admin <fingerprint>
```

The command reads the database the same way `migrate` does (`API_DATABASE`
defaults to `postgres`, connection variables from the environment). It prints
whether the identity `is now root` or `was already root`, and fails with a
non-zero exit when the fingerprint is malformed, extra arguments are passed, or
no identity is registered under that fingerprint. In an SSH session on a
deployed server the operator wrapper (see below) supplies the environment:

```bash
tearleads-api-cli make-admin <fingerprint>
```

## Running on a deployed server

Ansible installs two conveniences for SSH sessions (`ansible/playbooks/server.yml`):

- `/etc/profile.d/tearleads.sh` appends `/opt/tearleads/bin` to the login
  shell `PATH`, so every deployed executable resolves by name.
- `/usr/local/bin/tearleads-api-cli` is a wrapper that sources
  `/etc/tearleads/api.env` for ordinary commands and the root-only
  `/etc/tearleads/migrations.env` for `migrate`, then execs the real CLI. It
  precedes `/opt/tearleads/bin` on `PATH`: `tearleads-api-cli <command>`
  then runs with the server's database and object-store settings while those
  secrets reach only the CLI process, not the interactive shell. Runtime settings
  are readable by root and the deploy user; migration settings require root.
  The wrapper fails closed when the selected file is not readable.

The deploy scripts use `sudo /usr/local/bin/tearleads-api-cli migrate`, so the
Ansible-installed wrapper and migration environment must exist first. Do not
source the runtime environment to run production migrations.

## Local development

```bash
bun src/index.ts --help                      # from packages/api-cli
bun src/index.ts blob-store:list-keys --with-size
bun run migrate                              # bun src/index.ts migrate
bun run test                                 # bun test src
```

## Build and deploy

```bash
bun run build                                # packages/api-cli/dist/tearleads-api-cli
```

`scripts/buildApiCliExecutable.ts` compiles from the repo root to a single
executable. The target defaults to `bun-linux-x64` and can be overridden with
`BUN_COMPILE_TARGET`: Linux x64/arm64/aarch64 for servers, or Darwin x64/arm64
for local executable tests. `BUN_COMPILE_OUTFILE` selects an isolated output
path; it defaults to `packages/api-cli/dist/tearleads-api-cli`.

The explicit repository build root preserves the embedded schema asset paths.
The compiled CLI test runs from outside the checkout and initializes a fresh
SQLite database twice, so it exercises packaging and idempotent initialization.

Deploy scripts build and `rsync` the executable to `/opt/tearleads/bin` on the
selected server (both are on `PATH` after sourcing `scripts/session.sh`):

```bash
deployStagingApiCli.sh
deployProductionApiCli.sh
```

Deploying the API server already runs the matching CLI deploy first, so the
migrations that run after it are the ones built from the same commit — deploy the
CLI on its own only when you want a CLI-only update.
