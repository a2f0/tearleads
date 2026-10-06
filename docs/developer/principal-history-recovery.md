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

`ClientOptions.principalHistoryKeyProvider` supplies an owned 32-byte key for a
`PrincipalHistoryKeyScope` (signing fingerprint and API identity trust domain).
The SDK clears each returned key after use, and never exposes its private lease
through `runtime.input()`. Leases check database, identity, session and disposal
lifetimes before and after asynchronous work. Without a provider, a private
ephemeral key permits same-runtime reuse; a restart safely requires replay.
Provider failures propagate instead of silently changing keys.

The app derives a separate purpose from its existing protected SQLite keyring
root, binding the API and identity. It releases keyring sessions after derivation.
Deleting that local root retires recovery keys too; no signing secret is used.
No SDK workflow uses this private lease yet. Existing callers still consume
full bundles until they explicitly adopt paged recovery.

The optional `retainedReferences` selection follows the crypto verifier's bounded
retention contract. Supply already authenticated external authority through
`loadExternalAuthority` when policy signatures cite another principal. The helper
checks signatures, authorization, continuity, exact-head completion, current
keying artifacts, and the latest local checkpoint. It returns a sparse
`VerifiedPrincipalPolicyCurrent`; it never represents omitted entries as a full
policy bundle or advances application checkpoints on the caller's behalf.
Organization-directory binding and atomic publication remain the caller's work.

Recovery selects the signed local checkpoint entry through the verified index,
adding at most one entry to the 128-reference budget plus the current entry.
SDK atomic checkpoint admission can use this sparse evidence to recheck the
latest durable pin inside its transaction; callers must submit recovered
policies. Every earlier head observed in the same batch must also be retained.
If the durable pin changes to a version missing from the selection, admission
fails with `stale_predecessor` and requires fresh evidence. Cancellation
prevents the batch from advancing any checkpoint. Full-bundle persistence
still requires complete history.

An interrupted call leaves only provisional authenticated progress. A new call
with the same inputs resumes at the last accepted page. Each accepted page saves
its signed entries, index nodes, and authenticated progress in one transaction.
Corrupt progress or a changed protection key or trust context causes replay.
If the transport rejects a saved pin's shape, that operation's saved progress is
discarded and the call fails; a subsequent call starts from a valid completed
prefix or genesis.
Even a completed saved prefix must pass a pinned HTTP read before reuse. The
reader throws `PrincipalPolicyHistoryReadError` with the underlying structured
transport failure; a concurrent staged writer can raise
`principal_history_stage_changed`, requiring a fresh recovery call. The stable
`error.code` string is the supported way to recognize this retryable conflict.
Organization remote reset deletes its stages, prefixes, signed entries, and index
nodes while retaining existing trusted checkpoints. Existing full-bundle
workflows remain separate consumers until they adopt this recovery interface.

Saved stages are separate for each exact head, local trust context, and retained
reference selection. Operations for different heads or selections do not discard
each other's checked prefixes.
One completed prefix is shared across target heads and reference selections in a
scope bound to organization, principal, local protection key, and trust context.
A new head extends an authenticated earlier prefix; a newer cached prefix is
preserved when recovering an older target. Older completions cannot replace a
newer prefix.
A completed same-head prefix still needs a live pinned read and current-artifact
verification. This cache never supplies an application trust pin.
Interrupted stages intentionally remain separate by reference selection; a
changed selection can reuse a completed prefix, but not another selection's
unfinished stage.

Reusable progress has no embedded checkpoint or reference selection. At finish,
recovery obtains each requested entry and the latest local checkpoint through
inclusion proofs against the private root of the locally restored verifier. Entry
keys include signature bytes, so a different signature cannot replace the entry
belonging to an accepted root. Each lookup reads at most one node per tree level
and one entry row. Missing or corrupt proof material, or a disconnected cached
prefix, permits one fresh genesis replay per recovery call. Persistent damage
fails after that replay; durable checkpoint conflicts still fail closed.
Proof loss can trigger that single replay even when this call began at genesis,
so persistent damage can require two full downloads before failure. Checkpoint
conflicts are checked after the pinned history completes; rejected histories may
already have written provisional pages, but cannot publish a prefix or advance
an application checkpoint.

Older progress with checkpoint/reference input bindings is disposable and may
require replay. Stage/index storage reclamation and total byte/work scheduling
remain part of #2448. Page and proof-count bounds do not bound entry size or
total cache growth. Organization reset removes all of its recovery material.

`historyVerification: "direct-admins"` checks every accepted historical projection
for a nonempty set containing only direct admin users. It only accepts groups
without an external-authority fallback. Its separate protected context prevents
ordinary verified group progress from bypassing these stronger checks.

`recoverScopedPrincipalPolicyHistory` accepts an exact `reference` and the same
local protection, SQL, identity resolver, and lifetime inputs. It discovers and
verifies the organization directory through pages, then recovers the exact group
head bound by that signed directory. An older requested citation is selected from
that verified head. Group recovery also verifies strict Admins history and obtains
each page's cited authority states through the local index. General group caches
cannot establish this organization binding; scoped progress binds the Admins ID.

The result contains the current policy plus verified `dependencies`. Submit all
of these policies together when atomically admitting checkpoints. Recovery itself
does not advance pins. If the requested reference or an Admins citation is
newer than the directory, the helper discovers the directory once more; a repeated
disagreement fails with `stale_predecessor`. Signature, scope, and current-artifact
failures propagate. Built-in runtime callers still need to adopt this facade.
The returned Admins dependency retains its head and local checkpoint; historical
authority citations are checked page by page without accumulating every citation
in the result. Each group page with external citations may perform another pinned
Admins read while reusing its authenticated prefix and local index.
