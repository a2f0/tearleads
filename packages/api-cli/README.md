# @tearleads/api-cli

Server-side operations CLI for the Tearleads API, shipped as a standalone Bun
executable (`tearleads-api-cli`) deployed to `/opt/tearleads/bin` alongside the
API server.

It is a separate deployable entry package: it depends on `@tearleads/api-shared`
for server infrastructure and **must not** import `packages/api` (enforced by the
`api-cli-does-not-depend-on-api` dependency-cruiser rule).

```
Usage: tearleads-api-cli <command>

Commands:
  blob-store:list-keys [--prefix <prefix>] [--with-size]    List configured S3 blob store keys
  migrate    Run API database migrations
```

An unknown or missing command prints usage to stderr and exits `1`; `-h` /
`--help` prints it to stdout and exits `0`.

## Commands

### `migrate`

Runs the Drizzle migrations for the API's Postgres database. Defaults
`API_DATABASE` to `postgres` when unset, then calls `initializeApiDatabase` from
`@tearleads/api-shared/postgres`.

In the compiled executable the migration files are **embedded** — the build
bundles `packages/api-shared/drizzle/**/*.{sql,json}` as assets, and the command
materializes them into a temp directory (`tearleads-api-migrations-*`), passes it
as `migrationsFolder`, and removes it afterwards. Run from source, no files are
embedded and `initializeApiDatabase` uses its own default folder.

The database connection is always closed and the temp folder always cleaned up,
even when migration fails; a cleanup failure is surfaced as a thrown error rather
than swallowed.

Locally, prefer the wrapper that checks Postgres is reachable first:

```bash
sh scripts/postgres/runPostgresMigration.sh
```

On deploy, `packages/api/scripts/deployStagingApi.sh` and its production sibling
run it over SSH with the server's environment loaded:

```bash
set -a && . /etc/tearleads/api.env && set +a && /opt/tearleads/bin/tearleads-api-cli migrate
```

### `blob-store:list-keys`

Paginates `ListObjectsV2` over the configured S3 blob bucket and writes one key
per line to stdout.

| Flag | Effect |
| --- | --- |
| `--prefix <prefix>` (or `--prefix=<prefix>`) | Limit the listing to keys under `<prefix>` |
| `--with-size` | Prefix each line with the object size as `<size>\t<key>` |

Arguments are parsed in a single pass, so a literal `--with-size` passed as the
`--prefix` *value* stays the prefix instead of being read as the flag. Unknown
arguments and a `--prefix` with no value throw. A truncated S3 response without a
continuation token is an error rather than a silent short listing.

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

For the deployed Garage buckets, use the repo wrapper — it resolves the server
over Tailscale SSH, sources `/etc/tearleads/api.env`, and invokes this command
remotely:

```bash
scripts/listGarageBucketKeys.sh <staging|prod> [prefix] [--with-size]
```

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
`BUN_COMPILE_TARGET` (`bun-linux-x64`, `bun-linux-arm64`, `bun-linux-aarch64`);
anything else throws. Targets are Linux-only because the executable exists to run
on the servers.

Deploy scripts build and `rsync` the executable to `/opt/tearleads/bin` on the
selected server (both are on `PATH` after sourcing `scripts/session.sh`):

```bash
deployStagingApiCli.sh
deployProductionApiCli.sh
```

Deploying the API server already runs the matching CLI deploy first, so the
migrations that run after it are the ones built from the same commit — deploy the
CLI on its own only when you want a CLI-only update.
