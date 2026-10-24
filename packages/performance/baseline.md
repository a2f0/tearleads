# Account provisioning baseline, 2026-10-24

One staging identity and three production identities were provisioned serially
through the public SDK on an arm64 Mac, Bun 1.4.3. Production ran from
15:47:43 to 15:48:20 UTC. Source base: `26160fea3`, with the new performance
harness in the working tree. Staging reported API version `2417`; production
reported `2421`. Their timings are not a same-version comparison.

All four registrations and logins succeeded, and every login session was
revoked. The four accounts and their personal organizations persist. Their IDs
are in the private local reports. Every HTTP attempt matched a Cloudflare
invocation; there were no missing events or tail warnings.

## Production measurements

All values below are milliseconds. Registration includes client preparation,
HTTP, response handling, verification, and local persistence. Login is separate.

| Sample | SDK registration | HTTP to headers | Server timing | DB timing | Statements | Worker CPU | Login |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10515 | 9867 | 7890 | 6944 | 878 | 1946 | 1157 |
| 2 | 8271 | 7720 | 7204 | 7129 | 878 | 1924 | 1296 |
| 3 | 8016 | 7509 | 6957 | 6884 | 878 | 1849 | 1255 |

Client preparation before the registration request took 482, 446, and 406 ms.
Work after response headers took 166, 106, and 101 ms. Identity generation took
35, 11, and 8 ms. Across each entire sample, the local database executed 299
calls in 70, 53, and 45 ms respectively. Setup and logout are excluded from
provisioning summaries. The first sample can include cold connection/process
effects; these three samples do not establish a population p95.

Staging registration took 12455 ms: HTTP 11761 ms, server 11064 ms, DB 9880 ms,
878 statements, and 3541 ms Worker CPU. Identity generation was 37 ms, login
889 ms, and all local SQL calls together took 64 ms.

## What this establishes

The observed production delay is predominantly in the server request. Its
database timing is consistently about seven seconds, with 878 statements for
one fresh account. Local key generation and SQLite are small by comparison.
Query amplification is the leading hypothesis for the database cost; these
aggregate timings do not identify which statements are slow or prove that
878 statements equal 878 network round trips.

The current
[registration budget test](../api/src/services/auth/registration.batching.test.ts)
already allows up to 900 statements for a full registration. Its fixture
contains six initial document updates. The
[organization provisioning workflow](../api/src/workflows/organizations/provisionOrganization.ts)
builds authority and billing, root metadata, roster/profile metadata,
organization metadata, and system containers in sequence inside one transaction.
The live 878-statement count is consistent with that existing budget, rather
than evidence of repeated HTTP registration attempts: each sample made exactly
one registration request.

Worker CPU also costs roughly 1.85–1.95 seconds. CPU, database timing, server
timing, and invocation wall time have overlapping accounting boundaries; they
must not be added or subtracted to produce an exact CPU/network breakdown.

The next useful experiment is to measure statement counts and durations by those
provisioning stages, then capture normalized query shapes in a controlled local
Postgres run. That can distinguish repeated reads, write amplification, and
expensive queries while preserving authorization verification and transactional
atomicity. Compare one targeted optimization against this same full-registration
scenario on staging before repeating a small production run.

## Local evidence

The ignored `.test_files/performance/` directory holds:

- `production-06395609-820e-43c2-bcea-6699b1261085.json`
- `staging-32cc8be1-02a4-4d16-9422-b28a82fd2c5a.json`

The production artifact includes the requested sample count. The initial staging
artifact predates that metadata naming adjustment; its sample array and summary
still identify the one attempt. Both include raw timing measurements, response
Cloudflare ray IDs, sanitized cost events, and account IDs. Neither contains
identity secrets, tokens, bodies, or raw logs. See the [runner guide](README.md)
for the scenario and timing boundaries.
