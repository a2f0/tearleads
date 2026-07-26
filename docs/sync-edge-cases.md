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
| 1 | Remote document deleted (coded `404 document_not_found`) while local edits are queued | Local document, pending updates, and failure rows are destroyed; one log line remains. No export or confirmation. | needs decision (destroy vs. quarantine the local edits) |
| 2 | Bare 404 (no error code) on submit | Deliberately not treated as deletion; parks as an error row. | working as designed |
| 3 | Container tombstoned (`deleted` / `access_revoked`) with queued content edits inside | Cascades to local descendants; documents are unlinked or orphaned but content and pending updates survive. The next pass then 403s (revoked) or triggers row 1 (deleted). | needs decision (end state depends on a race) |
| 4 | Container tombstoned with queued metadata edits (e.g. rename) | Queued metadata updates are deleted in the same transaction, with no failure row. | needs decision (defensible for deleted; questionable for access_revoked) |
| 5 | Move intent whose destination container is missing locally | `blocked` with a named reason; replays each structural pass and completes if the container appears (e.g. via hydration). | working as designed |
| 6 | Document deleted while it has a queued move intent | The move intents are deleted with the document. | working as designed |
| 7 | Move fails remotely (rejected, unavailable, or permission denied) | Stays `pending` with `"Remote document move was rejected or unavailable: <detail> (<status>)"`; the HTTP status is threaded through when one was seen. Retries on every trigger. | working as designed; parking 403s for the access-restored signal (like document writes) is a possible refinement |
| 8 | 403 on a write-bearing document sync | Local edit kept untouched; durable error row `"Write access denied by the server (403)"`; footer shows the failure. No retry until org access is restored or another trigger fires. | working as designed; no export/discard affordance yet (pairs with row 1) |
| 9 | 403 on a read-only pull | Suppressed on purpose — never flags unattempted local edits. | working as designed |
| 10 | 409 `document_sync_state_stale` | In-pass retry with a fresh projection, bounded. | working as designed |
| 11 | 409 `update_id_conflict` | In-pass re-key recovery, bounded at 5 attempts, then a synthetic terminal failure. | working as designed |
| 12 | Stale content-key bundle with pending edits and shallow local history | Heal, full-history rebuild from historical KEK epochs, re-heal (see PR #1816). | working as designed |
| 13 | Uncoded 409 on read-only revalidation (e.g. writer-projection route remaps container 404s and KEK failures to bare 409s) | Burns one request per trigger, emits only a trace line, records nothing durable; the document silently never revalidates. | defect — needs a durable surface and error codes on the projection route (deferred to its own PR) |
| 14 | Container-metadata sync hitting stale-keying errors | Classified, deferred with a log line, retried next trigger. | working as designed |
| 15 | Move replay: link succeeds, unlink fails | Document linked to both containers, `"partially applied; retry required"`, retried on the next trigger, excluded from lane progress so it cannot hot-loop. | working as designed |
| 16 | Move whose destination exists but has not synced yet | Stays `pending` with an error note; retried. | working as designed |
| 17 | Create in a container that has not reached the server | Deferred (with or without queued edits) until the structural pass lands the container, which re-primes the document store. No timer, no error row. | working as designed |
| 18 | Create raced with a lost response (`"Document manifest already exists"`) | Adopts the existing remote document instead of duplicating. | working as designed |
| 19 | Billing-gated organization (payment required) | Write-bearing submissions stop silently; queue shows `pending` with a "billing paused" note; lifted by the billing recovery signal. | working as designed |
| 20 | Re-key exhaustion (5 attempts) on a conflicted pending update | Synthetic terminal failure row; the pending row remains and will conflict on future submits. | working as designed |

## Known gaps / follow-ups

- Row 13: give read-only revalidation failures a durable surface, and add
  stable error codes to the document writer-projection route instead of bare
  409 remaps, so clients can classify them.
- Rows 1, 3, 4: decide the fate of local edits stranded by remote
  deletion/tombstones (destroy today; quarantine or export are candidates).
- Row 7: consider parking permission-denied moves for the
  org-access-restored signal instead of retrying on every trigger.
- Create intents (`container_create_intents`) have no `last_attempted_at`
  column, so a create stuck in error shows no attempt timestamp.
