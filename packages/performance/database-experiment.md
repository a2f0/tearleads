# Database round-trip experiment

Use this experiment to distinguish connection setup and repeated network/proxy
round trips from PostgreSQL execution work. It sends constant queries through
the selected API's existing Hyperdrive binding, with query caching disabled.
It creates no accounts and neither reads nor writes application tables.

The [first staging and production results](database-baseline.md) show roughly
five milliseconds per warm exchange and a 13–20 times faster constant-query batch
in production.

## Running

```sh
bash -c '. terraform/scripts/common.sh; load_secrets_env staging && export_wrangler_env && bun run perf:database --env staging --samples 3 --cloudflare'
```

For production, use `load_secrets_env prod` and `--env production`. The
environment is required. Samples run serially, one second apart; the default
is one and the maximum is ten. Measurement requests are never retried and stop
on the first failure. The existing pool may retry one transient connection
acquisition failure before any SQL; that time stays in `connectMs`.

Cloudflare credentials need Workers Scripts Edit and Hyperdrive Read, plus tail
permissions for `--cloudflare`. They are needed even without tail because this
command creates a temporary Worker. Use the environment loader; credentials
never appear in arguments or reports. No SDK build is needed for this probe.

The CLI copies deployed compatibility flags, pool settings, and Hyperdrive ID.
It uploads the region hint from `packages/api/wrangler.jsonc` and requires the
resulting persisted placement to equal the deployed API's placement before
running SQL. Cloudflare's numeric placement targets cannot be uploaded directly.
Neither the live API nor Hyperdrive configuration is changed.

## Measurement boundary

Each request uses one new request-scoped pool and checks out one client. The
public `@tearleads/api-shared/postgres-transport` export supplies the existing
`PostgresPool`, configuration readers, and coalesced Workers socket. This export
contains no schema initialization or application workflow. The probe overrides
only its query timeout; Hyperdrive supplies the connection string.

| Field | What it measures |
| --- | --- |
| `connectMs` | Client checkout and Hyperdrive connection setup |
| `beginMs` | Starting the read-only transaction; may acquire an origin connection |
| `firstQueryMs` | First constant SELECT after transaction setup |
| `simpleMs` | Twenty individually awaited `SELECT 1 AS value` calls |
| `parameterizedMs` | Twenty interleaved `SELECT $1::integer AS value` calls |
| `batchMs` | The same twenty simple SELECTs in one driver exchange |
| `planningMs`, `executionMs` | PostgreSQL EXPLAIN ANALYZE times for the constant query |
| `explainRoundTripMs` | Driver duration of that EXPLAIN call |
| `elapsedMs` | Worker clock duration through COMMIT, including setup, excluding pool disposal |
| `httpMs` | CLI request duration including response body and transport |
| `cloudflare.events` | Correlated invocation CPU and wall time, when available |

Simple and parameterized calls alternate to reduce drift between the two
protocols. The batch follows them, so cache/order effects remain possible.
The probe checks every constant result, verifies `transaction_read_only`, and
commits the read-only transaction. Failed requests roll back and destroy the
client. There are 48 driver query calls representing 67 SQL statements per
successful sample, including transaction controls and timeout settings.

The health check warms Worker startup without contacting the database. Every
sample creates a new client, but Hyperdrive's origin pool and database caches
are reused; this is not a forced cold-origin benchmark. No real application
queries, payload transfer, locks on application rows, or crypto work are included.

## Interpretation

Compare the sum of twenty `simpleMs` values with `batchMs`. Both execute the
same twenty trivial SELECTs; the difference measures avoidable per-call overhead
across the driver, socket, proxies, and network. It is not a pure network ping.
A small EXPLAIN execution time alongside large warm-query duration supports
round-trip amplification. It does not establish database host CPU utilization
or prove every provisioning statement has the same cost.

Workers clocks advance across I/O. Invocation CPU is a separate measurement;
do not subtract it from driver time or add these overlapping clocks. EXPLAIN
reports server elapsed time, not CPU time. A large connection or BEGIN time
suggests setup/pool acquisition; a large simple/parameterized difference may
indicate protocol overhead. The batch intentionally uses the simple protocol.

Reports record the `cf-placement` execution-location header when available.
Cloudflare documents this as a request header, read by the Worker.
`request.cf.colo` and the response's `cf-ray` suffix identify ingress and must
not substitute for it. See Cloudflare's
[placement documentation](https://developers.cloudflare.com/workers/configuration/placement/).

## Lifecycle and reports

The Worker has a unique `tl-db-probe-<tier>-<UUID>` name, a random bearer secret,
and a 30-minute access expiry. Its only authenticated routes are GET `/health`
and POST `/probe`; neither accepts custom SQL. Each statement has a two-second
server timeout, idle transactions expire after five seconds, driver queries
time out after five seconds, and the CLI allows 45 seconds per sample.

Normal completion, failure, and handled interruption close the tail session and
delete the Worker, then verify absence. If the process is forcibly killed or
Cloudflare deletion fails, the recorded Worker name may require manual deletion;
expiry disables requests but does not delete the resource. Failed reports record
cleanup status. An existing name is never overwritten or deleted.

Reports are written atomically with owner-only permissions under
`.test_files/performance/database-<tier>-<run>.json`. They include individual
measurements, source revision and dirty flag, bundle SHA-256, copied configuration
without binding IDs, optional tail evidence, and verified cleanup status. Tokens,
connection strings, arbitrary exceptions, EXPLAIN plans, and raw tail logs are
excluded. Missing tail CPU or placement stays unavailable rather than zero.

Automated tests use local fixtures only. The live command is neither a CI gate
nor a cached Turbo task.
