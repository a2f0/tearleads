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
Refreshing a session token expires outstanding leases while retaining that key
for the same database, signing identity and API trust domain.
Provider failures propagate instead of silently changing keys. Container and
document workflow adapters retain the same lease in a private weak registry;
their public runtime views do not expose custody callbacks.

Standalone hosts can pass `withPrincipalHistoryProtection` to the public document
or container workflow constructor, including the container store constructor.
The exported `PrincipalHistoryProtectionLease` callback must supply a private
32-byte key and trust context, keep them usable until its operation settles, then
clear its owned key bytes. Its `stillCurrent` predicate must remain false after
the owning database, identity, session authority or host lifetime changes.
Derived document runtimes inherit this custody through the private registry.
Custody callbacks must support nested leases: sharing may verify a projection
or enter a mutation context inside an existing read lease. Each lease owns its
key buffer and keeps its lifetime valid until its callback settles.
See [sharing custody](principal-current-sharing.md).
Omitting custody leaves compact projection recovery unavailable; hosts using
these constructors against compact projections must supply it.

The app derives a separate purpose from its existing protected SQLite keyring
root, binding the API and identity. It releases keyring sessions after derivation.
Deleting that local root retires recovery keys too; no signing secret is used.
Recovery only loads the existing session, so a missing root cannot silently
create a replacement. Derivation times out after 15 seconds, releases the queue,
and clears any key bytes returned after that timeout.

Built-in projection reference verification uses the runtime lease to recover
scoped paged evidence, including when a complete bundle is held locally. Offline
recovery requires authenticated private progress and its evidence; an unprotected
full bundle cannot bypass that requirement. Runtime recovery queues are
shared per database and organization, avoiding concurrent writes to directory or
Admins progress. Container and document authorization and mutation planning
accept the resulting current policy with selected historical citations. The
projection checkpoint batch also carries every verified directory/Admins
dependency. In-memory reuse preserves that organization binding and lifetime,
rechecks all dependency pins, and refreshes missing evidence when a durable pin
advances. Conflicting pins still fail. Runtime offline state selects local-only
recovery. Public projection evidence uses the separate paged path described
below. Explicit full-bundle utilities are outside built-in runtime recovery.

Org Manager labels and metadata roots also consume verified current policies.
See [current-policy consumers](current-principal-consumers.md) for exact-head
local reuse, lifetime and checkpoint rules, and request costs.
[Current-policy mutation primitives](principal-current-mutations.md) cover bounded
successor verification, orchestration and durable acknowledgement adoption.

The optional `retainedReferences` selection follows the crypto verifier's bounded
retention contract. Supply already authenticated external authority through
`loadExternalAuthority` when policy signatures cite another principal. This callback
receives exact authority reference heads, including the latest citation retained
in authenticated cached progress. It must resolve those heads through the client's
verified authority lineage. Reusing a stage or prefix rechecks that citation even
when later pages no longer cite external authority. The separate authority-bound
verification context retires hints made before this check existed. The helper
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
Online recovery requires a pinned HTTP read even for a completed prefix. The
reader throws `PrincipalPolicyHistoryReadError` with the underlying structured
transport failure; a concurrent staged writer can raise
`principal_history_stage_changed`, requiring a fresh recovery call. The stable
`error.code` string is the supported way to recognize this retryable conflict.
Organization remote reset deletes its stages, prefixes, signed entries, and index
nodes while retaining existing trusted checkpoints. Existing full-bundle
workflows remain separate consumers until they adopt this recovery interface.

Set `offline: true` explicitly to use only completed, locally authenticated
stages or prefixes. Completed prefixes retain their current artifacts, bound to
the protected progress; offline recovery rechecks those artifacts, selected
history proofs, and durable checkpoints. Scoped recovery restores the verified
directory, strict Admins and group evidence without HTTP. A new historical
citation can be selected from the saved index without redownloading the chain.
Missing keys, context, completed history or proofs fail with `missing_dependency`;
offline recovery never falls back to the network. This establishes local
consistency, not knowledge of newer server state. Cancellation still prevents
returning a policy, and callers must atomically admit the complete dependency set.
The prefix schema requires `current_json`. Consistent with the repository's
greenfield schema contract, obsolete local tables fail with an explicit reset
error; this implementation does not migrate or automatically erase a database.
The authenticated prefix format is v2.

