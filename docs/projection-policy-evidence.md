# Historical policy evidence in writer projections

Container and document writer projections require `policyEvidence`. This is
public verification material for every principal citation in the served manifest
and KEK histories, including groups that were revoked, deleted, or are accessible
only through a document's other linked container. It fixes audit #2365 finding #5:
a fresh device can verify historical signatures without access to the cited
group's current policy endpoint.

Document paths carry no nested proof: the API loads one evidence set per document
response, and the SDK reuses its verified result across those paths.

The API authorizes the container or document before loading this evidence. The
response carries the complete signed organization state chain, the directory
payloads that bind the supplied group heads, and public group snapshots with
their predecessor chains and
external Admins authority. For each required group it includes the chain through
the last head bound by the directory, so a reader's newer durable checkpoint can
connect to an older citation. Group payload ciphertexts and member key envelopes
are excluded. Group deletion still erases those secret-bearing artifacts.

The SDK verifies signatures and predecessor chains, hashes each directory payload
against its signed organization state, and binds each supplied group head to a
signed directory entry. The group's authenticated chain supplies older cited
states. External group authority must belong to that organization's Admins group.
Existing durable checkpoints reject conflicting chains. Missing required
bindings, duplicate payloads, foreign groups, and unsigned evidence are refused
before manifest authorization. Unrelated directory payload bodies are omitted.

Historical evidence does not become a current policy bundle or advance principal
checkpoints. Current key unwrapping still requires the full policies and member
envelopes for the current readable path. Current write authorization remains
subject to the server's existing policy and access checks. A verified policy
already held by an SDK mutation plan can cover its uncommitted successor citation;
this does not fetch or accept a missing old wire field.

Locally composed document links and container moves merge the supplied evidence;
ordinary remote projections provide it directly. The contract changes together
across validators, API, and SDK. There is no compatibility fallback or data
migration.

See the [NoBrickedDevice model](../formal/container-keying/NoBrickedDevice.md) for
history-only and deleted-authority delivery, bounded negative controls, and the
SDK implementation trace. API regressions exercise encrypted cold recovery after
group deletion and an active organization member reading a linked document
while direct access to its other container remains forbidden.

## Read authorization and deployment

A current container/document grant deliberately includes access to the public
verification closure of its signed history. That closure discloses membership
user ids, grant container ids, group public keys, signatures, and organization
directory ids across retained versions. Organization members can already read
full policy histories for live groups; this closure also serves the public
history of deleted groups. Management endpoints retain their own authorization
checks. Group names,
group payload ciphertexts, and member key envelopes are not part of this proof.

The product decision for #2365 is to retain this metadata contract and require
active organization roster membership for every group member. Group creation
and policy updates enforce that requirement transactionally. Removing a user
from Members is refused until signed removals from all other live groups and
direct container grants have committed. The app enrolls users in Members before
adding them to another group and removes ordinary-group memberships before
disabling the roster. No group mutation implicitly enrolls a user on the server.
Direct user grants independently require active same-organization membership
(`groupReferences.ts`); Members removal refuses outstanding direct grants
(`roster.ts`). They do not provide a non-roster access exception.

A group's chain extends through its last directory-bound head, rather than
stopping at the citation: a reader may already have checkpointed a later version
without retaining a full policy bundle. Serving only the cited prefix would
reintroduce the refusal this change fixes. Evidence is restricted to cited groups
and their Admins authority; it does not include all directory groups' snapshots.
Each supplied directory body is authenticated by its hash in the signed state
chain. Only the bodies needed to bind the supplied heads are sent. Those bodies
list every group ID and head at their respective versions.

Deploy the API contract before releasing the updated clients. All supported
clients are updated together. This is a greenfield rollout: preexisting off-roster
memberships are outside the deployment contract. No cleanup migration, backfill,
or compatibility reader is needed. The active-roster invariant applies to all
live groups, not just users changed by a particular Members write.
During the coordinated rollout, older clients cannot add off-roster users to
ordinary groups or disable users who remain in another group; the server rejects
those writes. There is no feature flag or compatibility path for that behavior.

## Cost and retained-history tradeoff

This contract retains complete signed organization and cited-group state chains.
The API reads directory history to find the last binding of each needed group,
but delivers only the distinct directory payloads containing those bindings.
A document shares one proof set across its paths, and locally composed proofs
merge distinct bindings rather than dropping an older deleted group's evidence.

Cold state-chain size and verification still grow with retained versions.
Incremental delivery for #2392 reduces repeat transfers without replacing history
or introducing a checkpoint authority.

