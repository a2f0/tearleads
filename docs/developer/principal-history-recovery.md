# Durable principal-history recovery

For a known signed principal head, `recoverPrincipalPolicyHistory` verifies
`ApiClient.getPrincipalPolicyPages` incrementally and stores accepted progress in
local SQLite. Provide `expectedHead`, `organizationId`, `execSql`, a trusted
identity resolver, and a `stillCurrent` guard covering the session and database
lifetime, including organization reset. Invalidate the guard before resetting so
an in-flight recovery cannot recreate provisional rows afterward.
`protection.localKey` must be a private 32-byte client-controlled key;
`protection.context` must identify the local identity, API trust domain, and trust
policy revision consistently across restarts. Never obtain either trust decision
from server-issued continuation data. Rotate the key or context when retiring
prior verification decisions.

The optional `retainedReferences` selection follows the crypto verifier's bounded
retention contract. Supply already authenticated external authority through
`loadExternalAuthority` when policy signatures cite another principal. The helper
checks signatures, authorization, continuity, exact-head completion, current
keying artifacts, and the latest local checkpoint. It returns a sparse
`VerifiedPrincipalPolicyCurrent`; it never represents omitted entries as a full
policy bundle or advances application checkpoints on the caller's behalf.
Organization-directory binding and atomic publication remain the caller's work.

The verifier automatically retains the signed local checkpoint entry, adding at
most one entry to the 128-reference budget plus the current entry. SDK atomic
checkpoint admission uses this sparse evidence to recheck the latest durable pin
inside its transaction. Every earlier head observed in the same batch must also
be retained. If the durable pin changes to a version missing from the selection,
admission fails with `stale_predecessor` and requires fresh evidence. Cancellation
prevents the batch from advancing any checkpoint. Full-bundle persistence still
requires complete history.

Older saved progress that omits the signed checkpoint entry is discarded and
replayed from genesis when that checkpoint is required during restoration.

An interrupted call leaves only provisional authenticated progress. A new call
with the same inputs resumes at the last accepted page. Corrupt progress, a
changed protection key, or changed verification inputs cause genesis replay.
If the transport rejects a saved pin's shape, that operation's saved progress is
discarded and the call fails; a subsequent call verifies from genesis.
Even a completed saved prefix must pass a pinned HTTP read before reuse. The
reader throws `PrincipalPolicyHistoryReadError` with the underlying structured
transport failure; a concurrent staged writer can raise
`principal_history_stage_changed`, requiring a fresh recovery call. The stable
`error.code` string is the supported way to recognize this retryable conflict.
Organization remote reset deletes its provisional history stages while retaining
existing trusted checkpoints. Existing full-bundle workflows remain separate consumers
until they adopt this recovery interface.

Saved stages are separate for each exact head, local trust context, and retained
reference selection. Operations for different heads or selections do not discard
each other's checked prefixes.
Recovery of a new head currently verifies from genesis; reuse across changing
heads and bounded reclamation of older completed stages remain part of #2448.
Organization reset removes all of its staged heads.
