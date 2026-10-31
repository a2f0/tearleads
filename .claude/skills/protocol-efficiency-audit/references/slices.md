# Audit Slices

Read only the selected slice section when preparing an auditor prompt. Keep
the other slices in the coverage queue described in [batching.md](batching.md).

Client paths are under `packages/client-sdk/src` and API paths are under
`packages/api/src` unless a full path is shown. API tables are defined in
`packages/api-shared/src/schema` and listed in
`packages/api-shared/drizzle/0000_greenfield_baseline.sql`; SDK tables are
defined in `data/sqlite/schema/`.

| Slice | Client scope | API scope |
| --- | --- | --- |
| `policy-reads` | `workflows/principals`, `data/principals`, `data/persistence/principal*`, `data/persistence/verifiedPrincipalPolicy*`, policy and authority modules in `workflows/organizations`, `client/runtime/principalHistoryProtection.ts`, `client/runtime/principalMutation*.ts` | `routes/principals`, `services/principals`, `workflows/principals`, `access/read/principal*`, `access/write/principal*` |
| `document-write-path` | `workflows/documents`, `workflows/blobs`, `data/sync`, `data/documents`, `stores/documents`, `workflows/container-contents/pendingWrites*` | `routes/documents`, `routes/blobs`, `services/documents`, `services/blobs`, `workflows/documents`, `workflows/blobs`, `documents/` |
| `discovery-and-hints` | `sync/reconciliation`, discovery, hydration, listing, tombstone, and metadata modules in `workflows/container-contents`, `stores/local-projection`, `stores/container-contents`, `packages/app/src/providers/sdk/serverEvents*` | `services/containers` listing and paging, `realtime/`, `workflows/regainedAccessTombstones.ts`, `workflows/principals/accessLossTombstones.ts` |
| `projections-and-keying` | `data/keyingProjectionVerification`, `data/persistence/keyingCheckpoint*`, `workflows/containers` | `access/`, `workflows/containers/writerProjection*`, `workflows/documents/writerProjection*`, `workflows/keyingReadAccess.ts`, `services/containers/writerProjection.ts`, `services/containers/kekLog.ts`, recite in `workflows/containers/mutations` |
| `receipts-and-ledgers` | intent, journal, checkpoint, and failure tables and their persistence modules | receipt, acknowledgement, observation, and audit tables, the manifest verification marker, and their stores |
| `org-read-model` | `workflows/organizations/readModel*`, `client/organizations`, `data/persistence/organizations` | `workflows/organizations/readModel*`, `directory.ts`, `roster*.ts`, `groupMemberships.ts`, `routes/organizations` read-model route |
| `bootstrap-and-session` | `workflows/registration`, `client/session`, `client/runtime/rootContainerAdoption.ts`, `packages/app/src/providers/sdk`, `packages/app/src/identity` | `routes/auth`, `workflows/auth`, `services/auth`, `workflows/organizations/provision*`, `realtime/wsTicket.ts`, `realtime/containerInterest*` |
| `api-schema` | none | every table in the API baseline, collating the domain slices |
| `local-schema` | every table in `data/sqlite`, collating the domain slices | none |

## `policy-reads`

