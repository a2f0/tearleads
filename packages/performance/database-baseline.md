# Database round-trip baseline, 2026-10-26

Three staging and three production samples completed through the API's existing
Hyperdrive bindings. Both tiers used the same probe bundle and deployed pool
configuration. No application tables were accessed and no accounts were created.
Every sample matched a Cloudflare tail event; there were no tail warnings.
Temporary Worker deletion was verified for both successful runs and all four
earlier staging upload attempts, which ran no SQL.

## Results

All timings are milliseconds. Simple and parameterized columns are the mean of
twenty individually awaited queries per sample. The serial total and batch each
execute twenty identical constant SELECTs. Server execution is the EXPLAIN
ANALYZE duration for one constant parameterized query, not database CPU time.

| Tier/sample | Connect | BEGIN | Simple mean | Parameterized mean | Serial total | Batch | Server execution | Worker CPU | Invocation wall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Staging 1 | 7 | 11 | 5.20 | 5.45 | 104 | 8 | 0.032 | 32 | 299 |
| Staging 2 | 8 | 6 | 4.95 | 4.60 | 99 | 7 | 0.041 | 36 | 272 |
| Staging 3 | 5 | 6 | 4.40 | 4.40 | 88 | 5 | 0.032 | 58 | 269 |
| Production 1 | 4 | 7 | 5.60 | 5.65 | 112 | 7 | 0.030 | 54 | 319 |
| Production 2 | 4 | 7 | 5.20 | 5.10 | 104 | 8 | 0.031 | 55 | 302 |
| Production 3 | 3 | 10 | 5.00 | 4.65 | 100 | 5 | 0.031 | 43 | 279 |

Production EXPLAIN planning took 0.008–0.009 ms; its complete driver call took
5–6 ms. Staging planning took 0.010–0.030 ms. Warm simple and parameterized calls
had similar latency; these samples show no large extra extended-protocol stall.

## Interpretation and next step

The production batch was 13–20 times faster than twenty separate calls, saving
95–105 ms while executing the same twenty trivial statements. Connection setup
was only 3–4 ms and BEGIN 7–10 ms. PostgreSQL executed the constant query in
about 0.03 ms while a warm driver exchange cost roughly five milliseconds.
This supports accumulated driver/proxy/network round trips as a major cause
of provisioning delay. It does not isolate which hop contributes that cost.

The [registration baseline](baseline.md) recorded 878 statements and about
seven seconds of database timing. At five milliseconds per awaited exchange,
hundreds of exchanges can consume seconds even when SQL execution is cheap.
That is an order-of-magnitude comparison, not a decomposition: ORM statement
count is not necessarily exchange count, the runs occurred on different days,
and real provisioning includes writes, locks, verification, and payloads absent
from this probe. The probe measures no database host CPU utilization, so it
cannot categorically rule out contention during the earlier registrations.

The next useful intervention is to combine repeated registration reads that
can share one exchange, then compare full registrations on staging. Preserve
authorization, verification failures, and transaction rollback. A reduction in
statement/exchange count accompanied by lower end-to-end registration time
would measure an actual user-facing improvement; this synthetic batch alone
does not establish its size.

## Reproduction and limitations

See [running and measurement boundaries](database-experiment.md). The CLI ran
on arm64 macOS with Bun 1.4.3, source base `78074ec586ea07e5534c710c56b7ded34d3fcff7`
plus the experiment changes in the working tree. Both bundles had SHA-256
`2304b17e4f9277a71c151a7091cef07757873546e0aaffb356badf7ab034177b`.
Staging started at 09:28:41 UTC and production at 09:30:10 UTC.

Both API Workers and probes resolved the configured `aws:us-east-1` hint to
`{"mode":"targeted","target":[1]}`. Compatibility date was `2026-08-17` with
`nodejs_compat` and `enable_request_signal`. Query caching was disabled,
coalesced writes enabled, and a request-scoped pool maximum of four.
`POSTGRES_POOL_MAX_USES=1` was copied but is ignored for request-scoped pools,
matching the API's connection reuse within a request.
The `cf-placement` execution header was unavailable in all six responses;
persisted placement matched, but actual execution datacenter was not observed.
The report retains `null` and does not infer it from ingress ray IDs.

No origin pool or database caches were reset. Health readiness warmed the Worker
without touching the database. Every sample opened a new client; Hyperdrive could
reuse origin connections. Three samples per tier do not establish population
percentiles, and the batch's position after serial queries leaves ordering effects.
Worker I/O clocks, invocation CPU, and invocation wall overlap and are not additive.

Private local evidence in `.test_files/performance/`:

- `database-staging-8d5e1f2d-cf77-48d5-a1b7-17a1a975fd25.json`
- `database-production-1e511bb9-978a-4eda-83c7-1d8c149efdef.json`

These retain individual query durations and verified cleanup status, with no
credentials, connection strings, query plans, application data, or raw logs.
