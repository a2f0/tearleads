# Sync engine edge cases and expected outcomes

A behavioral spec for the client sync engine: what each failure or edge case
does today, and whether that is the intended behavior. Rows marked
"needs decision" are open product questions, not settled design. Update this
table when behavior changes; it is the reference the System Monitor's write
queue and sync lanes are read against.

## The failure-isolation model

The engine is a single pump running lanes serially (one `structural` lane for
containers/moves/creates/metadata, one `document` lane per open document,
structural-first). Its blast-radius rules:

| Failure | Blast radius |
| --- | --- |
| A lane's run throws | Confined to that lane: error count and last error recorded, `requested` flag preserved, pump moves on. Other lanes are unaffected. |
| A lane throws and immediately re-arms itself | Throttled to one run per second. |
| A lane hangs | Abandoned by a 120s watchdog; the queue is freed and the verdict is corrected if the run settles late. |
| Database torn down mid-run | Recorded as a successful no-op; the lane re-runs when the database is ready. |
| A 403/404/409 on one document's submit | Not a lane failure at all: classified in-pass, recorded as a durable `document_sync_failures` row, surfaced as the write queue's `error` status. Other documents keep syncing. |
| Offline / signed out / no keypair | Each lane's run body returns early as a successful no-op; recovery is edge-triggered when the prerequisite returns. |
| A document's only readable material predates the current KEK epoch (no covering baseline) | Not a failure: the projection's sealed keyring recovers every retained historical container KEK in one open, the old update epochs decrypt through it, and the document rematerializes cold. A keyring that fails verification parks only reads needing those epochs (`DocumentHistoryUnavailableError`); current-epoch reads continue and the bridge log (`GET /containers/:id/kek-log`) is the rebuild path. |
| The whole engine | Stops only on teardown (app close, identity switch). There is no global failure state. |

Retry is event-driven, not timed: a parked failure waits for a keystroke, a
remote WebSocket event, startup priming, reconnect, the write queue's "Retry
sync" action, the lanes panel's "Sync now", or (for permission failures —
document writes and parked document moves alike) the org-access-restored signal,
which is gated on recorded failure evidence. An app restart re-attempts
everything retriable.

## Queue statuses

`pending` — will be attempted on the next relevant lane pass. May carry a
`lastError` note from the previous attempt (renders as `error` at the item
level).

`blocked` — the last attempt could not proceed for a named structural reason
(missing local document, missing destination container). Blocked intents
replay on every structural pass like pending ones; the status is a
diagnosis, not a verdict. A still-blocked intent re-records its reason
without counting as lane progress, so it cannot hot-loop the pump.

`error` (item-level rollup) — some operation has a recorded `lastError`.
`blocked` outranks `error` in the rollup.

## Edge cases