Tables: API `principal_states` (container grants are its `container_grants`
column since #2536), `principal_state_payloads`,
`principal_member_envelopes`, `principal_membership_projection`,
`principal_epoch_keys`, `principal_directory_bindings`,
`principal_history_index_nodes`, `principal_history_progress`,
`principal_policy_commits`, `principal_policy_mutation_acknowledgements`.
SDK `principal_policies`,
`principal_policy_bundle_history`, `principal_policy_bundle_references`,
`principal_policy_checkpoints` (owner and pin, #2697),
`principal_history_prefixes`, `principal_history_entries`,
`principal_history_nodes` (stored nodes and liveness rows, #2697),
`principal_history_root_owners`, `principal_key_envelope_archive`,
`principal_history_stages` (with scope and recency columns, #2539),
`principal_mutation_journal`, `principal_grant_retirements`.

- One small Explorer upload measures 8 requests, 3 of them
  organization-policy discovery reads, one per workflow operation
  (`ExplorerUploadRequestVolume.test.tsx`). The operation-scoped principal
  recovery memo (#2529) already removed re-reads within one operation. Trace
  each remaining read to the verifier or resolver that demanded it. Which
  repeat a head another operation of the same session already verified
  (`docs/principal-history-acceptance.md`, "Ordinary workflow cost")?
- The memo's reuse binding (operation, exact key, the hint epoch observed
  before the reads, producer lifetime, durable pins) is modelled by
  `formal/container-keying/PrincipalRecoveryReuse.tla`. Could any part of it
  span operations without weakening the lifetime and dependency checks the
  acceptance document protects?
- Writer projections cite manifest bundles by hash (#2535), but policy
  evidence (`policyEvidence.organizationPayloads`) and the `principalPolicies`
  a container mutation sends (about 9.8 KB each) still travel in full. Could
  they cite the exact policy heads they depend on, given that a state hash
  alone does not capture projection currency?
- Is the private paged history (32 entries per page, preparation workers,
  503 backpressure, 15-second deadlines) needed on the ordinary write path,
  or only for cold recovery? Could ordinary verification be one request for
  "current head plus its chain back to my checkpoint"?
- Could `principal_policy_commits` and
  `principal_policy_mutation_acknowledgements` collapse into one receipt keyed
  by the signed event? #2522 declined this (#15: the keys and lifetimes
  differ, and some acknowledgements have no request hash); answer that first.
- Of the fifteen local principal tables, which hold at most one row per
  principal and could be columns, and which duplicate `principal_policies`?
- Count the pages a typical organization policy read takes at the directory
  sizes the fixtures use, and at ten times that size.

## `document-write-path`

Tables: API `documents`, `document_updates`, `document_update_spans`,
`document_content_key_epochs`, `document_content_key_targets`,
`document_content_write_headers`, `document_inline_rekey_commits`,
`document_manifest_observations`, `blobs`,
`blob_stages`, `blob_content_key_epochs`, `blob_content_key_targets`,
`blob_content_write_headers`, `attachment_bindings`. A document's current
links are `access_manifest_heads` joined to
`access_manifest_document_link_projection` (#2536). SDK `documents` (which
carries the last sync failure, #2539), `document_history_checkpoints`,
`document_history_updates`, `document_pending_attachments`,
`document_attachment_blob_projection`,
`document_orphan_blob_reclaims`.

- One small file costs create, stage (which returns the first parts' upload
  sources), the part upload, bind (which completes the stage), one content
  sync, and three policy reads: 8 requests at 6f3193489 (#2697). Could bind
  carry the first content update while keeping the signed write header, the
  staged SHA-256 check, and lost-response adoption? A stage created by its
  bytes was declined: production uploads go to R2 through presigned URLs,
  not through the API.
- Writer projections carry each manifest bundle once and omit bundles the
  client cites in `x-known-manifests` (#2535). List what still travels on
  every read and which call site consumes it: policy evidence, the KEK
  history in mutation responses, the bundles repeated in purge-proof
  responses. What could a client that holds it cite?
- Who reads `document_manifest_observations` and `document_update_spans`? Is
  each derivable from `document_updates` and the manifest chain, and what
  query needs it? #2522 kept `document_inline_rekey_commits` (#14): re-signed
  inline rekey retries need it to surface the lost-response conflict code.
- Locally, content is a checkpoint snapshot in `document_history_checkpoints`
  plus the update log in `document_history_updates`, which is also the write
  queue (#2534). Restore replays queued rows over a checkpoint that may
  already cover them. Which reads need which, and where do the snapshot and
  the log still hold the same bytes?
- Is the `documents.sync_failure_*` state the scheduler needs, or a diagnostic
  that belongs in the incident ledger?
- Could the sync response carry the next writer projection a follow-up pass
  would otherwise fetch?

## `discovery-and-hints`

Tables: API `container_sync_tombstones`,
`container_document_sync_tombstones`, `organization_group_tombstones`,
`container_metadata_documents`. SDK `container_sync_watermarks` (cursor and
lane check share one row, #2537), `document_discovery_heads`,
`document_discovery_sequence`, `pending_document_discoveries`,
`container_hydration_tombstones`, `container_document_tombstone_holds`,
`dormant_container_metadata`, `dormant_metadata_sweep_requests`,
`document_container_projection`, and `containers` (which carries display
name and icon since #2539).

- A hint carries ids only, so each costs a listing, a projection, and a sync.
  Every artifact is signed and self-verifying: what could a hint carry (the
  signed event, the manifest head, update ids) so the client verifies and
  applies it without HTTP? Answer the constraints that retired A1 to A3 in
  the closeout (now `docs/request-budgets.md#design-decisions`): replay
  authorization, atomic durability, retention, acknowledgement, and ordered
  local application. Measure requests per hint
  today with the sharing canary.
- Reconnect clears projection caches and runs a full reconciliation. Count
  its requests for the fixture tree and for a fifty-container tree; could one
  "changes since watermark across my interest set" request replace per-lane
  listings while keeping per-container authorization?
- A generic parent hint invalidates the whole known subtree. What does that
  cost per hint, and is there a privacy-preserving narrower frame?
- Three tombstone tables on the API and two tombstone or hold tables locally:
  could deletions be rows in the listing stream instead of separate tables,
  and what anti-resurrection rule must survive?
- Watermarks, lane checks, discovery heads, and the discovery sequence are
  four local records of listing position. Which reads need which?
- Startup arms a probe per opened document and priming opens stores. Count
  the probes for the bootstrap fixture and say which a listing could answer.

## `projections-and-keying`

Tables: API `access_events`, `access_manifests`, `access_manifest_heads`,
`access_manifest_container_grant_projection`,
`access_manifest_document_link_projection`,
`access_manifest_principal_head_projection`, `container_key_epochs`,
`container_key_wraps`, `container_builtin_grants`. The server's verification
marker is the `access_manifests.verification_mac` column (#2536). SDK
`access_manifest_checkpoints`,
`verified_access_manifest_bundles`, `superseded_container_bindings`,
`principal_grant_retirements`.

- A writer projection cites each manifest bundle by hash and omits up to 48
  bundles the client names in `x-known-manifests` from
  `verified_access_manifest_bundles` (#2535). Policy evidence, KEK state, and
  the keyring still travel on every read. Which of those does a client with
  checkpoints already hold verified, and could it cite them too?
- For each `access_manifest_*_projection` table, name the route that reads
  it and the query it answers. Could an index on the canonical manifest serve
  it? #2522 kept the principal-head projection (#27): SQLite and Turso have
  no containment index, so the reverse lookup would become a `json_each` scan.
- `access_manifests.verification_mac` memoizes the server's own verification
  (#2383). What is its hit pattern, and does a stored-artifact verification on
  read remain necessary once commit-time verification is trusted? The API
  still loads every cited manifest on a projection read.
- Container mutations and recites cite stored manifests by
  `{containerId, manifestHash}` (#2534), so a recite no longer re-embeds
  them. What else does a recite carry that the server could derive from
  stored manifests?
- A blob bind fetches a writer projection first; could bind cite heads and
  let the server resolve paths the way sync's `authorizingContainerPathRefs`
  does?
- Count statements per writer-projection read under the statement counter.

## `receipts-and-ledgers`

Tables: API `principal_policy_commits`,
`principal_policy_mutation_acknowledgements`,
`document_inline_rekey_commits`, `document_manifest_observations`,
`document_baselines`, `blob_audit_objects`. SDK `principal_mutation_journal`,
`organization_provisioning_attempts`, `local_intents` (container create,
container move, and document placement lanes, #2539),
`document_intent_link_targets`, `document_purge_checkpoints`,
`security_incidents`.

- Run the reader and writer census from `measurement.md` on every table
  above. A table with no non-test reader is a retirement candidate unless a
  documented operator or product need exists; name the need or the absence.
- Compare the idempotency and lost-response mechanisms: policy commit
  receipts, mutation acknowledgements, inline rekey commits, stable-id create
  conflicts, binding adoption. Could one receipt keyed by signed event id
  serve them all, and what does each caller lose?
- Baseline markers and the blob registry: which reads need each column, and
  what do they cost per write in statements?
- Local intents: four intent tables and a mutation journal. Could one typed
  outbox hold them, keeping each intent's settlement rule?
- Which checkpoint tables could merge without weakening anti-rollback?

## `org-read-model`

Tables: API `organization_read_model_heads` (the cursor and per-lane cursor
stamps), `organization_roster_entries`, `groups` (`membership_cursor`), and
`organization_group_tombstones` (`deleted_cursor`); #2532 replaced the
change log with these stamps. SDK
`organization_read_model_state`, `organization_read_model_requesters`,
`organization_read_model_directory_users`,
`organization_read_model_groups` (which folded the policy-head and
group-membership head tables in #2532),
`organization_read_model_group_members`,
`organization_read_model_container_grants`,
`organization_presentation_denials`, `organization_data_usage_snapshots`
(whose category breakdown is a validated JSON column, #2539).

- The signed organization policy already carries the authoritative group
  directory and reserved heads. What does the read-model feed add beyond
  display names and flags, and could that come from the signed payload plus
  a profile document instead of a second feed with its own cursor and lane
  stamps?
- The local tables above hold a display projection. Which does a query need
  as a table, and which could be one JSON column?
- Count read-model refreshes in the sharing scenario and per group mutation.
  Which are same-session echoes? #2522 declined dropping the post-mutation
  echo read (#29): no response or hint carries the committed cursor.
- Is `organization_roster_entries` derivable from the `Members` policy?

## `bootstrap-and-session`

- Personal bootstrap measures 31 requests at 6f3193489 (93 at #2522), with 7
  document syncs, 6 policy reads, and 4 writer projections. Attribute each
  class per endpoint and per pane, and name the mechanism that adds it.
- Registration commits in one transaction, and provisioning primes the
  discovery heads and policy stages the client just signed (#2531). What does
  the client still fetch that the registration response could have returned?
  #2531 names seeded-container destination verification (about a third of
  bootstrap response bytes; it touches the #2266 root-reconciliation rule) and
  a root metadata write after registration.
- Login is challenge, verify (which returns the first websocket ticket), and
  session reads; reconnects mint a ticket with `POST /auth/ws-ticket` (#2524).
  Could first-frame bearer authentication retire tickets, and what deadline
  would an unauthenticated socket need?
- Interest belongs to one socket: the client declares it on every connect
  and the server keeps no copy (#2524). What does each declaration cost the
  gateway in authorization queries?
- Contacts container and self contact are created device-first by design;
  #2522 declined seeding them at registration (#18). Could their metadata and
  identity writes fold into their creates?

## `api-schema`

- Classify all API tables as signed-artifact store, derived projection,
  index, receipt, audit, lifecycle, or billing (out of scope). Collate the
  domain slices' table findings; do not redo their deep traces.
- For each derived projection, name the query it answers and whether an
  index on the artifact table could serve it at the fixture sizes.
- Flag tables with one writer and one reader, tables with no reader, and
  tables whose non-key columns duplicate a sibling.
- Propose a target table list with a count, and the proposals it depends on.

## `local-schema`

- Classify all SDK tables as durable intent (must stay), evidence or
  checkpoint (must stay, may merge), server-state cache (rebuildable from a
  listing), or projection for queries. Collate the domain slices' findings.
- For each cache table, say what a cache miss costs in requests, so the
  trade is explicit.
- Flag tables keyed by the same id with one row each, tables only ever read
  with another table in the same query, and tables no production query reads.
- Propose a target table list with a count, and the proposals it depends on.
