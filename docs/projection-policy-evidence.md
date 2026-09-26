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
group deletion and a non-roster guest reading a linked document while direct
access to the other container and its group remains forbidden.

## Read authorization and deployment

A current container/document grant deliberately includes access to the public
verification closure of its signed history. That closure discloses membership
user ids, grant container ids, group public keys, signatures, and organization
directory ids across retained versions. Non-roster readers can therefore see
public historical policy metadata that the organization-manager history and full
policy endpoints do not serve them. Those endpoints also expose management data
or key envelopes and keep their existing authorization checks. Group names,
group payload ciphertexts, and member key envelopes are not part of this proof.

A group's chain extends through its last directory-bound head, rather than
stopping at the citation: a reader may already have checkpointed a later version
without retaining a full policy bundle. Serving only the cited prefix would
reintroduce the refusal this change fixes. Evidence is restricted to cited groups
and their Admins authority; it does not include all directory groups' snapshots.
Each supplied directory body is authenticated by its hash in the signed state
chain. Only the bodies needed to bind the supplied heads are sent. Those bodies
list every group ID and head at their respective versions.

Deploy the API contract before releasing the updated clients. All supported
clients are updated together; there is no compatibility reader or schema migration.

## Cost and retained-history tradeoff

This contract retains complete signed organization and cited-group state chains.
The API reads directory history to find the last binding of each needed group,
but delivers only the distinct directory payloads containing those bindings.
A document shares one proof set across its paths, and locally composed proofs
merge distinct bindings rather than dropping an older deleted group's evidence.

Cold state-chain size and verification still grow with retained versions; this
is not a constant-size proof. Truncating a chain would refuse valid old citations
or a newer local checkpoint, so this change imposes no read or commit history
cap. Compact signed chains require separate protocol work; finding #6 remains
open. This tradeoff is accepted for this fix and measured by the load regression.

The API memoizes verified snapshots by state hash and actual source bytes,
trusted signer keys, expected reference, and external authority. It holds at
most 16 snapshots and skips sources larger than four million serialized
characters. The SDK memoizes signatures for the lifetime of a supplied snapshot
object, with the same content/key checks and size cutoff. Changed bytes cannot
reuse previous verification. Directory binding and durable checkpoint checks
still run for each use. Projections without principal citations carry empty
proofs and disclose no directory.

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
