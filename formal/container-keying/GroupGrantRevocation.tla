------------------------ MODULE GroupGrantRevocation ------------------------
EXTENDS FiniteSets, Naturals

(***************************************************************************)
(* A container grant to a group seals the container KEK to the group key.  *)
(* Revoking the grant rotates the container to a KEK the group no longer   *)
(* receives, but the wraps already sealed to the group key are retained,   *)
(* so anyone holding that group key can still open the container history.  *)
(* An additive member change does not rotate the group key: the joiner     *)
(* receives the current one. A revocation must therefore rotate the group  *)
(* key, or a member added afterwards opens what the group just lost        *)
(* (#2365 finding 20).                                                     *)
(*                                                                         *)
(* Every group policy change commits in one transaction with a container   *)
(* mutation for each container the group is granted: a rekey sealing it   *)
(* to the new group key when the key rotates, a reference refresh when it  *)
(* does not, and a revoke for a grant the change removes. The API refuses  *)
(* a batch missing one, so a joiner, who receives only the current group   *)
(* key, can open every container the group still holds.                    *)
(*                                                                         *)
(* One admin device plans each change from the container heads it read.   *)
(* Other devices may share those containers directly in the meantime; the  *)
(* API refuses a batch entry citing a head that has since advanced, and    *)
(* the device replans from fresh heads once before reporting failure       *)
(* (#2662). Within a batch, an entry for a child cites the parent head the *)
(* parent's own entry leaves, since the API applies entries in order       *)
(* (#2652). A failed change is retried by the person who asked for it.     *)
(***************************************************************************)

CONSTANTS Members, Root, Child, MaxGroupEpoch, MaxRaces,
          RotateGroupOnGrantRemoval, RequireEveryRematerialization,
          RefuseStaleHead, ReplanOnStale, CiteAuthoredParentHead

ASSUME /\ Members # {}
       /\ IsFiniteSet(Members)
       /\ Root # Child
       /\ MaxGroupEpoch \in Nat \ {0, 1}
       /\ MaxRaces \in Nat
       /\ RotateGroupOnGrantRemoval \in BOOLEAN
       /\ RequireEveryRematerialization \in BOOLEAN
       /\ RefuseStaleHead \in BOOLEAN
       /\ ReplanOnStale \in BOOLEAN
       /\ CiteAuthoredParentHead \in BOOLEAN

GroupEpochs == 1..MaxGroupEpoch

(* Two containers, the child directly under the root, both grantable to    *)
(* the group; a deeper chain adds no new citation order.                   *)
Containers == {Root, Child}
NoParent == "none"
Parent == [c \in Containers |-> IF c = Child THEN Root ELSE NoParent]

NoChange == [kind |-> "none"]

Changes ==
  [kind : {"add", "remove"}, member : Members]
    \cup [kind : {"grant", "revoke"}, container : Containers]
    \cup {NoChange}

VARIABLES groupEpoch,   \* current group key epoch
          groupMembers, \* current members of the group
          grants,       \* containers the group holds a grant on
          sealed,       \* group key epochs each container's retained wraps are sealed to
          lateHandouts, \* group key epochs handed to a joiner while a container is revoked
          change,       \* the admin's requested group policy change
          phase,        \* "idle", "planned" (batch signed), or "failed"
          replanned,    \* the current attempt already answered one stale refusal
          dirty,        \* containers whose head advanced after the batch was planned
          races,        \* concurrent direct shares so far (bounded)
          attemptRaces, \* concurrent direct shares that hit the current attempt
          lostShare     \* a direct share some batch entry overwrote

vars == << groupEpoch, groupMembers, grants, sealed, lateHandouts, change,
           phase, replanned, dirty, races, attemptRaces, lostShare >>

TypeOK ==
  /\ groupEpoch \in GroupEpochs
  /\ groupMembers \in SUBSET Members
  /\ grants \in SUBSET Containers
  /\ sealed \in [Containers -> SUBSET GroupEpochs]
  /\ lateHandouts \in [Containers -> SUBSET GroupEpochs]
  /\ change \in Changes
  /\ phase \in {"idle", "planned", "failed"}
  /\ replanned \in BOOLEAN
  /\ dirty \in SUBSET Containers
  /\ races \in 0..MaxRaces
  /\ attemptRaces \in 0..MaxRaces
  /\ lostShare \in BOOLEAN

Init ==
  /\ groupEpoch = 1
  /\ groupMembers \in SUBSET Members
  /\ grants = {}
  /\ sealed = [c \in Containers |-> {}]
  /\ lateHandouts = [c \in Containers |-> {}]
  /\ change = NoChange
  /\ phase = "idle"
  /\ replanned = FALSE
  /\ dirty = {}
  /\ races = 0
  /\ attemptRaces = 0
  /\ lostShare = FALSE

(* Whether a change advances the group key epoch.                          *)
Rotates(ch) ==
  \/ ch.kind = "remove"
  \/ ch.kind = "revoke" /\ RotateGroupOnGrantRemoval

(* The containers a change's batch must mutate: every current grant, plus  *)
(* a container it newly grants (`listRequiredContainerRematerializations`).*)
Batch(ch) ==
  IF ch.kind = "grant" THEN grants \cup {ch.container} ELSE grants

(* The person asks for one change at a time; a rotation needs a spare      *)
(* epoch within the bound.                                                 *)
Applicable(ch) ==
  /\ ch # NoChange
  /\ ch.kind = "add" => ch.member \notin groupMembers
  /\ ch.kind = "remove" => ch.member \in groupMembers
  /\ ch.kind = "grant" => ch.container \notin grants
  /\ ch.kind = "revoke" => ch.container \in grants
  /\ Rotates(ch) => groupEpoch < MaxGroupEpoch

(* The admin device reads the current heads and signs the batch.           *)
Request(ch) ==
  /\ phase = "idle"
  /\ Applicable(ch)
  /\ change' = ch
  /\ phase' = "planned"
  /\ replanned' = FALSE
  /\ dirty' = {}
  /\ attemptRaces' = 0
  /\ UNCHANGED << groupEpoch, groupMembers, grants, sealed, lateHandouts,
                  races, lostShare >>

(* Another device shares a container directly while the batch is in        *)
(* flight, advancing a head that a batch entry cites as its own or as its  *)
(* parent. Shares that touch nothing the batch cites change nothing here.  *)
DirectShare(c) ==
  /\ phase = "planned"
  /\ races < MaxRaces
  /\ \E b \in Batch(change) : c = b \/ c = Parent[b]
  /\ dirty' = dirty \cup {c}
  /\ races' = races + 1
  /\ attemptRaces' = attemptRaces + 1
  /\ UNCHANGED << groupEpoch, groupMembers, grants, sealed, lateHandouts,
                  change, phase, replanned, lostShare >>

(* An entry cites a stale head when its own container or its parent moved  *)
(* after planning, or when it cites the parent head from before the batch  *)
(* although an earlier entry of the same batch advances that parent.       *)
StaleEntry(b) ==
  \/ b \in dirty
  \/ Parent[b] \in dirty
  \/ ~CiteAuthoredParentHead /\ Parent[b] \in Batch(change)

Refused == RefuseStaleHead /\ \E b \in Batch(change) : StaleEntry(b)

(* The committed change: the group policy successor and its container      *)
(* mutations apply atomically.                                             *)
Apply(ch, nextEpoch, nextGrants) ==
  /\ groupEpoch' = nextEpoch
  /\ grants' = nextGrants
  /\ groupMembers' =
       CASE ch.kind = "add" -> groupMembers \cup {ch.member}
         [] ch.kind = "remove" -> groupMembers \ {ch.member}
         [] OTHER -> groupMembers
  /\ sealed' = [c \in Containers |->
                  IF c \in nextGrants
                    THEN sealed[c] \cup {nextEpoch}
                    ELSE sealed[c]]
  /\ lateHandouts' = [c \in Containers |->
                        CASE ch.kind = "add" /\ c \notin grants ->
                               lateHandouts[c] \cup {groupEpoch}
                          [] ch.kind = "grant" /\ c = ch.container -> {}
                          [] ch.kind = "revoke" /\ c = ch.container -> {}
                          [] OTHER -> lateHandouts[c]]

NextGrants(ch) ==
  CASE ch.kind = "grant" -> grants \cup {ch.container}
    [] ch.kind = "revoke" -> grants \ {ch.container}
    [] OTHER -> grants

NextEpoch(ch) == IF Rotates(ch) THEN groupEpoch + 1 ELSE groupEpoch

(* Submit the signed batch. A server that does not refuse a stale entry    *)
(* applies it over a direct share that landed after planning.              *)
Submit ==
  /\ phase = "planned"
  /\ IF Refused
       THEN /\ IF ReplanOnStale /\ ~replanned
                 THEN /\ replanned' = TRUE
                      /\ dirty' = {}
                      /\ UNCHANGED phase
                 ELSE /\ phase' = "failed"
                      /\ UNCHANGED << replanned, dirty >>
            /\ UNCHANGED << groupEpoch, groupMembers, grants, sealed,
                            lateHandouts, change, races, attemptRaces,
                            lostShare >>
       ELSE /\ Apply(change, NextEpoch(change), NextGrants(change))
            /\ lostShare' = (lostShare \/ Batch(change) \cap dirty # {})
            /\ change' = NoChange
            /\ phase' = "idle"
            /\ replanned' = FALSE
            /\ dirty' = {}
            /\ attemptRaces' = 0
            /\ UNCHANGED races

(* The person retries a failed change from fresh heads.                    *)
Retry ==
  /\ phase = "failed"
  /\ phase' = "planned"
  /\ replanned' = FALSE
  /\ dirty' = {}
  /\ attemptRaces' = 0
  /\ UNCHANGED << groupEpoch, groupMembers, grants, sealed, lateHandouts,
                  change, races, lostShare >>

(* A buggy or dishonest admin client rotates the group key with a batch    *)
(* that leaves out some granted containers. The fixed API refuses it.      *)
IncompleteRotation(omitted) ==
  /\ phase = "idle"
  /\ ~RequireEveryRematerialization
  /\ groupEpoch < MaxGroupEpoch
  /\ omitted # {}
  /\ omitted \subseteq grants
  /\ groupEpoch' = groupEpoch + 1
  /\ sealed' = [c \in Containers |->
                  IF c \in grants \ omitted
                    THEN sealed[c] \cup {groupEpoch + 1}
                    ELSE sealed[c]]
  /\ UNCHANGED << groupMembers, grants, lateHandouts, change, phase,
                  replanned, dirty, races, attemptRaces, lostShare >>

(* The bounded epoch range ends every behavior; stuttering is not a stuck *)
(* protocol.                                                               *)
Idle == UNCHANGED vars

Next ==
  \/ \E ch \in Changes : Request(ch)
  \/ \E c \in Containers : DirectShare(c)
  \/ Submit
  \/ Retry
  \/ \E omitted \in SUBSET Containers : IncompleteRotation(omitted)
  \/ Idle

(* The admin device submits and replans on its own; the person retries a   *)
(* failed change. Direct shares and new requests are not fair.             *)
Spec == Init /\ [][Next]_vars /\ WF_vars(Submit) /\ WF_vars(Retry)

(* While a grant stands revoked, no group key handed to a joiner opens a   *)
(* container wrap the group retained from before.                          *)
RevokedGrantUnreadableByLaterMembers ==
  \A c \in Containers :
    c \notin grants => lateHandouts[c] \cap sealed[c] = {}

(* A joiner receives only the current group key, so every container the    *)
(* group still holds must be sealed to it.                                 *)
LiveGrantsOpenToCurrentGroupKey ==
  \A c \in grants : groupEpoch \in sealed[c]

(* No batch entry replaces a container head another device advanced.       *)
DirectSharesSurvive == ~lostShare

(* A change fails only after two concurrent shares each staled one of its  *)
(* two attempts; one race, or none, never leaves it unapplied.             *)
FailureNeedsRepeatedRaces == phase = "failed" => attemptRaces >= 2

(* With concurrent shares bounded, every requested change commits without  *)
(* another device acting.                                                  *)
RequestedChangeCommits == phase # "idle" ~> phase = "idle"

=============================================================================