Saved stages are separate for each exact head and local trust context. Different
citation selections reuse the same authenticated progress, then verify their own
reference proofs and current checkpoints before returning a policy.
One completed prefix is shared across target heads and reference selections in a
scope bound to organization, principal, and trust context. The private local key
authenticates each reusable hint.
A new head extends an authenticated earlier prefix; a newer cached prefix is
preserved when recovering an older target. Older completions cannot replace a
newer prefix.
Default online recovery still obtains a live pinned read for a completed
same-head prefix and verifies current artifacts. The exact-head read-model path
explicitly opts into local recovery. Neither path treats the cache as an
application trust pin.
An interrupted stage can resume for a different citation selection at the same
head. Concurrent writers compare saved progress and a loser retries; no caller
can publish over another accepted page. Normal browsing creates at most one
stage per exact head and trust context. Completed-prefix publication and current
acknowledgements retain two completed heads and reclaim older stages in bounded
transactions, preserving historical key envelopes. See
[cache retention](principal-history-cache.md) for indexing, atomicity, offline
behavior and bounded stage and proof cleanup. Saved roots retain their shared
proof nodes and signed entries.

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

Unreadable authenticated progress requires replay from signed evidence. Page and
proof counts do not bound an individual entry's size. Server preparation also
uses byte/time scheduling targets; see the
[HTTP acceptance evidence](../principal-history-acceptance.md) for measured
request, SQL and memory costs and their limits.

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

Directory recovery always selects verified genesis, so root-bound founder
pinning also works with paged organization evidence.
Callers of the lower-level `recoverPrincipalPolicyHistory` facade must retain
organization version 1 when using its result to establish founder binding.

The result contains the current policy plus verified `dependencies`. Submit all
of these policies together when atomically admitting checkpoints. Recovery itself
does not advance pins. If the requested reference or an Admins citation is
newer than the directory, the helper discovers the directory once more; a repeated
disagreement fails with `stale_predecessor`. Signature, scope, and current-artifact
failures propagate. The built-in projection reference resolver uses this facade.
The returned Admins dependency retains its head and local checkpoint; historical
authority citations are checked page by page without accumulating every citation
in the result. Each group page with external citations may perform another pinned
Admins read while reusing its authenticated prefix and local index.

Within one `collectReferencedPrincipalPolicies` call, runtime recovery reuses
the authenticated organization directory and identical Admins head/citation
selections across referenced groups. This cache belongs to that collection,
checks both the saved and current lifetime guards, and is discarded before the
next collection. A future citation clears it before the single directory
refresh. The next collection discovers the directory again. A normal offline
cache miss is reported as dependency unavailability, without recording a
security incident. The same applies to incomplete online reads, the exhausted
directory refresh, concurrent local checkpoint advancement, and an offline
prefix behind a local pin. A held citation to a group absent from the current
signed directory is also unavailable, including after group deletion. An
online server head behind that pin remains a rollback incident. Invalid signed
predecessors remain verification errors, distinct from local races.

Runtime verification requires private paged recovery. A paged 403/409, an
exhausted directory refresh, missing private custody, or failed strict Admins
verification cannot select a full-history read or a locally held full bundle.
The call remains unavailable or fails verification. This preserves bounded
verification batches and scoped authority checks. Public projection-history
grants separately cover
deleted and nonmember group citations through current object access, without
requiring current policy membership.

Paged current envelopes also supply encrypted key candidates to container
unwrapping; see [the key-candidate trust boundary](principal-key-envelope-candidates.md).

