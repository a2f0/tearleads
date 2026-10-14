# Audit Slices

Read only the selected slice section when preparing an auditor prompt. Keep
the other slices in the coverage queue described in [batching.md](batching.md).

Client paths are under `packages/client-sdk/src` and API paths are under
`packages/api/src` unless a full path is shown. API tables are defined in
`packages/api-shared/src/schema` and listed in
`packages/api-shared/drizzle/0000_greenfield_baseline.sql`; SDK tables are
defined in `data/sqlite/*Schema.ts` and `data/sqlite/schema.ts`.

| Slice | Client scope | API scope |
| --- | --- | --- |
| `policy-reads` | `workflows/principals`, `data/principals`, `data/persistence/principal*`, `data/persistence/verifiedPrincipalPolicy*`, policy and authority modules in `workflows/organizations`, `client/principalHistoryProtection.ts`, `client/principalMutation*.ts` | `routes/principals`, `services/principals`, `workflows/principals`, `access/read/principal*`, `access/write/principal*` |
| `document-write-path` | `workflows/documents`, `workflows/blobs`, `data/sync`, `data/documents`, `stores/documents`, `workflows/container-contents/pendingWrites*` | `routes/documents`, `routes/blobs`, `services/documents`, `services/blobs`, `workflows/documents`, `workflows/blobs`, `documents/` |
| `discovery-and-hints` | `sync/reconciliation`, discovery, hydration, listing, tombstone, and metadata modules in `workflows/container-contents`, `stores/local-projection`, `stores/container-contents`, `packages/app/src/providers/sdk/serverEvents*` | `services/containers` listing and paging, `realtime/`, `workflows/regainedAccessTombstones.ts`, `workflows/principals/accessLossTombstones.ts` |
| `projections-and-keying` | `data/keyingProjectionVerification`, `data/persistence/keyingCheckpoint*`, `workflows/containers` | `access/`, `workflows/containers/writerProjection*`, `workflows/documents/writerProjection*`, `workflows/keyingReadAccess.ts`, `services/containers/writerProjection.ts`, `services/containers/kekLog.ts`, recite in `workflows/containers/mutations` |
| `receipts-and-ledgers` | intent, journal, checkpoint, and failure tables and their persistence modules | receipt, acknowledgement, observation, verification-cache, and audit tables and their stores |
| `org-read-model` | `workflows/organizations/readModel*`, `client/organizations`, `data/persistence/organizations` | `workflows/organizations/readModel*`, `directory.ts`, `roster*.ts`, `groupMemberships.ts`, `routes/organizations` read-model route |
| `bootstrap-and-session` | `workflows/registration`, `client/session`, `client/rootContainerAdoption.ts`, `packages/app/src/providers/sdk`, `packages/app/src/identity` | `routes/auth`, `workflows/auth`, `services/auth`, `workflows/organizations/provision*`, `realtime/wsTicket.ts`, `realtime/containerInterest*` |
| `api-schema` | none | every table in the API baseline, collating the domain slices |
| `local-schema` | every table in `data/sqlite`, collating the domain slices | none |

## `policy-reads`

Tables: API `principal_states`, `principal_state_payloads`,
`principal_member_envelopes`, `principal_membership_projection`,
`principal_container_grant_projection`, `principal_epoch_keys`,
`principal_directory_bindings`, `principal_history_index_nodes`,
`principal_history_progress`, `principal_policy_commits`,
`principal_policy_mutation_acknowledgements`. SDK `principal_policies`,
`principal_policy_organizations`, `principal_policy_bundle_history`,
`principal_policy_bundle_references`, `principal_policy_checkpoints`,
`principal_history_prefixes`, `principal_history_entries`,
`principal_history_nodes`, `principal_history_node_references`,
`principal_history_root_owners`, `principal_history_stage_scopes`,
`principal_key_envelope_archive`, `principal_history_stages`,
`principal_mutation_journal`, `principal_grant_retirements`.

- One small Explorer upload issues about 33 policy and history reads out of
  42 requests (`ExplorerUploadRequestVolume.test.tsx`). Trace every one to the
  verifier or resolver that demanded it. Which are re-reads of a head the same
  operation or session already verified, and what binding does the cache lack
  that forces the re-read (`docs/principal-history-acceptance.md`,
  "Ordinary workflow cost")?
- What is the minimal binding (organization, dependency set, lifetime) that
  would let a verified head be reused within an operation without weakening
  the lifetime and dependency checks the acceptance document protects?
- Could the writer projection cite the exact policy heads it depends on by
  hash, so a client fetches only heads it has not verified, instead of
  resolving them through the paged history every time?
- Is the private paged history (32 entries per page, preparation workers,
  503 backpressure, 15-second deadlines) needed on the ordinary write path,
  or only for cold recovery? Could ordinary verification be one request for
  "current head plus its chain back to my checkpoint"?
- Could `principal_policy_commits` and
  `principal_policy_mutation_acknowledgements` collapse into one receipt keyed
  by the signed event? Who reads each today?
- Of the fifteen local principal tables, which hold at most one row per
  principal and could be columns, and which duplicate `principal_policies`?
- Count the pages a typical organization policy read takes at the directory
  sizes the fixtures use, and at ten times that size.

## `document-write-path`

Tables: API `documents`, `document_updates`, `document_update_spans`,
`document_container_links`, `document_content_key_epochs`,
`document_content_key_targets`, `document_content_write_headers`,
`document_inline_rekey_commits`, `document_manifest_observations`, `blobs`,
`blob_stages`, `blob_content_key_epochs`, `blob_content_key_targets`,
`blob_content_write_headers`, `attachment_bindings`. SDK `documents`,
`document_pending_updates`, `document_sync_failures`,
`document_history_checkpoints`, `document_history_updates`,
`document_pending_attachments`, `document_attachment_blob_projection`,
`document_orphan_blob_reclaims`.

