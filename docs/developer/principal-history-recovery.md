# Durable principal-history recovery

For a known signed principal head, `recoverPrincipalPolicyHistory` verifies
`ApiClient.getPrincipalPolicyPages` incrementally and stores accepted progress in
local SQLite. Provide `expectedHead`, `organizationId`, `execSql`, a trusted
identity resolver, and a `stillCurrent` guard covering the session and database
lifetime. `protection.localKey` must be a private 32-byte client-controlled key;
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

An interrupted call leaves only provisional authenticated progress. A new call
with the same inputs resumes at the last accepted page. Corrupt progress, a
changed protection key, or changed verification inputs cause genesis replay.
Even a completed saved prefix must pass a pinned HTTP read before reuse. The
reader throws `PrincipalPolicyHistoryReadError` with the underlying structured
transport failure; a concurrent staged writer can raise
`principal_history_stage_changed`, requiring a fresh recovery call. The stable
`error.code` string is the supported way to recognize this retryable conflict.
Organization remote reset deletes its provisional history stages while retaining
existing
trusted checkpoints. Existing full-bundle workflows remain separate consumers
until they adopt this recovery interface.

Saved stages are separate for each exact head and local trust context. Concurrent
operations for different heads do not discard each other's checked prefixes.
Recovery of a new head currently verifies from genesis; reuse across changing
heads and bounded reclamation of older completed stages remain part of #2448.
Organization reset removes all of its staged heads.
