# Authoring from current principal policies

The mutation primitives accept current artifacts with their verified policy
with no manufactured predecessors. Built-in member addition/removal and group
grant revocation use paged current-policy recovery when the host provides private
history custody. They retain the exact compound receipt before acknowledging
container plans. Hosts without that capability retain the full-bundle path;
their receipts may also include `previousStates`.

`verifyPrincipalPolicyCurrentSuccessor` verifies exactly one signed successor of
a `VerifiedPrincipalPolicyCurrent` issued by the local crypto verifier. It checks
scope, consecutive version and predecessor hash, signing identity, authorization,
key rotation, projection/grant commitments, payload and member envelopes. The
caller supplies trusted signing keys and already verified external authority.
A server-provided head or a serialized copy of a policy is insufficient: recover
and verify history locally before using this operation.

The verifier privately retains the last accepted external-authority citation,
even when later entries omit that citation and it is absent from the selected
history. A successor cannot cite an older Admins head by following an uncited
state. History reference selection preserves this private value. Public result
fields and inputs can be inspected, but modifying them cannot replace the
privately owned predecessor or its remembered authority. Inputs are owned before
asynchronous verification.

A successful result retains only its direct predecessor and successor. Repeated
calls do not accumulate complete history. This result does not advance durable
checkpoints, publish a resumable prefix, or prove arbitrary older citations.
Callers must retain or recover the evidence needed for those operations and
apply the existing atomic checkpoint and acknowledgement rules. In particular,
admit the acknowledged successor before another mutation. A checkpoint older
than the retained predecessor needs additional verified history; the two-entry
result alone cannot advance it.

The SDK request builders can accept this verified current evidence and a lifetime
guard. `verifyPrincipalPolicyCurrentMutation` binds the group's artifacts to the
crypto verifier's private snapshot and checks the next signer at the selected
external authority, including its remembered authority floor. Copied public
verification objects are refused. Builders own mutable inputs before yielding,
check the supplied local
checkpoint and signer authority, and refuse to return a signed request after
expiry. The full-bundle variant still performs complete bundle verification.
These checks authorize construction of a request; the API must independently
verify it and commit against its current policy heads.

The internal preparation and state-acknowledgement helpers also accept verified
current evidence. They verify a single group or organization successor with
trusted signer keys and the selected external authority, retaining the direct
predecessor and successor. An acknowledgement must match the exact authored
signed state, including its signature; a claimed matching hash is insufficient.
Mutable request and response inputs are copied before verification yields, and
an expired operation cannot return accepted evidence. A supplied durable pin
must be covered by this pair; an older pin requires additional verified history.

These preparation helpers do not advance checkpoints. The built-in mutation
context recovers pending journal work first, verifies the exact directory, strict
Admins and group heads, and admits their checkpoints together. A private lease
and generation guard enclose planning, dispatch and acknowledgement; escaped
reference-selection or retention callbacks expire when the operation returns.
Best-effort descendant recitations run only after exact durable acknowledgement
and follow the session lifetime, so releasing private-key custody does not cancel
that post-commit work. A session change still stops it.

`retainAcknowledgedPrincipalCurrents` provides the atomic retention primitive
for advanced hosts. Each `AcknowledgedPrincipalCurrentInput` supplies the exact
authored request and complete receipt, plus the same recovery scope, local key,
verification mode and authenticated authority loader used for its predecessor.
The predecessor must already have both a durable checkpoint and an authenticated
completed prefix. This function does not fetch policy history or send a mutation;
trusted signing identity or authority resolution may perform their own reads.

It restores the authenticated verifier, checks the complete receipt and signed
successor, then stores a single evidence entry and its index nodes. All supplied
policies' artifacts, progress and checkpoints are published in one guarded SQLite
transaction. The transaction rechecks the latest pins and compares the saved
prefix with the one restored before verification. A changed prefix or a missing,
newer or conflicting pin requires fresh recovery. Replaying a past receipt cannot
move current pins backwards. Sealed progress uses fresh encryption randomness,
so overlapping identical acknowledgements also have one winner; the loser must
recover the now-current head. Optional grant retirements must refer to an included
policy's signed current or predecessor grants; the exported
`AcknowledgedPrincipalCurrentRetirement` type describes those inputs. When a batch
contains groups, it must also contain their directory receipt, whose signed
descriptor binds each group's exact acknowledged head.

Completed exact-head stages retain earlier encrypted envelopes when the reusable
prefix advances. If only a completed prefix survives for the predecessor, its
authenticated artifacts are saved as a completed stage in the same transaction.
Key lookup selects those candidates by an indexed fingerprint;
they remain untrusted encrypted candidates, not authorization evidence. The
store keeps one completed stage per exact head and verification context. There is
no automatic pruning yet: retained artifacts grow with acknowledged heads until
remote-reset cleanup. Equal principal-key fingerprints do not establish that older
recipient envelopes are redundant. Reclamation remains tracked in #2448. The
current wire artifacts never contain manufactured `previousStates`.

`selectPrincipalPolicyCurrentPredecessorReferences` combines a privately verified
successor with selected citations from its exact private predecessor. Scope,
consecutive version and predecessor hash must match. It retains at most 128
requested citations plus the predecessor/successor pair, preserving successor
membership and its private authority cursor. Copies and mutated public artifacts
cannot supply evidence. Container rematerialization selects only each path's
citations, including carried descendant rekeys. Planning never admits a speculative
successor; served historical references still resolve to acknowledged policies.

`Organizations.addUserToGroup` and `removeUserFromGroup` return
`OrganizationGroupMutationReceipt`; the group result of `revokeGrant` uses the
same type. It includes exact current artifacts and container receipts, with no
`previousStates` on the paged path. Hosts without custody may include that extra
field; callers should use the common receipt contract. Standalone full-bundle
workflows retain their existing return
contracts. Group creation, deletion and group sharing still use those workflows;
this adoption does not yet eliminate every full-history mutation consumer.

Mutation builders clear their owned signing-key copies on success and failure;
member addition also clears its temporary encapsulation secret. Caller-owned
key buffers remain unchanged.

## Directory deletion

Built-in group deletion recovers the current directory and strict Admins
evidence,
checks the signing administrator, and signs the directory successor without
loading the deleted group's history. It refuses deletion of either reserved
group, checks the exact response target and artifacts, and retains the directory
successor under the original identity/database lease. Unresolved earlier
compound
policy work blocks discovery. Hosts without private custody keep the standalone
full-bundle deletion workflow. Creation/deletion requests are not yet covered by
the compound membership journal; lost acknowledgements still require
reconciliation.
