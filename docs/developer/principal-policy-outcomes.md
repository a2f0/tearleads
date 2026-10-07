# Principal policy commit outcomes

A client may lose an HTTP response after a standalone organization policy, a
compound group-and-organization policy request, or group creation/deletion
commits. Retrying the exact request returns its original acknowledgement even
after later policy versions commit. A durable receipt is written in the same
transaction as the policies and
binds the entire canonical request, authenticated requester, organization, and
target group when applicable. Separate hash domains distinguish standalone,
compound, creation and deletion requests. Existing mutation locks serialize
concurrent exact retries.
A replay does not change current heads or publish another access or sharing
notification.

These receipts report historical outcomes; they do not establish current
authority or authorize a newly constructed request. The authenticated requester
must still be a current organization administrator to read a receipt; a revoked
requester receives 403, not a claim that the commit rolled back. Reading an
existing acknowledgement does not require current sync entitlement or rerun
roster billing checks: it reports a past commit without authorizing another.
Invalid stored
receipts fail closed. Compound container results still require their original
acknowledgement rows, so purging an organization cannot leave a response in an
embedded copy. Group deletion removes that group's compound and creation
receipts. Deletion receipts keep a null database group ID so removing the group
cannot delete the acknowledgement; the hash still binds its exact target.
Organization purge removes these receipts together with standalone receipts.
A null database group ID therefore does not identify the operation domain.

The schema change regenerates both greenfield baselines and requires fresh
databases under the repository reset policy; there is no historical upgrade.
Clients must preserve the authored request while its outcome is unknown.
The SDK's compound policy journal does this for group policy mutations; these
receipts and the journal do not complete #2442 or #2448.

Receipts survive until their group or organization is deleted. Expiring them on
a time limit would make an old unknown outcome indistinguishable from a failed
commit. Each receipt stores only one or two exact public state references. Replay
loads the immutable state and its public artifacts and reconstructs retired member
envelopes from the authenticated, hash-matched original request. The receipt keeps
no payload, envelope, projection, grant or container-result copy. Rotation can
therefore remove superseded envelope rows without losing the original
acknowledgement. Reference substitution or missing immutable state fails closed.
Reconstructed signature bytes, ciphertext, projection and grants must match the
receipt-authenticated original request; the state hash alone cannot authenticate
signature bytes. Altered retired artifacts cannot return a successful receipt.
Storage still grows by a fixed-size record per accepted commit.

## Group creation and deletion transport

Creation and deletion use the bounded history transaction runner. A validated 202
or coded 503 with `committed:false` is emitted only after rollback, including any
new group, deletion, directory successor, read-model change and receipt. The API
client retries only validated preparation continuations with the original request
bytes and identity. Its `createOrganizationGroupResult` and
`deleteOrganizationGroupResult` methods preserve unknown outcomes and accept
cancellation options; the existing nullable methods delegate to those results.

Creation receipts reconstruct the original group summary and directory outcome,
even after later policies advance. Deletion receipts reconstruct the original
directory outcome after the group is gone. Neither creates another read-model
change on replay. Both require current administrator access under mutation locks.
The runtime journals these operations in the same durable organization lane as
compound and standalone organization policy requests.

## Durable principal requests

The `Tearleads` runtime saves the complete JSON request before submitting a
compound policy, standalone organization policy, group creation or group deletion
mutation. A separate signature by the local
actor authenticates the whole wire body, including ciphertext and envelopes
outside individual state signatures. Its domain binds the API identity trust
domain, organization, actor and signing fingerprint. The local SQLite executor
owns the journal; a captured database/session generation guards every write and
dispatch. It requires the same signing identity after restart and does not rely
on the ephemeral history-cache key.

One unresolved request owns each actor/organization lane. A concurrent author
cannot replace it. Cache resets retain authored work. The runtime resolves it
before reading the policies for another group change, creation, deletion or
group share. Read-only policy verification never triggers recovery or submits
saved work. Recovery resends only the authenticated saved body and verifies the
exact receipt artifacts. It neither reruns the original application callback
nor invents a complete verified history from the receipt. Current checkpoints
are left to ordinary verified recovery, so an older receipt cannot roll them back.

Calls sharing an executor and scope serialize submission, recovery and explicit
abandonment. Recovery waits for an owned dispatch instead of sending it again.
This in-memory wait does not span separate executors or tabs; durable claims and
server transaction receipts still protect concurrent transport attempts.
Runtime recovery has a 15-second request deadline; expiration retains the journal.
Read-only inspection can observe an in-flight request without waiting for its
acknowledgement. Retry, abandonment and discard still wait for an owned dispatch.