| # | Scenario | Behavior | Verdict |
| --- | --- | --- | --- |
| 1 | Remote document deleted (coded `404 document_not_found`) while local edits are queued | The client fetches `GET /documents/:documentId/purge` and verifies the signed purge event, exact root-to-leaf authorizing container path, redacted signed principal-policy snapshots, signer write access, identities, and purge-time document snapshot before atomically pinning the terminal proof and destroying the matching local document, pending updates, history, and failure rows. It authenticates the purge-time-bounded first response before reading local checkpoint identities; only then may it submit already-known container and document checkpoint hashes and verify minimal hash-linked manifest chains that omit post-purge event bodies, derived state, and newly referenced policy snapshots. A stale generation, changed local identity, failed cleanup, or interruption rolls back both the pin and deletion; a missing or invalid proof is a terminal keying-verification failure and leaves local state intact. | working as designed — the coded 404 is only a discovery signal, never deletion authority by itself. A valid terminal proof authorizes privacy-preserving removal on each device, including a retry after the purge POST committed but its response was lost. Bare or uncoded 404s remain non-destructive (row 2), and 403 keeps row 8/9 behavior. |
| 2 | Bare 404 (no error code) on submit | Deliberately not treated as deletion; parks as an error row. | working as designed |
| 3 | Container tombstoned (`deleted` / `access_revoked`) with queued content edits inside | Cascades to local descendants in ONE SQL transaction under the serialized mutation — a mid-cascade crash leaves the cascade fully unapplied, and the tombstone re-applies it when the lane refetches the page: link rows dropped, each document re-homed to a surviving link when it has one, else orphaned (`container_id` nulled, org attribution kept). Content, pending updates, history, and failure rows all survive. The tombstone reason is deliberately ignored; each document resolves on its next pass by the server's per-document answer, not the reason: 200 where the document survives and the caller retains access (multi-link re-home, either reason), 403 where it survives without access → row 8 parking, coded 404 where it is gone → row 1 destroy. A local-only descendant's create records a terminal failure row when its pass runs; last-link orphans (projection container nulled, no links) prime with a null container scope, so that pass always comes. | working as designed for the cascade and its lazy resolution — only the server's per-document answer can distinguish a document that died with its container from one that lives on elsewhere; eager destroy/park at cascade time would destroy documents other containers still hold. Last-link orphans are primed with a null container scope (subtree routing cannot reach them; the loaded-roots pass targets them directly, hidden kinds excluded), so their preserved edits reach the same per-document resolution instead of sitting unresolved. Dangling non-null projections — a container row merely missing locally — still belong to stale-root recovery, not orphan priming. |
| 4 | Container tombstoned with queued metadata edits (e.g. rename) | Split by tombstone reason. `deleted`: the metadata document — record, history checkpoint/tail rows, queued updates, and failure rows — is destroyed in the cascade before any submit. `access_revoked`: the container's entire metadata document — record, queued updates, failure rows, history — is retained dormant and unsurfaced; it re-attaches by container id when access restoration rehydrates the container, and the queued edit then submits. Container create/move intents are destroyed for both reasons. | working as designed — a deleted container's metadata is moot (rows 1/6 logic); a revoked container still exists server-side, so its queued metadata edits park until access returns, mirroring row 8's treatment of content edits. Reason precedence when cascades overlap: a container's own tombstone wins, then deleted beats access_revoked. A container deleted after revocation never tombstones the revoked user (revealing that would leak post-revocation activity). Instead, the client records the dormant scope's organization; a genuine denied→restored edge enqueues every organization represented by the user's dormant markers. After a full recursive crawl with every parent lane unwatermarked, it freshly probes each still-unmatched container. Only a writer-projection `404` proves deletion and authorizes that exact scope's purge, performed in bounded atomic batches. A `403` leaves the still-live scope dormant. Ambiguous failures use durable exponential backoff and stop after five attempts with metadata preserved; restored containers clear their marker as they re-attach. |
| 5 | Move intent whose destination container is missing locally | `blocked` with a named reason; replays each structural pass and completes if the container appears (e.g. via hydration). | working as designed |
| 6 | Document deleted while it has a queued move intent | The move intents are deleted with the document. | working as designed |
| 7 | Move fails remotely (rejected, unavailable, or permission denied) | Non-permission failures stay `pending` with `"Remote document move was rejected or unavailable: <detail> (<status>)"` and retry on every trigger. A permission denial (403) parks the intent as `denied`: excluded from routine structural replays, still visible in the write queue with its recorded error, flipped back to pending by the org-access-restored signal (which counts parked moves as re-arm evidence, resolving each intent's organization through its target container, projection attribution, then the document's current container), a manual "Retry sync" on that document, or once per app launch at the head of the move scan (a restart loses the in-memory access-restored edge, so a relaunch re-attempts them; parked intents also count as startup sync work so the pass is scheduled). A denial anywhere in a multi-leg move parks it — a 403 on one leg followed by a different failure on another still counts. | working as designed — permission failures wait for the restore signal like row 8's document writes; everything else keeps event-driven retry. |
| 8 | 403 on a write-bearing document sync | Local edit kept untouched; durable error row `"Write access denied by the server (403)"`; footer shows the failure. No retry until org access is restored or another trigger fires. | working as designed; row 21's discard covers the give-up path for remote-backed documents; a user-initiated export remains an open idea |
| 9 | 403 on a read-only pull | Suppressed on purpose — never flags unattempted local edits. | working as designed |
| 10 | 409 `document_sync_state_stale` | In-pass retry with a fresh projection, bounded. | working as designed |
| 11 | 409 `update_id_conflict` | In-pass re-key recovery, bounded at 5 durable attempts, then a synthetic terminal failure. The write queue's "Retry sync" resets the durable budget (a deliberate tap is the rate-limited signal that conditions changed). | working as designed |
| 12 | Stale content-key bundle with pending edits | Heal: rotate to a fresh content key anchored by a full-history rotation baseline exported from the durable local history (checkpoint + tail), which every document retains. | working as designed |
| 13 | Refused read-only revalidation (coded 409 from the writer-projection route, e.g. container unavailable or keying conflict) | The refusal records on the document's durable failure row ("Remote revalidation failed: …") and surfaces in the write-queue view; cleared by the next clean pass. Read-only 403s stay suppressed (row 9). The projection route's 409s all carry stable codes. | working as designed |
| 14 | Container-metadata sync hitting stale-keying errors | Classified, deferred with a log line, retried next trigger. | working as designed |
| 15 | Move replay: link succeeds, unlink fails | Document linked to both containers, `"partially applied; retry required"`, retried on the next trigger, excluded from lane progress so it cannot hot-loop. | working as designed |
| 16 | Move whose destination exists but has not synced yet | Stays `pending` with an error note; retried. | working as designed |
| 17 | Create in a container that has not reached the server | Deferred (with or without queued edits) until the structural pass lands the container, which re-primes the document store. No timer, no error row. | working as designed |
| 18 | Create raced with a lost response (`"Document manifest already exists"`) | Adopts the existing remote document instead of duplicating. | working as designed |
| 19 | Billing-gated organization (payment required) | Write-bearing submissions stop silently; queue shows `pending` with a "billing paused" note; lifted by the billing recovery signal. | working as designed |
| 20 | Re-key exhaustion (5 attempts) on a conflicted pending update | Synthetic terminal failure row; the pending row remains and conflicts on future submits until "Retry sync" resets the budget (row 11) or the edits are discarded (row 21). | working as designed |
| 21 | Queue that can never sync (e.g. a recovery loop that never converges) | Write queue "Discard local edits" (documents with a remote copy only): atomically converts the record to the discovered-share shell — queued updates, staged uploads (rows and bytes), durable history, and the failure row dropped in one transaction; identity, title, placement, and links kept — then re-pulls the server copy in-session. Refused for local-only, unlinked, or move-pending documents. In-flight writers (edits, attachment settles/resume, initialization recovery, the rotation preflight's terminal-failure handler) validate a store generation inside the serialized mutation, so a racing write either lands before the teardown (and is wiped by it) or is skipped. | working as designed |

## Known gaps / follow-ups

- Resolved: Explorer exposes last-link orphans (row 3, `container_id IS NULL`
  with no surviving link) in a read-only **Orphaned Documents** recovery
  collection scoped to the active organization. Users can open a preserved
  document and move it into a writable container; the collection itself cannot
  accept creates, uploads, or folder mutations. Queued edits remain visible in
  the write queue, and priming continues to route orphans with a null container
  scope so their sync passes resolve them. Orphans of an organization with no
  active scope (e.g. after the whole organization's access was revoked) stay
  preserved-but-dormant: without that organization's auth context no pass could
  resolve them. Attributed rows never cross organization scopes; legacy
  device-first rows with no organization attribution appear in the active
  scope, matching priming, and adopt that organization when created remotely.
  Recovery classification is projection-based: it includes every non-hidden
  `container_id IS NULL` row with no surviving links, whether detached by a
  cascade or created locally before receiving its first container.
- Resolved: access restoration now prunes stale `access_revoked` container
  sync tombstones server-side (`pruneRegainedAccessTombstones`, wired into
  the principal-policy transition and `container.grant` flows), so restores
  that advance no container timestamp — group re-adds, policy changes —
  relist the container on the next lane pull. `deleted` tombstones are never
  pruned, and rows for containers the user did not regain survive for
  clients that have not yet synced the loss. The client also records each
  removal's own reason and timestamp as a durable hydration fence: a permanent
  deletion rejects an equal-or-older fetched item, while an access-revoked
  fence permits the unchanged item to re-attach after access returns. An
  unrelated later tombstone in the same page cannot poison that comparison.
- Resolved: dormant retained metadata records organization attribution before
  the revocation cascade removes the container row. A genuine denied→restored
  access edge requests sweeps for every organization present in the user's
  dormant markers, followed by a fully unwatermarked recursive crawl. After
  successful completion, each unmatched candidate is freshly probed; only a
  writer-projection `404` authorizes its purge, in bounded atomic batches. A
  `403` keeps the live container dormant, ambiguous probes retry with durable
  exponential backoff and a five-attempt cap, and reattached containers clear
  their markers.
- Resurrect race (closed): a persist that expected to update re-checks the
  row's existence inside its claimed serialized mutation and refuses when
  another subsystem deleted the document while it was queued. The refusal
  repeats document teardown to remove side writes that queued after deletion,
  and detached startup maintenance sweeps aged crash residue without touching
  fresh in-progress writes or live documents; the attachment side tables are
  document-only. Canonical SQL deletion queues attachment bytes for durable
  reclamation across store, container-purge, and remote-delete paths; failed
  byte deletes stay queued for the next connection. Deletion also invalidates
  the store generation inside the mutation (row 21).
