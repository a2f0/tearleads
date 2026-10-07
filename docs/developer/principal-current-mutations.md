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
apply the existing atomic checkpoint and acknowledgement rules.

The SDK request builders can accept this verified current evidence and a lifetime
guard. They bind all current artifacts to the evidence, check the supplied local
checkpoint and signer authority, and refuse to return a signed request after
expiry. The full-bundle variant still performs complete bundle verification.
These checks authorize construction of a request; the API must independently
verify it and commit against its current policy heads.
