# Device-first hardening audit

This audit follows local reads and writes through the SDK, Explorer, Contacts,
system bootstrap, and the background reconciliation paths. Tests distinguish an
explicit offline state from an API request that remains pending while the device
still reports online.

## Findings and repairs

| Seam | Failure | Repair |
| --- | --- | --- |
| Local document projection | Persisted creations and edits did not update an already hydrated folder cache without remote reconciliation. | Subscribe to persisted documents and reload affected local views from SQLite. Reopening a folder also refreshes its local cache. |
| Local read completion | A first SQLite read could restore a document deleted while that read was pending; frequent autosaves could prevent first paint. | Discard reads superseded by deletion or reconciliation. Publish ordinary reads before a coalesced trailing refresh so autosaves cannot starve the view. |
| Database replacement | Swapping a ready SQLite adapter could retain summaries from the old database. | Reset summary caches and pending reads when the adapter or domain changes. |
| Projection notification | Link-only or access-only changes could update internal data without publishing a new snapshot. | Include links and all summary fields in change detection. |
| Self-contact bootstrap | A missing local self key could fall back to a remote lookup; duplicate cleanup could await a remote purge inside the contact write queue. | Keep self-key resolution local and run remote cleanup separately. Preserve duplicates until authorized purge succeeds; retry on reconnect, including reconnect during a pending attempt. Each retry reloads its summary and uses the current runtime. Edits to a retiring duplicate, including avatars, go to the retained self contact before the purge completes. |
| Container mutation queue | A stalled explicit online operation could block ordinary folder writes behind the same promise. | Serialize online work separately; keep never-synced folder deletion local, including promotion races. A newer local write in the affected subtree invalidates older remote settlement and schedules reconciliation. System-folder probes watch their slot instead of the whole root tree. |
| System bootstrap | Correcting an existing system-folder icon could wait behind a stalled online operation. | Route icon corrections through the local queue, just like initial system-folder creation. |
| Document rotation | Raw-history recovery occupied the local edit queue and could race ordinary remote sync. Waiting on active remote work could also block the coordinator's serial pump. | Admit one remote operation per live document lane and hold the local queue only for the checked installation. Busy sync defers until settlement; overlapping rotation fails promptly and wakes its queued move when the active work settles. Generation guards exclude replaced runtimes and database resets, even when the coordinator stays alive. Replacing an abandoned coordinator can start fresh remote work immediately. Edits persist during a stalled pull; a changed document rejects the stale installation and repeats the full proof within a bounded retry. |
| Queued move scope | Rotation preflight reopened the source scope after an optimistic move; opening the destination view invalidated its proof. | Open the preflight under the current local placement while preserving source-based remote link-set authorization. |
| Offline edit followed by Trash | A conflict could re-key an outgoing update after rotation verified its old queue identity, leaving the move pending. | Repeat the complete raw-history proof for the changed queue, with at most three attempts per invocation. Repeated conflicts retain durable work for a later retry. |

## Behavioral coverage

`DeviceFirstOfflineRequestVolume.test.tsx` registers online, caches a note,
disconnects, and gives each of these operations a **zero-request baseline**:

- Create a folder.
- Edit a cached note and navigate away and back.
- Move the cached note to Trash and read both affected folders.

After reconnect, the same test requires successful remote folder creation and
the queued document link and unlink, then verifies that the edited note remains
in Trash.

SDK tests additionally cover offline document creation, editing, relinking,
deletion, and restoration through a fresh runtime over the same SQLite database.
Projection race tests hold an old SQL result across deletion, replace a ready
database adapter, and require snapshots to publish while repeated autosaves
keep trailing reads pending in the same or another folder.

Stalled-request tests require system-folder icon correction to finish behind a held
online probe. Other tests hold a system-container probe, a duplicate-contact purge,
and a raw-history pull while ordinary local writes complete. Rotation conflict
coverage checks the retry bound, retained pending content after exhaustion, and
a later successful retry. Concurrent-edit tests prove autosaves stay local while
rotation retries a changed frontier. Duplicate-contact cleanup retries when
connectivity or authentication returns; a transient failure with no such
transition waits for the next reconnect. Tests also cover reconnect during
database reattachment and local cleanup retry after an acknowledged remote purge.
Concurrent field and avatar edits to a retiring duplicate persist on the retained
self contact while the purge is held, whether that purge succeeds or fails.
Existing signed-history, checkpoint-substitution, keying-isolation, and
mutation-generation tests remain part of verification.

Coordinator regressions hold rotation while unrelated lanes run, then require
deferred document sync to resume. A watchdog-abandoned sync cannot hold a later
structural rotation; that attempt retains pending edits and succeeds on retry
after the abandoned request settles. Database reattachment and adapter replacement
release remote-work ownership without waiting for an old request; its late
response cannot overwrite the replacement result.

Real-API tests run the public SDK against SQLite. A share committed remotely
then held during local persistence can race a rename of that same folder:
serialized, guarded metadata writes preserve the rename and the grant, and the
recipient eventually sees the new name. The caller still receives success for
the verified grant when its local installation is superseded; runtime replacement
and incomplete operations remain unsuccessful. A queued move overlapping a held
autosave response retries its structural preflight automatically after settlement,
completes link and unlink, and retains the edited text without another event,
reconnect, or manual refresh.

## Scope of the offline contract

Local reads use persisted content. A remote document or attachment that has never
been downloaded still requires connectivity to obtain its bytes. Loading the
application bundle and initializing the platform's local database are separate
from the SDK's network-free read contract.

Sharing, peer-key lookup/import, link/unlink of remotely synced documents,
organization provisioning, and permanent remote deletion remain explicit online
operations. Moving a document, including moving it to Trash, queues its remote
link-set work durably instead. The hardening preserves signed authorization,
history verification, key rotation, and commit-before-local-delete requirements.

Background reconciliation may issue requests when online. Its completion is not
a prerequisite for local first paint or ordinary local persistence. Local-storage
failure is still an operation failure; network independence does not imply that
a failed SQLite or blob write was saved.