- One small file costs create, writer projection, stage, part upload,
  complete, bind, and three sync posts before policy reads. Trace each sync
  post (pre-attachment probe, post-bind follow-up, content) and each stage
  step. Which could be one request while keeping the signed write header,
  the staged SHA-256 check, and lost-response adoption?
- Could a single-part path skip stage and complete when the encrypted object
  fits one part, with the same digest and header checks at bind?
- The document writer projection response is hundreds of kilobytes per read
  in the sharing scenario (`docs/request-budget-closeout.md`). List its parts
  and which the client consumes on each call site; propose what a client that
  cites its checkpoints could omit.
- Who reads `document_manifest_observations`, `document_inline_rekey_commits`,
  and `document_update_spans`? Is each derivable from `document_updates` and
  the manifest chain, and what query needs it?
- Locally, `documents.loro_snapshot`, `document_pending_updates`, and
  `document_history_updates` hold overlapping bytes. Which reads need which,
  and could one update log with a settled watermark replace them?
- Is `document_sync_failures` state the scheduler needs, or a diagnostic that
  belongs in the incident ledger?
- Could the sync response carry the next writer projection a follow-up pass
  would otherwise fetch?

## `discovery-and-hints`

Tables: API `container_sync_tombstones`,
`container_document_sync_tombstones`, `organization_group_tombstones`,
`container_metadata_documents`. SDK `container_sync_watermarks`,
`container_sync_lane_checks`, `document_discovery_heads`,
`document_discovery_sequence`, `pending_document_discoveries`,
`container_hydration_tombstones`, `container_document_tombstone_holds`,
`dormant_container_metadata`, `dormant_metadata_sweep_requests`,
`document_container_projection`, `container_projection`, `containers`.

- A hint carries ids only, so each costs a listing, a projection, and a sync.
  Every artifact is signed and self-verifying: what could a hint carry (the
  signed event, the manifest head, update ids) so the client verifies and
  applies it without HTTP? Answer the constraints that retired A1 to A3 in
  the closeout: replay authorization, atomic durability, retention,
  acknowledgement, and ordered local application. Measure requests per hint
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
`access_manifest_principal_head_projection`,
`access_manifest_verifications`, `container_key_epochs`,
`container_key_wraps`, `container_builtin_grants`. SDK
`access_manifest_checkpoints`, `superseded_container_bindings`,
`principal_grant_retirements`.

- A writer projection carries full root-to-leaf path bundles, policy
  bundles, KEK state, and the keyring. Which parts does a client with
  checkpoints already hold verified, and could it cite them by hash so the
  response carries only what is new?
- For each `access_manifest_*_projection` table, name the route that reads
  it and the query it answers. Could an index on the canonical manifest serve
  it?
- `access_manifest_verifications` caches the server's own verification. What
  is its hit pattern, and does a stored-artifact verification on read remain
  necessary once commit-time verification is trusted?
- The sharing scenario recites four times at about 190 KB per request. What
  is recited and could the server derive it from stored manifests?
- A blob bind fetches a writer projection first; could bind cite heads and
  let the server resolve paths the way sync's `authorizingContainerPathRefs`
  does?
- Count statements per writer-projection read under the statement counter.

## `receipts-and-ledgers`

Tables: API `principal_policy_commits`,
`principal_policy_mutation_acknowledgements`,
`document_inline_rekey_commits`, `document_manifest_observations`,
`document_baselines`, `blob_audit_objects`,
`access_manifest_verifications`,
`organization_read_model_changes`. SDK `principal_mutation_journal`,
`organization_provisioning_attempts`, `container_create_intents`,
`container_move_intents`, `document_move_intents`,
`document_intent_link_targets`, `document_purge_checkpoints`,
`document_sync_failures`, `security_incidents`.

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

Tables: API `organization_read_model_changes`,
`organization_read_model_heads`, `organization_roster_entries`, `groups`,
`organization_group_tombstones`. SDK `organization_read_model_state`,
`organization_read_model_requesters`,
`organization_read_model_directory_users`,
`organization_read_model_groups`, `organization_read_model_policy_heads`,
`organization_read_model_group_memberships`,
`organization_read_model_group_members`,
`organization_read_model_container_grants`,
`organization_presentation_denials`, `organization_data_usage_snapshots`,
`organization_data_usage_categories`.

- The signed organization policy already carries the authoritative group
  directory and reserved heads. What does the read-model feed add beyond
  display names and flags, and could that come from the signed payload plus
  a profile document instead of a second change feed with its own cursor,
  retention, and heads table?
- Ten local tables hold a display projection. Which does a query need as a
  table, and which could be one JSON column?
- The read model refreshes five or six times in the sharing scenario and
  about five per group mutation. Which refreshes are same-session echoes?
- Is `organization_roster_entries` derivable from the `Members` policy?

## `bootstrap-and-session`

- Personal bootstrap measures 93 requests against 25 in the September
  closeout. Attribute the growth per endpoint and name the mechanism that
  added each class of request.
- Registration commits in one transaction. What does the client then fetch
  that the registration response could have returned (root projection,
  system container ids, initial policies, read model)?
- Login is challenge, verify, websocket ticket, and session reads. Could
  verify return the ticket, and could the ticket be a claim on the session?
- Interest declaration is sent on every reconnect while the server mirrors
  it durably. Which one is authoritative, and is the other needed?
- Contacts container and self contact are created device-first after login
  by design; count what that costs and whether registration could seed them.

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