Online recovery may reuse completed authenticated local evidence after a network
failure, a server error, or the built-in read deadline. It keeps the same private
key, organization, requested citation, and lifetime guard, and rechecks durable
pins before admission. Authentication/authorization refusals, head conflicts,
and malformed or invalid signed evidence never trigger this fallback. A missing
local prefix remains a dependency-unavailable error. Offline reuse establishes
previously verified state; it does not claim server currentness during an outage.

Evidence row namespaces bind organization, principal, and verification/trust
context independently of the local protection key. Replacing an ephemeral or
host key cannot multiply copies of the same signed entries or index nodes.
The completed prefix and provisional progress still require authentication under
the current private key; an unreadable hint is discarded and signed history is
replayed from genesis. A new key cannot use those hints offline. Public evidence
rows are reused only through proofs against the newly authenticated root.
Two headless instances sharing a database with different ephemeral keys can
discard each other's unreadable hints, including during offline reads. They
remain unable to admit unverified history, but may require repeated online
genesis replay. Hosts that need shared or offline reuse must provide the same
private protection key and trust context to those instances.

The internal public-history recovery path stores no keying artifacts. It uses
its own protected scope, including organization, strict Admins mode and the
bound authority group. A completed prefix can prove an older source head through
its private inclusion index, or extend to a newer source without replaying prior
signatures. Each online read checks the returned public head artifacts against
that same root. Offline reads require the local protection key; an unreadable
offline hint is left intact for its owner. Completed public stages are removed
after prefix publication, and reference selections do not create separate stages.

Public progress also authenticates the greatest cited Admins head. Before reusing
an incomplete stage or completed group prefix, recovery proves that citation
belongs to the supplied verified Admins lineage. A valid Admins successor can
reuse the group prefix without replaying its signatures; a fork cannot. The v2
public verification context discards hints made before this binding existed.
If a newer cached group prefix cites Admins beyond an older supplied source,
online recovery rebuilds the requested group history once. Offline recovery is
unavailable unless the supplied authority covers the cached citation; a newer
retained Admins root alone cannot extend the authority of an older source.

This primitive returns verified public history, not a current policy or an
admitted application checkpoint. Its caller must bind the source heads and any
external authority to verified organization directory payloads, select needed
citations and genesis through inclusion proofs, and check durable local pins.
The public `recoverProjectionPolicyHistory` workflow performs these binding and
selection checks: organization and genesis first, signed directory payloads,
strict Admins histories, then dependent group histories. It selects citations
in batches of at most 128 proofs with a separate checkpoint proof. It replays
only the affected principal once when a selected disposable proof is lost.
A source behind a newer durable pin needs a verified prefix extending that pin;
otherwise recovery reports unavailable evidence and leaves the pin intact.

Container and document projection responses carry exact signed heads and scoped
history grants, plus only the directory payloads needed to bind those heads.
Public signed states travel separately in bounded pages. The projection GET
and page routes can return a rolled-back preparation continuation; the API client
retries validated progress with a fresh 15-second deadline for each response,
including its body. History hints cover manifest and directory payload arrays;
principal histories use the authenticated durable page cache instead.

The runtime warmer supplies private public-history recovery. Standalone hosts
provide its `resolveProjectionHistory` capability explicitly. Final projection
admission rechecks the recovered lease and historical authorization against the
latest durable pins in the same transaction as access checkpoint writes. A new
pin without a retained proof defers admission; a conflicting retained hash is an
integrity failure. Historical authorization never advances current-policy pins.

A public prefix memo may outlive a projection rejected by later object-authority
checks. When another online source has a different signed head, the SDK can
verify that requested chain from genesis once; it still checks durable pins and
object authority. Offline recovery cannot replace a conflicting prefix.

See [HTTP acceptance evidence](../principal-history-acceptance.md) for resource
budgets and the beyond-16,384 revocation and cold-decryption run, and
[commit outcomes](principal-policy-outcomes.md) for durable mutation recovery.
