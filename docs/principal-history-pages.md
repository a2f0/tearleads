# Incremental principal-policy verification

`createPrincipalPolicyHistoryVerifier` in `@tearleads/crypto` verifies a signed
principal history from genesis in successive pages. It shares the existing
full-history verifier's commitment, identity, signer-authorization, transition,
and signature checks. The caller supplies the authenticated signer keys and any
already verified external authority for each page.

An append contains one to 128 entries. The verifier owns its inputs before
asynchronous work, stages all checks, and publishes progress only when the whole
page succeeds. A rejected page can be corrected and retried. Concurrent appends
and finishing during an append fail closed. Pages must be contiguous; duplicate,
skipped, wrong-principal, and forked successors are rejected.

Between pages it retains the latest checked entry, the most recent external
admin citation, the observed local-checkpoint hash, and explicitly requested
historical entries. A page conflicting with the local checkpoint is rejected
immediately. Uncited states preserve the prior external-admin citation,
so a later page cannot roll authority back. A successful `finish(expectedHead)`
requires the exact current head, including its key epoch and fingerprint, and
connection to the optional local checkpoint. Returned values are copies: editing
them cannot change the verifier's progress. The verifier may continue after a
successful finish, allowing callers to observe exact verified intermediate
heads.

`VerifiedPrincipalPolicyHistory` deliberately differs from a full policy
snapshot. Its `retainedEntries` contains the requested entries encountered so
far
plus the current entry, ordered by version; callers must not index it by version
or treat it as a complete history. At most 128 reference requests are accepted
per verifier; duplicate versions are rejected. The factory throws
`KeyingVerificationError` for invalid scope, checkpoints, or reference requests.
The returned verifier has result-returning `append` and `finish` methods. These
are batch/retention limits, not lifetime policy-version
limits. A caller processing more historical references can consume successive
verified prefixes in bounded batches.

The entry budget bounds history depth per append, not the size of one signed
projection or grant set. Transport code must bound serialized bytes, dependency
work, and concurrency. External authority must already be authenticated by the
caller; supplying a projection from an untrusted page does not establish that
its signer is an admin. This API does not verify encrypted payloads or member
key
envelopes, and its result cannot stand in for a verified full keying bundle.

Progress currently belongs to this in-memory verifier. It accepts no serialized
progress or server-issued checkpoint as proof of an omitted prefix. Losing it
requires walking signed pages from genesis again, while an independently trusted
local checkpoint still detects rollback or an inconsistent history.

This is the crypto component of #2448. The existing API and SDK still use their
full-history transport. Bounded HTTP delivery, authenticated durable progress,
server-side preparation outside the mutation transaction, and short atomic
commit/acknowledgement are separate integration work. This component alone does
not fix the deployment's per-request proxy timeout or close #2442/#2448.

The crypto regressions exercise page failure, input ownership, signatures,
predecessors, authorization, key rotation, grant commitments, external
authority,
and checkpoints. The [page
model](../formal/container-keying/PrincipalHistoryPages.md)
checks atomic progress publication and authority retention with negative
controls. The default availability test crosses two full pages and retains only
the current entry. Run `bun run --cwd packages/crypto test:principal-history`
for the same streaming check through version 16,385. This crypto-only check does
not replace the API's full revocation/recovery scenario.
