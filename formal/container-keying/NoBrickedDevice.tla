------------------------- MODULE NoBrickedDevice -------------------------
EXTENDS Naturals, FiniteSets

(***************************************************************************)
(* The no-bricked-device invariant (#2192 Gate F1): no device may ever be   *)
(* unable to read or write because another device holds a cache or must    *)
(* issue a write first.                                                     *)
(*                                                                         *)
(* One dependent object cites one authority. In the container instance the *)
(* authority is an ancestor container's manifest head and the dependent a  *)
(* descendant's; in the principal-policy instance the authority is the     *)
(* Admins policy head and the dependent a group policy. Every dependent    *)
(* head signs the authority head that was current when the honest API      *)
(* committed it. Devices hold independent checkpoints, sync at arbitrary   *)
(* times, and verify each served projection with the client refusal rules, *)
(* each of which is a parameter so a rule can be checked against the       *)
(* invariant before it is implemented.                                     *)
(*                                                                         *)
(* One distinguished member, the late signer, may be revoked at an         *)
(* authority head. A dependent head that member signed before the          *)
(* revocation, delivered to a device only after the authority advanced, is *)
(* the honest shape the withdrawn currency rules (#2174, #2173) refused.   *)
(* Under a dishonest server the same member can forge dependent heads      *)
(* citing any authority head; the lineage and authorization rules bound    *)
(* what such a forgery can achieve, and a split view a device cannot       *)
(* detect stays outside this model.                                        *)
(***************************************************************************)

CONSTANTS Devices,
          MaxAuthorityVersion,
          MaxDependentVersion,
          ServerHonest,                  \* only the honest projection is ever served
          RefuseRollback,                \* a head or authority below the device checkpoint
          RefuseFork,                    \* a dependent chain not extending the device checkpoint
          RefuseCitationRegression,      \* a citation below the one its predecessor established
          RefuseServedAuthorityRollback, \* a served authority head older than the cited one
          RefuseSignerRevokedAtCitation, \* a signer without membership at the cited head
          RefuseStaleHeadCitation,       \* withdrawn #2174 rule: a new head must cite the served authority
          RefuseStaleChainCitation       \* #2173 rule: every new chain entry must cite the served authority

ASSUME /\ Devices # {}
       /\ IsFiniteSet(Devices)
       /\ MaxAuthorityVersion \in Nat \ {0}
       /\ MaxDependentVersion \in Nat \ {0}
       /\ {ServerHonest, RefuseRollback, RefuseFork, RefuseCitationRegression,
           RefuseServedAuthorityRollback, RefuseSignerRevokedAtCitation,
           RefuseStaleHeadCitation, RefuseStaleChainCitation} \subseteq BOOLEAN

AuthorityVersions == 1..MaxAuthorityVersion
DependentVersions == 1..MaxDependentVersion
Outcomes == {"none", "accepted", "refused"}

VARIABLES authorityVersion,     \* honest current authority head
          revokedAt,            \* authority head that revoked the late signer; 0 while a member
          dependentVersion,     \* honest current dependent head
          cites,                \* dependent version -> authority version its event cites; 0 unwritten
          signedByLate,         \* dependent version -> signed by the late signer
          checkpoint,           \* device -> dependent version held; 0 with no history
          heldHonestPrefix,     \* device -> versions through which the held chain is the honest one
          heldCitation,         \* device -> citation of the held dependent head
          heldSignedByLate,     \* device -> held head signed by the late signer
          authorityCheckpoint,  \* device -> authority version held
          outcome,              \* device -> last verification outcome
          honestRefused         \* some device refused the honest projection

serverVars == << authorityVersion, revokedAt, dependentVersion, cites, signedByLate >>
deviceVars == << checkpoint, heldHonestPrefix, heldCitation, heldSignedByLate,
                 authorityCheckpoint, outcome >>
vars == << serverVars, deviceVars, honestRefused >>

Min(a, b) == IF a <= b THEN a ELSE b

TypeOK ==
  /\ authorityVersion \in AuthorityVersions
  /\ revokedAt \in 0..MaxAuthorityVersion
  /\ dependentVersion \in DependentVersions
  /\ cites \in [DependentVersions -> 0..MaxAuthorityVersion]
  /\ signedByLate \in [DependentVersions -> BOOLEAN]
  /\ checkpoint \in [Devices -> 0..MaxDependentVersion]
  /\ heldHonestPrefix \in [Devices -> 0..MaxDependentVersion]
  /\ heldCitation \in [Devices -> 0..MaxAuthorityVersion]
  /\ heldSignedByLate \in [Devices -> BOOLEAN]
  /\ authorityCheckpoint \in [Devices -> 0..MaxAuthorityVersion]
  /\ outcome \in [Devices -> Outcomes]
  /\ honestRefused \in BOOLEAN

(* The dependent exists at version 1 citing authority version 1. A device    *)
(* either holds that state or has no history yet.                            *)
Init ==
  /\ authorityVersion = 1
  /\ revokedAt = 0
  /\ dependentVersion = 1
  /\ cites = [v \in DependentVersions |-> IF v = 1 THEN 1 ELSE 0]
  /\ signedByLate = [v \in DependentVersions |-> FALSE]
  /\ checkpoint \in [Devices -> {0, 1}]
  /\ heldHonestPrefix = checkpoint
  /\ heldCitation = checkpoint
  /\ heldSignedByLate = [d \in Devices |-> FALSE]
  /\ authorityCheckpoint = checkpoint
  /\ outcome = [d \in Devices |-> "none"]
  /\ honestRefused = FALSE

(* Membership at an authority head: the late signer is a member below the  *)
(* head that revoked it.                                                    *)
MemberAt(late, version) == ~late \/ revokedAt = 0 \/ version < revokedAt

(* A share, rekey, or move at the ancestor; an Admins successor. *)
AdvanceAuthority ==
  /\ authorityVersion < MaxAuthorityVersion
  /\ authorityVersion' = authorityVersion + 1
  /\ UNCHANGED << revokedAt, dependentVersion, cites, signedByLate,
                  deviceVars, honestRefused >>

RevokeLateSigner ==
  /\ revokedAt = 0
  /\ authorityVersion < MaxAuthorityVersion
  /\ authorityVersion' = authorityVersion + 1
  /\ revokedAt' = authorityVersion + 1
  /\ UNCHANGED << dependentVersion, cites, signedByLate, deviceVars,
                  honestRefused >>

(* The honest API commits a dependent head only for a signer with          *)
(* membership at the current authority head, citing exactly that head.     *)
CommitDependent(late) ==
  /\ dependentVersion < MaxDependentVersion
  /\ MemberAt(late, authorityVersion)
  /\ dependentVersion' = dependentVersion + 1
  /\ cites' = [cites EXCEPT ![dependentVersion + 1] = authorityVersion]
  /\ signedByLate' = [signedByLate EXCEPT ![dependentVersion + 1] = late]
  /\ UNCHANGED << authorityVersion, revokedAt, deviceVars, honestRefused >>

(* A served projection: the dependent head, how far its chain agrees with  *)
(* the honest one, the authority head its event cites, its signer, and the *)
(* authority head served as current.                                        *)
Projections ==
  [head: DependentVersions,
   honestPrefix: 0..MaxDependentVersion,
   cited: AuthorityVersions,
   late: BOOLEAN,
   authority: AuthorityVersions]

(* Authority heads are admin-signed, so only genuine ones can be served. A *)
(* dependent head is either the honest one, whose signed citation and      *)
(* signer are fixed, or a forgery by the late signer that extends the      *)
(* honest chain through honestPrefix.                                       *)
WellFormed(p) ==
  /\ p.authority <= authorityVersion
  /\ p.honestPrefix <= Min(p.head, dependentVersion)
  /\ IF p.honestPrefix = p.head
       THEN p.cited = cites[p.head] /\ p.late = signedByLate[p.head]
       ELSE p.late

HonestProjection ==
  [head |-> dependentVersion,
   honestPrefix |-> dependentVersion,
   cited |-> cites[dependentVersion],
   late |-> signedByLate[dependentVersion],
   authority |-> authorityVersion]

Fresh(d) == checkpoint[d] = 0

(* Client refusal rules, each guarded by its parameter. *)
RollbackOk(d, p) ==
  \/ ~RefuseRollback
  \/ /\ p.head >= checkpoint[d]
     /\ p.authority >= authorityCheckpoint[d]

ForkOk(d, p) == ~RefuseFork \/ p.honestPrefix >= checkpoint[d]

CitationOk(d, p) ==
  \/ ~RefuseCitationRegression
  \/ IF p.honestPrefix = 0 THEN TRUE ELSE p.cited >= cites[p.honestPrefix]

ServedAuthorityOk(d, p) ==
  ~RefuseServedAuthorityRollback \/ p.authority >= p.cited

SignerOk(d, p) == ~RefuseSignerRevokedAtCitation \/ MemberAt(p.late, p.cited)

StaleHeadOk(d, p) ==
  \/ ~RefuseStaleHeadCitation
  \/ Fresh(d)
  \/ p.head <= checkpoint[d]
  \/ p.cited = p.authority

StaleChainOk(d, p) ==
  \/ ~RefuseStaleChainCitation
  \/ Fresh(d)
  \/ p.head <= checkpoint[d]
  \/ /\ p.cited = p.authority
     /\ \A v \in (checkpoint[d] + 1)..Min(p.head - 1, p.honestPrefix) :
          cites[v] = p.authority

Accepts(d, p) ==
  /\ RollbackOk(d, p)
  /\ ForkOk(d, p)
  /\ CitationOk(d, p)
  /\ ServedAuthorityOk(d, p)
  /\ SignerOk(d, p)
  /\ StaleHeadOk(d, p)
  /\ StaleChainOk(d, p)

(* A device holding a forged branch it could not detect is outside this    *)
(* model: its later verifications compare against a chain the model does  *)
(* not track.                                                               *)
HoldsHonestChain(d) == heldHonestPrefix[d] = checkpoint[d]

Verify(d, p) ==
  /\ HoldsHonestChain(d)
  /\ IF Accepts(d, p)
       THEN /\ checkpoint' = [checkpoint EXCEPT ![d] = p.head]
            /\ heldHonestPrefix' = [heldHonestPrefix EXCEPT ![d] = p.honestPrefix]
            /\ heldCitation' = [heldCitation EXCEPT ![d] = p.cited]
            /\ heldSignedByLate' = [heldSignedByLate EXCEPT ![d] = p.late]
            /\ authorityCheckpoint' =
                 [authorityCheckpoint EXCEPT ![d] = p.authority]
            /\ outcome' = [outcome EXCEPT ![d] = "accepted"]
       ELSE /\ outcome' = [outcome EXCEPT ![d] = "refused"]
            /\ UNCHANGED << checkpoint, heldHonestPrefix, heldCitation,
                            heldSignedByLate, authorityCheckpoint >>
  /\ UNCHANGED serverVars

HonestSync(d) ==
  /\ Verify(d, HonestProjection)
  /\ honestRefused' = (honestRefused \/ ~Accepts(d, HonestProjection))

DishonestSync(d) ==
  /\ ~ServerHonest
  /\ \E p \in Projections :
       /\ WellFormed(p)
       /\ p # HonestProjection
       /\ Verify(d, p)
  /\ UNCHANGED honestRefused

(* Syncing the authority's own projection. *)
SyncAuthority(d) ==
  /\ HoldsHonestChain(d)
  /\ authorityCheckpoint[d] < authorityVersion
  /\ authorityCheckpoint' = [authorityCheckpoint EXCEPT ![d] = authorityVersion]
  /\ UNCHANGED << serverVars, checkpoint, heldHonestPrefix, heldCitation,
                  heldSignedByLate, outcome, honestRefused >>

Next ==
  \/ AdvanceAuthority
  \/ RevokeLateSigner
  \/ \E late \in BOOLEAN : CommitDependent(late)
  \/ \E d \in Devices : HonestSync(d) \/ DishonestSync(d) \/ SyncAuthority(d)
  \/ UNCHANGED vars

(* Only the honest server's delivery is fair. Writes are not: the          *)
(* invariant must hold on behaviors where no other device ever writes.     *)
Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ \A d \in Devices : WF_vars(HonestSync(d))

CheckpointsAreMonotone ==
  [][\A d \in Devices :
       /\ checkpoint'[d] >= checkpoint[d]
       /\ authorityCheckpoint'[d] >= authorityCheckpoint[d]]_vars

HeldChainNeverContradictsCheckpoint ==
  [][\A d \in Devices : heldHonestPrefix'[d] >= heldHonestPrefix[d]]_vars

HeldCitationsNeverRegress ==
  [][\A d \in Devices : heldCitation'[d] >= heldCitation[d]]_vars

HeldAuthorityCoversHeldCitation ==
  \A d \in Devices : authorityCheckpoint[d] >= heldCitation[d]

HeldSignerWasMemberAtCitation ==
  \A d \in Devices :
    checkpoint[d] = 0 \/ MemberAt(heldSignedByLate[d], heldCitation[d])

HonestServerNeverRefused == ~honestRefused

(* The no-bricked-device invariant as liveness: with only the honest       *)
(* server's delivery fair, every device eventually holds the current heads. *)
DeviceEventuallyCurrent ==
  \A d \in Devices :
    <>[](/\ checkpoint[d] = dependentVersion
         /\ authorityCheckpoint[d] = authorityVersion)

=============================================================================
