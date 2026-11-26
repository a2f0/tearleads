# Canary statement capture, 2026-11-26

One run of `bun run perf:canaries --statements --param-hash` on an M2 Pro
with Bun 1.4.2, at `c78d5c40d`, clean. All nine canaries passed in 151 s,
one sample each, and every capture's phase markers matched the request
profile. This is the first recorded statement baseline for the canaries.
Its request counts match the
[request-volume baseline](2026-11-26-request-volume-canaries.md) in every
phase but one: `provisioning + settle` in the groups canary sent 42 requests
against 41.

Counts are statements the in-process test API sent through the ORM on
PGlite, so they include no `begin` or `commit`. A request scope is one API
request, opened by the request-cost middleware. Statements outside every
scope are the canaries' own fixture and background work. A same-key repeat
is a statement sent again with the same text and bind-value hash inside one
request; the column counts the extra sends.

| Canary | Statements | In requests | Request scopes | Same-key repeats |
| --- | ---: | ---: | ---: | ---: |
| `DeviceFirstOfflineRequestVolume` | 1,554 | 1,291 | 49 | 215 |
| `DualPaneProvider.groupsRequestVolume` | 2,827 | 2,564 | 55 | 886 |
| `DualPaneProvider.sharing` | 11,180 | 10,911 | 316 | 2,875 |
| `ExplorerUploadRequestVolume` | 1,138 | 875 | 26 | 186 |
| `FolderMutationRequestVolume` | 1,842 | 1,579 | 56 | 281 |
| `GroupMutationRequestVolume` | 2,835 | 2,572 | 69 | 660 |
| `OrganizationBootstrapRequestVolume` | 2,242 | 1,977 | 52 | 423 |
| `PaneReconnectRequestVolume` | 3,657 | 3,392 | 144 | 532 |
| `PaneRestartRequestVolume` | 8,948 | 8,677 | 342 | 1,355 |
| Total | 36,223 | 33,838 | 1,109 | 7,413 |

Same-key repeats are 22% of the statements sent inside requests. The most
repeated, summed over the nine captures:

| Extra sends | Statement |
| ---: | --- |
| 1,924 | Principal state read: the `(((select 'state', …` union over principal heads |
| 1,019 | Container and access-manifest join: `select "containers"."id", … "access_manifests"."id", …` |
| 642 | Principal head read: `select "principal_type", "principal_id", "version", …` |
| 599 | Principal state read: the `(select 'state', …` union, a narrower form |
| 333 | Principal history read: `select "id", "principal_type", … "verification_kind", …` |
| 264 | `select "id", "organization_id" from "containers" where "containers"."id" in ($1)` |

Registration alone, one request writing 10 access manifests and 6
documents, sends 407 statements, 31 of them the same principal state read
with the same bind values. These are leads for the database efficiency
audit, not findings: a repeat may read a row the same request changed in
between.

The report's per-phase statement counts are not repeated here. A phase
counts the statements since the previous phase ended, so the first phase of
each test also holds its setup (`open left explorer` in the sharing canary
counts 10,274), and phases whose window spans earlier ones count 0. Measure
one operation exactly with a probe that sets `globalThis.sqlCaptureLabel`
around it.
