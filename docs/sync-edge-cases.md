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
| The whole engine | Stops only on teardown (app close, identity switch). There is no global failure state. |

Retry is event-driven, not timed: a parked failure waits for a keystroke, a
remote WebSocket event, startup priming, reconnect, the write queue's
"Retry sync" action, the lanes panel's "Sync now", or (for permission
failures) the org-access-restored signal, which is gated on recorded failure
evidence. An app restart re-attempts everything retriable.

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
| 1 | Remote document deleted (coded `404 document_not_found`) while local edits are queued | Local document, pending updates, history, and failure rows are destroyed in one transaction; one log line remains. No export, confirmation, or preservation copy. | working as designed — deletion is a privacy operation: an authoritative remote delete removes the document and its unsynced edits on every client as each one next syncs and receives the coded 404. Quarantine, export, and confirm-before-destroy were considered and rejected: each retains (or re-uploads) content the user deliberately destroyed. Container cascades feed this path only for `deleted` tombstones (row 3); metadata edits are row 4's concern. |
| 2 | Bare 404 (no error code) on submit | Deliberately not treated as deletion; parks as an error row. | working as designed |
| 3 | Container tombstoned (`deleted` / `access_revoked`) with queued content edits inside | Cascades to local descendants under a serialized mutation (a promise mutex around two inner transactions, not one transaction — a mid-cascade crash cannot lose content because the document repair commits first, but it can strand container-metadata rows that re-delivered tombstones then skip; known gap below): link rows dropped, each document re-homed to a surviving link when it has one, else orphaned (`container_id` nulled, org attribution kept). Content, pending updates, history, and failure rows all survive. The tombstone reason is deliberately ignored; each document resolves on its next pass by the server's per-document answer, not the reason: 200 where the document survives and the caller retains access (multi-link re-home, either reason), 403 where it survives without access → row 8 parking, coded 404 where it is gone → row 1 destroy. A local-only descendant's create records a terminal failure row when its pass runs; last-link orphans (projection container nulled, no links) prime with a null container scope, so that pass always comes. | working as designed for the cascade and its lazy resolution — only the server's per-document answer can distinguish a document that died with its container from one that lives on elsewhere; eager destroy/park at cascade time would destroy documents other containers still hold. Last-link orphans are primed with a null container scope (subtree routing cannot reach them; the loaded-roots pass targets them directly, hidden kinds excluded), so their preserved edits reach the same per-document resolution instead of sitting unresolved. Dangling non-null projections — a container row merely missing locally — still belong to stale-root recovery, not orphan priming. |
| 4 | Container tombstoned with queued metadata edits (e.g. rename) | Split by tombstone reason. `deleted`: the metadata document, queued updates, and failure rows are destroyed in the cascade before any submit (edit bytes linger in orphaned metadata history rows — known gap below). `access_revoked`: the container's entire metadata document — record, queued updates, failure rows, history — is retained dormant and unsurfaced; it re-attaches by container id when access restoration rehydrates the container, and the queued edit then submits. Container create/move intents are destroyed for both reasons. | working as designed — a deleted container's metadata is moot (rows 1/6 logic); a revoked container still exists server-side, so its queued metadata edits park until access returns, mirroring row 8's treatment of content edits. Reason precedence when cascades overlap: a container's own tombstone wins, then deleted beats access_revoked. Accepted bound: a container deleted after the revocation never tombstones the revoked user (the server deliberately targets current path members only — tombstoning revoked users would leak post-revocation activity), so that dormant metadata persists indefinitely: small, local, unsurfaced (the write queue requires a live container row), and a candidate for a future local sweep (known gap below). |
| 5 | Move intent whose destination container is missing locally | `blocked` with a named reason; replays each structural pass and completes if the container appears (e.g. via hydration). | working as designed |
| 6 | Document deleted while it has a queued move intent | The move intents are deleted with the document. | working as designed |
| 7 | Move fails remotely (rejected, unavailable, or permission denied) | Stays `pending` with `"Remote document move was rejected or unavailable: <detail> (<status>)"`; the HTTP status is threaded through when one was seen. Retries on every trigger. | working as designed; parking 403s for the access-restored signal (like document writes) is a possible refinement |
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
| 21 | Queue that can never sync (e.g. a recovery loop that never converges) | Write queue "Discard local edits" (documents with a remote copy only): atomically converts the record to the discovered-share shell — queued updates, staged uploads (rows and bytes), durable history, and the failure row dropped in one transaction; identity, title, placement, and links kept — then re-pulls the server copy in-session. Refused for local-only, unlinked, or move-pending documents. In-flight writers (edits, attachment settles/resume, initialization recovery) validate a store generation inside the serialized mutation, so a racing write either lands before the teardown (and is wiped by it) or is skipped. | working as designed |

## Known gaps / follow-ups

- Orphaned documents (row 3) drop out of the explorer tree entirely (the
  container index excludes `container_id IS NULL`); their queued edits stay
  visible in the write queue, and priming now routes them with a null
  container scope so their sync passes resolve them. An orphaned-documents
  surface in the explorer remains an open UX question.
- The container cascade is not replayable: container rows are deleted before
  the metadata queue/failure/watermark cleanup, and a re-delivered tombstone
  skips containers no longer present locally, so a mid-cascade crash can
  strand container-metadata rows permanently. Content documents are safe
  (their repair commits first).
- Resolved: access restoration now prunes stale `access_revoked` container
  sync tombstones server-side (`pruneRegainedAccessTombstones`, wired into
  the principal-policy transition and `container.grant` flows), so restores
  that advance no container timestamp — group re-adds, policy changes —
  relist the container on the next lane pull. `deleted` tombstones are never
  pruned, and rows for containers the user did not regain survive for
  clients that have not yet synced the loss.
- Dormant retained metadata whose container is deleted after the revocation
  is never purged (no tombstone reaches the revoked user — deliberate, see
  row 4's accepted bound). A future local sweep (e.g. dormant rows still
  unmatched after an access-restored full resync) could reclaim it.
- The `deleted` cascade branch removes a tombstoned container's metadata
  `documents` row but not its history checkpoint/tail rows, leaving orphaned
  container-metadata history behind (the local-reconcile sibling helper does
  delete them). The `access_revoked` branch retains the whole metadata
  document deliberately. Local-only descendants of a revoked container are
  excluded from retention (nothing to re-attach: their create intents die in
  the cascade), and like the `deleted` branch their history rows also
  survive as residue.
- Row 7: consider parking permission-denied moves for the
  org-access-restored signal instead of retrying on every trigger.
- Create intents (`container_create_intents`) have no `last_attempted_at`
  column, so a create stuck in error shows no attempt timestamp.
- Latent race: a document store's in-flight persist can resurrect a document
  that another subsystem deleted concurrently (observed with the contacts
  duplicate-self cleanup racing a deferred write's persist). The persist path
  should refuse to re-create a row it expected to update. The document
  store's own teardown (row 21's discard) now closes this for its writers by
  validating a store generation inside each write's serialized mutation;
  cross-subsystem deletions (e.g. the contacts cleanup) remain exposed.