After successful SDK verification, `ApiClient` retains an isolated copy of the
projection's historical evidence. Its next writer-projection GET can send an
`x-projection-history` header: a URI-encoded JSON array of exact prefixes, each
with a scope key, count, and SHA-256 digest of the complete retained entries.
Scope keys bind the requested object, organization, evidence location, and
principal or manifest chain. The server first performs its ordinary authorization
and stored-evidence checks, then omits only matching prefixes and identifies them
in the response's `historyPrefixes`. Unknown or changed bases receive full
history. The routes disable HTTP response caching.

The client accepts omissions only from the exact prefixes it requested and still
holds. It reconstructs the evidence before normal SDK verification. Current
heads and key material still travel; authorization, policy commitments, signer
resolution, predecessor links, directory binding, and durable rollback and
conflict checks still run. A server-supplied hash or verification marker never
becomes a client trust anchor. Malformed, unsolicited, or altered prefix claims
are rejected. Deleted-group citations retain their historical directory proofs.
Dependency paths and principal chains preserve their order; document manifest
history restores newest-first order for predecessor verification. Other manifest
history collections are indexed by signed hash; reconstruction may regroup those
unordered entries without changing their signed contents.

The session-scoped history cache keeps at most 16 projections and 16 million
serialized characters. Headers contain at most 32 hints and 4,096 encoded
characters; these bounds limit optimization, not accepted history. Eviction,
auth changes, and cold restart fall back to complete evidence and verification
from genesis, constrained by existing durable security checkpoints. In-flight
requests hold their requested prefixes; late verification cannot repopulate a
cleared auth scope. Custom request headers do not share this cache. Current-head
eviction retains immutable evidence so a policy change can use incremental
transport.

Principal-state and access-event signature results are separately memoized by
the exact signature, message bytes, and resolved public key. Only successful
signature mathematics is reused; no authorization result is inferred from that
cache. Its 8,192-entry budget evicts work, never refuses a chain. A larger chain
or working set can still require signature verification again. Full evidence
loading, hashing, reconstruction, and authorization checks remain proportional
to history; this change does not promise constant-time reads or bounded cold
responses. Future paged cold delivery and compact witnessed checkpoints are
separate protocol work.

The API/SDK regression measures a 32-successor projection at about 343 KB cold,
38 KB on a repeat fetch, and 47 KB after another successor, with equivalent
verified evidence on both database backends. Further regressions cover actual
container rotations, deleted groups, wrong prefixes, forged successors, auth
changes, and eviction. A signature-call probe verifies 64 entries once, reuses
all 64 on a repeat pass, and makes only 64 further calls when extended to 128.

The existing 16,384 principal-state version bound remains a separate refusal
tracked in [#2442](https://github.com/a2f0/tearleads/issues/2442). Incremental
transport does not remove that bound or resolve its revocation-availability
consequence. No new lifetime history cap is introduced here.

Both API and SDK memoize verified snapshots by a SHA-256 digest of the actual
source bytes, trusted signer keys, expected reference, and external authority.
The SDK holds at most 16 snapshots; the API uses a 32 MiB estimated retained-byte
budget so small snapshots from many organizations do not compete for 16 slots.
Both skip sources larger than four million serialized characters.
Independently decoded responses reuse signature work;
changed bytes or trust inputs cannot reuse previous verification. Verified
results are deeply frozen, preserving their runtime verification brand. Directory
binding and durable checkpoint checks still run for each SDK use. Projections
without principal citations carry empty proofs and disclose no directory.

The API separately memoizes parsed directory bindings by the immutable stored
organization head. A successor head misses that cache. It has a separate 32 MiB
estimated retained-byte budget, skips histories over four million serialized
characters, and returns
isolated copies to callers. This avoids repeating history reads and parsing for
each projection at a stable head. Large uncached histories remain valid.
Both API caches charge serialized retained values conservatively plus entry
overhead and evict least-recently-used entries. These budgets bound retention;
they do not bound cold verification work or eliminate misses for larger working
sets. A 24-organization regression counts actual signature-verifier calls and
directory-history reads: the second pass repeats neither (previously 48 and 24).

The API load regression seeds 64 additional signed groups (66 directory entries)
and measures 64 and 128 signed directory successors through real API reads and
cold SDK key recovery. It requires only one directory payload, only the cited
Admins snapshot, successful recovery, less than 2.1 times byte growth when history
doubles, and a 1.5 MB fixture budget. Wall-clock timings are diagnostic to avoid
machine-dependent CI failures. Full-directory delivery previously measured
2.17/4.32 MB at those sizes; the narrowed delivery measurements are recorded in
the test output.

Each selected directory payload discloses all group IDs and heads at that
version, although only cited groups and their Admins authority have snapshots
attached. The organization's signed state chain also discloses its public Admins
roster history. That public metadata is part of the historical-verification
contract for current object readers; encrypted group metadata and key envelopes
remain outside it.
