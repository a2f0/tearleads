# PlanetScale Evidence

Production (`tearleads-prod`) and staging (`tearleads-staging`) are
PlanetScale Postgres databases in the `tearleads` organization, each with
one production branch, `main`. PlanetScale observes every query the API
runs there. Its telemetry ranks where to look; the audit still proves each
saving on the audited revision.

## Access and safety

The service token in each tier's `.secrets/<tier>/planetscale.env`
(`PLANETSCALE_SERVICE_TOKEN_ID`, `PLANETSCALE_SERVICE_TOKEN`) reads the API
below and can create branch roles. Load it with `set -a; . <file>; set +a`
and send `Authorization: <id>:<token>`. Never print, log, or save the token
or a role password. Write credentials only to a mode-`0700` scratch
directory and delete them after use.

The audit is read-only against PlanetScale except for one temporary role per
database:

- Never apply a recommendation's DDL, dismiss a recommendation, open a
  deploy request, change a parameter, or create a branch.
- Create the role with a short TTL and only read roles, use it for the
  capture, and delete it immediately. A read-only role cannot write, so
  `EXPLAIN ANALYZE` of a write fails rather than executing.
- Never copy row data out. Capture statistics, catalog definitions, and
  normalized SQL only.
- Another session may be running a greenfield reset that destroys these
  databases. Check for peer sessions before creating a role, tell them the
  role exists, and report its deletion. An unexpected role makes a reset
  preflight stop.

## Endpoints

`BASE=https://api.planetscale.com/v1/organizations/tearleads/databases`;
each path below follows `$BASE/<db>`.

| Path | Use |
| --- | --- |
| `/schema-recommendations?per_page=100` | Recommendations with `recommendation_type`, `ddl_statement`, `table_name`, and `metadata` (for `duplicate_index`: `index_definition`, `index_covered_by`, `index_duplicate_type`) |
| `/branches/main/insights?sort=<key>&dir=desc&per_page=100&from=<t>&to=<t>` | Query patterns: `normalized_sql`, `query_count`, `sum_total_duration_millis`, `p50_latency`, `p99_latency`, `rows_read_per_returned`, `rows_read_per_query`, `index_usages`, `tables`, `statement_type`, `fingerprint` |
| `/branches/main/insights/<fingerprint>` | One pattern over time |
| `/branches/main/insights/errors`, `/branches/main/insights/anomalies` | Erroring patterns and slow periods |
| `/branches/main/roles` (GET, POST), `/branches/main/roles/<id>` (DELETE) | Temporary role |

Insights quirks, observed against this account:

- A listing returns at most 100 patterns and `next_page` stays null. Fetch
  the top 100 for several sort keys and union them by `id`: `count`,
  `totalTime`, `rowsRead`, `rowsReadPerReturned`, `cpuTime`, `ioTime`,
  `rowsAffected`, and `rowsReturned`.
- `from` and `to` are ISO timestamps with milliseconds and must fall on hour
  boundaries for ranges over 25 hours. `period` accepts `15m` to `2d`.
  A `from`/`to` window from branch creation to the last whole hour was
  accepted at up to 11 days on 2026-10-30; prefer it over a two-day
  `period`.
- Bursts return the plain-text body `Retry later`. Validate each file as
  JSON and retry after a pause.

## Snapshot procedure

Create `planetscale-snapshots/<UTC-timestamp>/` beside the audit directories
(see `batching.md`), with one subdirectory per database:

1. `database.json` and `branches.json`, to record creation time and branch.
2. `schema-recommendations.json`.
3. `insights/top-<sort>.json` for each sort key above over the window from
   branch creation to the last whole hour, then `insights-union.json`
   (`jq -s '[.[].data[]] | unique_by(.id)' insights/top-*.json`), plus the
   errors and anomalies listings. Record the window in `window.txt`.
4. `pg-stats.tsv` through a temporary role:

   ```sh
   curl -sS -H "$AUTH" -H 'Content-Type: application/json' -X POST \
     "$BASE/<db>/branches/main/roles" \
     -d '{"name":"db-audit-readonly-<date>","ttl":7200,"inherited_roles":["pg_read_all_data","pg_read_all_stats","pg_monitor"]}' \
     > "$CREDS/<db>.json"
   ```

   Connect with `psql` using the response's `access_host_url`, `username`,
   `password`, and `database_name`, port 5432,
   `sslmode=verify-full sslrootcert=system`, and run `psql -X -A` over the
   statistics queries below. Then `DELETE` the role by its `id`, list roles
   to confirm only the deployment roles remain, and remove the credentials.
5. A `README.md` naming the capture time, the deployed revision, the
   deployed table count, the data size (users and documents), and anything
   that failed.

Statistics to capture, read-only:

- `version()`, `pg_stat_database` for the current database, installed
  extensions (`pg_extension`), and planner settings (`shared_buffers`,
  `work_mem`, `effective_cache_size`, `random_page_cost`,
  `max_connections`, `jit`, `plan_cache_mode`).
- `pg_stat_user_tables`: live and dead tuples, sequential and index scans,
  tuples read, inserts, updates, HOT updates, deletes, and sizes.
- `pg_stat_user_indexes` joined to `pg_index`: scans, tuples read and
  fetched, size, uniqueness, and `pg_get_indexdef`.
- Foreign keys whose columns are not the leading columns of any index.
- `pg_stat_statements` when installed. It was not installed on 2026-10-15;
  Insights replaces it.

`hypopg` was installed on 2026-10-15. Hypothetical indexes live only in the
session, so a read-only role can test whether an index would change a plan
on production statistics (`select hypopg_create_index('<create index>')`,
then `EXPLAIN` without `ANALYZE`). At small data sizes the answer is often
no; prefer local plans for proof.

## Mapping leads to the audited revision

The deployed databases run whatever revision was last deployed; the audit
runs at its pinned SHA. Find the deployed table set in `pg-stats.tsv` and
compare it with `packages/api-shared/drizzle/0000_greenfield_baseline.sql`
at the audited SHA. For each recommendation and each Insights pattern in
the union:

- **live:** the table, index, and query shape exist at the audited SHA.
  Find the code that issues it (`rg` for the table's Drizzle symbol and a
  distinctive column list) and record the file and function.
- **moved:** the query still runs, but against a renamed or folded table or
  with a changed column list. Record the new site.
- **stale:** retired since the deploy. Keep it in the lead map with the PR
  that retired it, and do not queue it.

Rank live and moved leads by `sum_total_duration_millis` and by
`query_count`, and attach them to the slice that owns the issuing code.

## Reading the numbers

- Call counts are reliable even on small data: a lookup run 60,000 times
  for 20 users is a per-request or per-statement repetition worth tracing.
- `rows_read_per_returned` far above one on a growing table marks a scan
  or a poor index, but on a table of tens of rows a sequential scan is the
  planner's correct choice. Confirm with a local plan.
- `index_usages` shows which index each pattern used, which is the direct
  way to spot a query that never touches the index meant for it.
- A `duplicate_index` recommendation of type `left_prefix` means another
  index starts with the same columns. Before proposing the drop, check that
  the narrower index is not unique (a unique index enforces a constraint the
  wider one does not, and may be an `ON CONFLICT` target or a foreign key's
  referenced key), and that the covering index serves every query that used
  the narrower one on both dialects.
- Zero `idx_scan` on small data is not proof an index is unused. Prove
  disuse statically: no production query filters, joins, or orders by its
  leading columns, and no constraint depends on it.
