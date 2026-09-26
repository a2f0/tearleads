# Historical policy evidence in writer projections

Container and document writer projections require `policyEvidence`. This is
public verification material for every principal citation in the served manifest
and KEK histories, including groups that were revoked, deleted, or are accessible
only through a document's other linked container. It fixes audit #2365 finding #5:
a fresh device can verify historical signatures without access to the cited
group's current policy endpoint.

The API authorizes the container or document before loading this evidence. The
response carries the signed organization snapshot, its complete signed directory
payload history, and public group snapshots with their predecessor chains and
external Admins authority. For each required group it includes the chain through
the last head bound by the directory, so a reader's newer durable checkpoint can
connect to an older citation. Group payload ciphertexts and member key envelopes
are excluded. Group deletion still erases those secret-bearing artifacts.

The SDK verifies signatures and predecessor chains, hashes each directory payload
against its signed organization state, and binds each supplied group head to a
signed directory entry. The group's authenticated chain supplies older cited
states. External group authority must belong to that organization's Admins group.
Existing durable checkpoints reject conflicting chains. Missing, duplicate,
foreign, or unsigned evidence is refused before manifest authorization.

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
