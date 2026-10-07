# Principal policy commit outcomes

A client may lose an HTTP response after a standalone organization policy or a
compound group-and-organization policy request commits. Retrying the exact
request returns its original acknowledgement even after later policy versions
commit. A durable receipt is written in the same transaction as the policies and
binds the entire canonical request, authenticated requester, organization, and
compound group when applicable. Separate hash domains distinguish standalone and
compound requests. Existing mutation locks serialize concurrent exact retries.
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
embedded copy. Group deletion removes that group's compound receipts;
organization purge also removes standalone receipts. A null receipt group ID
identifies the standalone organization request domain.

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

## Durable compound policy requests

The `Tearleads` runtime saves the complete JSON request before submitting a
compound group/directory policy mutation. A separate signature by the local
actor authenticates the whole wire body, including ciphertext and envelopes
outside individual state signatures. Its domain binds the API identity trust
domain, organization, actor and signing fingerprint. The local SQLite executor
owns the journal; a captured database/session generation guards every write and
dispatch. It requires the same signing identity after restart and does not rely
on the ephemeral history-cache key.

One unresolved request owns each actor/organization lane. A concurrent author
cannot replace it. Cache resets retain authored work. The runtime resolves it
before reading the policies for another group change, creation, deletion or
group share. Recovery resends only the authenticated saved body and verifies the
exact receipt artifacts. It neither reruns the original application callback
nor invents a complete verified history from the receipt. Current checkpoints
are left to ordinary verified recovery, so an older receipt cannot roll them back.

Calls sharing an executor and scope serialize submission, recovery and explicit
abandonment. Recovery waits for an owned dispatch instead of sending it again.
This in-memory wait does not span separate executors or tabs; durable claims and
server transaction receipts still protect concurrent transport attempts.
Runtime recovery has a 15-second request deadline; expiration retains the journal.

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

Advanced hosts can call `submitJournaledPrincipalMutation` and
`recoverJournaledPrincipalMutation` with an explicit `PrincipalMutationJournalContext`.
Supply a stable trusted scope, the actor's signing key pair, durable `ExecSql`,
a lifetime guard, and a status-bearing API submission function. Resolve pending
work before preparing a new request and keep API-client failure classifications
intact. The helpers return ordinary receipts, not verified policy capabilities.
They cover compound group policy writes; standalone organization writes and
group creation/deletion requests still need their own authored-request recovery.

Real HTTP tests with SQLite and PostgreSQL withhold a committed response, advance
the policy from another client, and recover the first receipt without a duplicate
commit. A second case kills the submitting SDK process and starts a fresh one
with only its restored identity and SQLite file; removing the journal makes
recovery fail. That process test uses native SQLite to exercise disk durability.
The in-process test uses the production WASM SQLite engine; browser OPFS process
recovery is not established by these tests.
