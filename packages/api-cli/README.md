# @tearleads/api-cli

Server-side operations CLI for the Tearleads API. The deploy scripts run it
from source against each tier's PlanetScale database and R2 bucket; it can also
be compiled to a standalone Bun executable (`tearleads-api-cli`).

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

On deploy, `packages/api/scripts/deployApi.sh` runs it from source before
publishing the API Worker, with the tier's PlanetScale migration login on the
direct port 5432 read from the `postgres` Terraform stack output:

```bash
bun src/index.ts migrate
```

Runtime traffic uses the read/write login on pooled port 6432; the migration
login never reaches the Worker.

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
| `BLOB_OBJECT_STORE_S3_ENDPOINT` | no | R2 account endpoint in deployment; LocalStack locally |
| `BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE` | no | `1`/`true` or `0`/`false`; any other value throws |
| `BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID` | no | Must be set together with the secret |
| `BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY` | no | Must be set together with the key id |

With neither credential set, the AWS SDK's default credential chain applies.

For the deployed R2 buckets, use the repo wrapper — it reads the tier's
`storage` Terraform stack output and invokes this command locally:

```bash
scripts/listBlobBucketKeys.sh <staging|prod> [prefix] [--with-size]
```

### `make-admin` / `revoke-admin`

Sets or clears `users.is_root` for the identity registered with the given
signing key fingerprint (the 64-character lowercase hex value shown as
`signingKeyFingerprint` in the app and API). Root identities may call the
API's internal, read-only `/root` operator routes: the identity directory
(filterable by fingerprint prefix, user ID, or root standing) with last
activity, live sessions, and organization memberships; the organization
directory with persisted billing and Stripe state, the latest billing events,
and rosters; and synced data usage per organization and across organizations
(see the operator table in `docs/api-architecture.md`). Root is a plain
operational boolean for internal staff and technical support; it grants no
access-plane keys and is never exposed as a user-facing feature.

```bash
tearleads-api-cli make-admin <fingerprint>
tearleads-api-cli revoke-admin <fingerprint>
```

The command reads the database the same way `migrate` does (`API_DATABASE`
defaults to `postgres`, connection variables from the environment). It prints
whether the identity `is now root` or `was already root`, and fails with a
non-zero exit when the fingerprint is malformed, extra arguments are passed, or
no identity is registered under that fingerprint. A change is recorded in the
root audit trail (`root_audit_events`, action `root.access.grant` or
`root.access.revoke`, with no actor) in the transaction that changes the flag;
a run that changes nothing records nothing. Root identities cannot be
suspended, and granting root does not lift an existing suspension; lift it
from the root console. Against a deployed tier,
export the runtime connection from the `postgres` Terraform stack output
(`terraform/scripts/run-postgres-stack.sh <tier> output -json api_connection`)
in a private shell, then run the command from source:

```bash
bun src/index.ts make-admin <fingerprint>
```

## Local development

```bash
bun src/index.ts --help                      # from packages/api-cli
bun src/index.ts blob-store:list-keys --with-size
bun run migrate                              # bun src/index.ts migrate
bun run test                                 # bun test src
```

## Build

```bash
bun run build                                # packages/api-cli/dist/tearleads-api-cli
```

`scripts/buildApiCliExecutable.ts` compiles from the repo root to a single
executable. The target defaults to `bun-linux-x64` and can be overridden with
`BUN_COMPILE_TARGET`: Linux x64/arm64/aarch64, or Darwin x64/arm64 for local
executable tests. `BUN_COMPILE_OUTFILE` selects an isolated output path; it
defaults to `packages/api-cli/dist/tearleads-api-cli`.

The explicit repository build root preserves the embedded schema asset paths.
The compiled CLI test runs from outside the checkout and initializes a fresh
SQLite database twice, so it exercises packaging and idempotent initialization.
Nothing deploys the executable; the Workers deployment runs the CLI from source.
