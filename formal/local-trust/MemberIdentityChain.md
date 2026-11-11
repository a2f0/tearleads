# Members identity-chain admission

[`MemberIdentityChain.tla`](./MemberIdentityChain.tla) checks operation-local
identity authentication through signed Members history (#2847). The recipient
must be a current member, proved at the start of its current uninterrupted
membership. A signer can be authenticated through an earlier Members interval,
even after departing; authorization to sign that event remains a separate
historical policy check. Trust ultimately terminates at this device's self/link
pin. Observed pins alone, cycles, self-admission, and forward trust do not root
a proof.

This extends the boundary of [DurableIdentityBinding](./DurableIdentityBinding.md),
not its persistent provenance. New roster enrollment and direct identity
admission still require self/link verification. Successful chain admission
never upgrades a stored pin to a new provenance. It relies on the complete
signed bundle and continuing-member immutability checked by
[MemberIdentityCommitment](./MemberIdentityCommitment.md).

| Model action or predicate | Production seam |
| --- | --- |
| `Check` / `PinMatches` / `CheckPins` | `isRosterVouchedRecipient` requires a current projection member and `assertIdentityCommitment` checks the complete `identityBundleFingerprint`, not only the KEM key |
| `Input` / `Rooted` | `loadAdmissionPin` supplies the pinned bundle and `verified` flag; only self/link provenance is an independent root |
| `Scan` / `IntervalStart` / `CheckInterval` | `createRosterAdmissionHistory` and `membershipStart` locate the current recipient interval, or the latest historical signer interval at or before the event cutoff |
| `Follow` / `CheckHistoricalTime` | `isRosterVouchedRecipient` recurses with the admitting state's version minus one; `membershipStart` skips newer entries without using them as authority |
| `Follow` / `CheckAuthority` | `verifySuccessorPrincipalPolicyChainEntry` and `externalAuthorityIncludesAdminSigner` check signer authority at the signed event, before recovered history reaches admission |
| `CheckVisited` / `NoRepeatedSigner` / `CheckSelfAdmission` / `NoSelfVouch` | `isRosterVouchedRecipient` rejects a visited user and a membership-start event whose signer is the admitted user |
| `CheckDepth` / `CheckScan` / `WorkBounded` | `MAX_ADMISSION_DEPTH`, `MAX_HISTORY_PAGES`, and `MAX_PAGE_ENTRIES` bound one admission operation; the shared history reader caches entries across recursive links |
| `RequireSignerCurrent` / `HonestEvidenceAdmitted` | `membershipStart` allows a historical signer to have departed; `isRosterVouchedRecipient` also accepts an independently verified external Admin without Members membership |
| (boundary assumption) | `assertStateEnvelopes` retains signed envelope-root, exact-member-set, and state-binding checks; `memberKeyFingerprint` checks the admitted user's envelope key |
| (boundary assumption) | `requireVerified` is still the direct self/link admission boundary; `isRosterVouchedRecipient` returns an operation-local boolean, not a persistent provenance write |

Sources:
[admission](../../packages/client-sdk/src/workflows/organizations/memberships/rosterVouchedAdmission.ts),
[shared history reader](../../packages/client-sdk/src/workflows/organizations/memberships/rosterAdmissionHistory.ts),
[pin service](../../packages/client-sdk/src/data/trustedUserIdentity/service.ts),
[principal chain entry verification](../../packages/crypto/src/keying/principalPolicyChainEntry.ts),
and [external authority](../../packages/crypto/src/keying/principalPolicyExternalAuthority.ts).
The authority guard belongs to verified-history recovery, not a second ad hoc
check inside admission. The abstraction map's name check is not a refinement
proof of those call sites.

## Machine and oracle

The closed states are `check`, `scan`, `follow`, `accepted`, and `refused`.
`Check` reads a pin and either terminates at an independent signer root, refuses,
or begins a scan. `Scan` walks backwards, sharing a bounded cache across all
links. `Follow` checks the event's committed identity, signer key, authority,
and non-self edge before scheduling the strictly earlier signer proof.
Missing pins or evidence refuse. Conflicting pins also refuse in the model;
production distinguishes verification errors from absent evidence.

`Rooted` is a pure finite signed-graph oracle over the fixed input, independent
of the machine's cursor, accumulated proof state, or fault switches. It uses a
mathematical interval-start definition instead of replaying the scanner.
`AdmissionHasRootedIdentity` compares acceptance against this oracle.
`OracleMatchesExamples` separately pins the expected positive scenario family,
so accidentally emptying the oracle cannot make safety vacuous.
`HonestEvidenceAdmitted` requires eventual acceptance of every oracle-approved
input. `AllAttemptsTerminate` requires eventual acceptance or refusal for every
input. Both use weak fairness on local `Check`, `Scan`, and `Follow` work; they
assume evidence calls return and do not promise progress during an unavailable
network. Stuttering by itself is not useful progress.

## Registered bounds and scenarios

Both configurations explore the same **20 explicit scenarios**, four user IDs,
two symbolic identity hashes plus an absent-pin sentinel, and histories of at
most five entries. This is exhaustive over the scenario machines, **not over
all histories** at those sizes. The primary configuration permits two unpinned
proof nodes and four distinct fetched entries. The deeper configuration permits
four proof nodes with the same read budget. Each abstract page contains one
entry: the shared-cache budget represents production's bounded page reader,
not its literal 64-page / 32-entry / 64-identity limits. It is an admission-work
budget, never a principal history lifetime cap.

| Scenario family | Required outcome |
| --- | --- |
| Direct anchored signer; two-edge transitive chain | Accept |
| Signer departed after the event; signer already absent from Members but historically admitted and still authorized in Admins at the event | Accept |
| Independently verified external Admin without a Members entry | Accept |
| Three-edge chain | Refuse at depth two; accept in the deeper configuration |
| Five-entry membership-start search | Refuse at the shared four-entry budget |
| Removed recipient; removal/re-addition with no new rooted admission | Refuse |
| Forward-only signer proof; unanchored cycle; observed-only anchor | Refuse |
| Self-admission; repeated identity across separate intervals | Refuse |
| Conflicting target, intermediate or root pin; absent intermediate pin; missing history page | Refuse |
| Identity-rooted but unauthorized event signer | Refuse |

With the pinned toolchain, the primary configuration explores 328 generated /
164 distinct states at depth 13; the deeper one explores 356 / 178 at depth 18.
The depths are state-graph depths, not identity-recursion limits.

## Negative controls

The [registered controls](../../scripts/protocol/protocolMemberIdentityNegativeControls.ts)
remove one rule at a time. Pin comparison, historical authorization, interval
selection, and historical-time cutoff each must violate
`AdmissionHasRootedIdentity`. Disabling the visited set must violate
`NoRepeatedSigner` in the deeper configuration; the smaller depth bound would
otherwise hide that missing guard. Disabling the self check must violate
`NoSelfVouch`: this establishes that the self edge is traversed, **not** that
other intact checks would ultimately admit it. Removing either resource bound
must violate `WorkBounded`.

The two over-strict controls require the `HonestEvidenceAdmitted` temporal
violation: requiring current signer membership strands the departed/external
signer cases, and always refusing strands the positive family. These controls
are deliberate model faults, not production options.

## Composition boundary

[PrincipalHistoryPages](../container-keying/PrincipalHistoryPages.md) and
[PrincipalHistoryResume](../container-keying/PrincipalHistoryResume.md) separately
cover checked prefix publication and authenticated progress. This model assumes
a contiguous, signature-valid history with immutable continuing-member bundle
commitments and correctly resolved historical authority sets. The unavailable
page scenario checks refusal, but hash linkage, forks, rollback checkpoints,
projection parsing, envelope bytes, cryptographic signing-key/bundle consistency,
and untrusted pagination metadata are not expanded here. In particular the
symbolic identity hash is not a runtime cryptographic test.

[NoBrickedDevice](../container-keying/NoBrickedDevice.md) covers policy recovery
and authority liveness, not discovery of a missing identity anchor. Nothing
here removes the need for an independently obtained self/link root, requires
another device to remain online, persists chain provenance, or asks users to
re-share links for each chain edge. Trusted admins may transitively introduce
identities; that is an accepted trust boundary, not resistance to a malicious
trusted admin. Cold-start rollback and anchor exchange remain out of scope.
There is no implementation trace bridge for this model; production regressions
must exercise the concrete verifier independently.
