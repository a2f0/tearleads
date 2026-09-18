# Device-first document links

Explorer creates document links through the SDK's `linkDocumentToContainer`.
The operation needs a local database and a synced document identity; it does not
wait for authentication, signing keys, a server write, or a refresh.

The SDK commits the document summary, link projection, and structural intent in
one transaction. It then publishes a placement change and schedules background
sync. A failed local commit publishes nothing. The preferred container and content
key epoch remain unchanged.

Additional link targets live in `document_intent_link_targets`, keyed by the
existing document move intent's revision. Sharing that revision gives additions
the same protections as moves: stale discovery cannot replace pending placement,
and an older response cannot settle a newer action. Multiple additions coalesce.
Ordinary moves retain them; a replace move supersedes prior additions.

Replay uses current, verified writer projections to submit signed link mutations.
It adds only explicitly queued targets, preserves unrelated remote links, and
does not rotate the content key for an additive operation. Network failures leave
the durable intent available for retry. Permission denials and vanished containers
use the existing structural queue's recovery policy. Successful settlement clears
the parent intent and its targets atomically with the verified document state.

Document deletion and scoped remote reset remove the associated targets. Container
deletion retargets them alongside the parent placement and changes its revision
so an in-flight response cannot overwrite that recovery.

Regression coverage includes local publication with an unresolved network request,
transaction rollback, stale discovery, signed replay, retries, overlapping moves,
multiple additions, container deletion, and Explorer's offline action.
