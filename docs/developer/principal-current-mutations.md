# Authoring from current principal policies

The mutation primitives accept current artifacts with their verified policy
rather than reconstructing a full bundle with omitted predecessors. Built-in
membership orchestration and acknowledgement persistence still need to adopt
these primitives; their existing full-bundle path remains in use in this slice.

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

These helpers neither store artifacts nor advance checkpoints. Full receipt
artifact checks, atomic persistence of both policies with grant retirements, and
publication of authenticated resumable progress remain requirements for runtime
adoption. The built-in mutation workflow continues to use its full-bundle path
until those requirements are met.

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
move current pins backwards. Optional grant retirements must refer to an included
policy's signed current or predecessor grants.

Completed exact-head stages retain earlier encrypted envelopes when the reusable
prefix advances. Key lookup selects those candidates by an indexed fingerprint;
they remain untrusted encrypted candidates, not authorization evidence. The
current wire artifacts never contain manufactured `previousStates`. Built-in
mutation orchestration still uses its existing full-bundle path until its
context loading, container rematerialization and result contract adopt these
primitives together.