A known first-attempt refusal or cancellation before dispatch retires the
journal. A disconnected request, an
invalid acknowledgement or an expired lifetime leaves it pending. Once an
outcome is uncertain, a later refusal, including 403, 409 or the coded rollback
503, cannot prove the first attempt rolled back and does not clear its record.
Corrupt authored work is retained and rejected before network submission.
A lifetime change also preserves a definitive refusal whose old scope can no
longer clear the record; a fresh scope must recover it or explicitly abandon it.

Hosts can inspect authenticated work with `readJournaledPrincipalMutation`.
After an explicit user or host decision, `abandonJournaledPrincipalMutation`
requires that exact inspected request and `acknowledgeUnknownOutcome: true`. It
stops local retries without asserting rollback or undoing a remote change.
Automatic recovery never abandons work. Changed requests, corrupt records and
expired lifetimes cannot use this helper to erase the saved operation. The next
mutation still reads and verifies current policies before authoring. Hosts should
handle `PendingPrincipalMutationError` and `PrincipalMutationOutcomeUnknownError`
from both runtime policy API variants, including the nullable convenience method.

Org Manager inspects pending work through the organization facade. It offers a
retry of the saved change and an explicit stop-retrying confirmation that explains
that a remote change is not undone. Success refreshes the current organization
view. A changed identity or organization invalidates delayed reads and actions.
Runtime policy writes require an authenticated signing identity, a trusted API
origin and ready local storage; missing journal custody refuses before HTTP.
Inspection without that scope reports no inspectable work. Hosts using a relative
API base without a browser origin must supply an absolute trusted API URL.
Malformed or stalled preparation responses also retain the request conservatively;
an invalid or incomplete 202 exchange is not a validated terminal rollback receipt.
Unlisted failures, including HTTP 429, conservatively retain the request as
uncertain; an intermediary's status alone does not prove server rollback.

Unreadable records remain blocked from submission. Inspection reports an
`UnreadablePrincipalMutationError` with an opaque identifier of the exact local
bytes and distinguishes authentication failure from an authenticated unsupported
format. `discardUnreadableJournaledPrincipalMutation` and the organization facade's
`discardUnreadablePolicyMutation` require that identifier and explicit
unknown-outcome acknowledgement. They discard only the unchanged, still-unreadable
record and do not submit it or change policy pins. Org Manager exposes the same
confirmation for this case. No previous schema is interpreted or migrated.

Journal scope includes the API origin and signing fingerprint. A different origin
or rotated identity does not inherit or replay the former scope's records; those
rows remain until the former scope is restored or the database is explicitly reset.
Auth-token renewal within the same signed identity and organization preserves
journal custody. A definite initial authentication refusal can therefore retire
its request after renewal; a later operation must not replay that refused change.
Identity, organization, authentication-state or database changes still expire
custody, even if the original scope is restored before the response arrives.
History verification retains its separate, stricter token lifetime. A fresh
runtime can recover uncertain signed bytes in the same identity scope.

Advanced hosts can call `submitJournaledPrincipalMutation` and
`recoverJournaledPrincipalMutation` with an explicit `PrincipalMutationJournalContext`.
Supply a stable trusted scope, the actor's signing key pair, durable `ExecSql`,
a lifetime guard, and a status-bearing API submission function. Resolve pending
work before preparing a new request and keep API-client failure classifications
intact. The helpers return ordinary receipts, not verified policy capabilities.
If a submission adapter throws, the saved request remains unresolved and the
helper throws `PrincipalMutationOutcomeUnknownError` with the original error as
its cause. A thrown exception cannot establish that dispatch did not commit.
Built-in interactive dispatch and recovery each have a 15-second deadline,
combined with any caller cancellation signal. Expiry preserves uncertain work
and releases the local lane so saved-change inspection and actions can proceed.
All four operation kinds share the same lane. Existing signed compound rows
remain recoverable under their original scope, without re-signing or hiding
unknown work. New rows bind an explicit operation kind; standalone organization
rows have no group target. Recovery dispatches only that authenticated route and
checks the matching receipt before removing the journal row. Group creation also
checks the exact authored genesis against the returned summary; deletion checks
both organization and deleted group IDs.

Real HTTP tests with SQLite and PostgreSQL withhold a committed response, advance
the policy from another client, and recover the first receipt without a duplicate
commit. A second case kills the submitting SDK process and starts a fresh one
with only its restored identity and SQLite file; removing the journal makes
recovery fail. That process test uses native SQLite to exercise disk durability.
The in-process test uses the production WASM SQLite engine; browser OPFS process
recovery is not established by these tests.
