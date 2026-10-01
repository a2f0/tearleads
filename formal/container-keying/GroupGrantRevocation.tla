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
(* RotateGroupOnGrantRemoval = TRUE is the fixed server, which refuses a   *)
(* group policy that removes a grant without advancing its key epoch.      *)
(* FALSE is the server before the fix, and TLC finds the                   *)
(* RevokedGrantUnreadableByLaterMembers violation.                         *)
(***************************************************************************)

CONSTANTS Members, MaxGroupEpoch, RotateGroupOnGrantRemoval

ASSUME /\ Members # {}
       /\ IsFiniteSet(Members)
       /\ MaxGroupEpoch \in Nat \ {0, 1}
       /\ RotateGroupOnGrantRemoval \in BOOLEAN

GroupEpochs == 1..MaxGroupEpoch

VARIABLES groupEpoch,   \* current group key epoch
          groupMembers, \* current members of the group
          granted,      \* the group holds the container grant
          sealedEpochs, \* group key epochs retained container wraps are sealed to
          lateHandouts  \* group key epochs handed to a joiner while revoked

vars == << groupEpoch, groupMembers, granted, sealedEpochs, lateHandouts >>

TypeOK ==
  /\ groupEpoch \in GroupEpochs
  /\ groupMembers \in SUBSET Members
  /\ granted \in BOOLEAN
  /\ sealedEpochs \in SUBSET GroupEpochs
  /\ lateHandouts \in SUBSET GroupEpochs

Init ==
  /\ groupEpoch = 1
  /\ groupMembers \in SUBSET Members
  /\ granted = FALSE
  /\ sealedEpochs = {}
  /\ lateHandouts = {}

(* The grant seals the container KEK to the current group key. A regrant   *)
(* makes later joiners legitimate readers again.                           *)
Grant ==
  /\ ~granted
  /\ granted' = TRUE
  /\ sealedEpochs' = sealedEpochs \cup {groupEpoch}
  /\ lateHandouts' = {}
  /\ UNCHANGED << groupEpoch, groupMembers >>

(* A group rotation under a live grant rematerializes the container wraps  *)
(* to the new group key; the old sealed wraps are retained.                *)
Rotate ==
  /\ groupEpoch < MaxGroupEpoch
  /\ groupEpoch' = groupEpoch + 1
  /\ sealedEpochs' =
       IF granted THEN sealedEpochs \cup {groupEpoch + 1} ELSE sealedEpochs
  /\ UNCHANGED << groupMembers, granted, lateHandouts >>

(* Revoking the grant leaves the sealed wraps retained. The fixed server   *)
(* requires the group key to advance in the same commit.                   *)
Revoke ==
  /\ granted
  /\ granted' = FALSE
  /\ lateHandouts' = {}
  /\ IF RotateGroupOnGrantRemoval
       THEN /\ groupEpoch < MaxGroupEpoch
            /\ groupEpoch' = groupEpoch + 1
       ELSE UNCHANGED groupEpoch
  /\ UNCHANGED << groupMembers, sealedEpochs >>

(* An additive member change keeps the group key and wraps it to the       *)
(* joiner.                                                                 *)
AddMember(m) ==
  /\ m \notin groupMembers
  /\ groupMembers' = groupMembers \cup {m}
  /\ lateHandouts' =
       IF granted THEN lateHandouts ELSE lateHandouts \cup {groupEpoch}
  /\ UNCHANGED << groupEpoch, granted, sealedEpochs >>

(* Removing a member rotates the group key for the members who remain.     *)
RemoveMember(m) ==
  /\ m \in groupMembers
  /\ groupEpoch < MaxGroupEpoch
  /\ groupMembers' = groupMembers \ {m}
  /\ groupEpoch' = groupEpoch + 1
  /\ sealedEpochs' =
       IF granted THEN sealedEpochs \cup {groupEpoch + 1} ELSE sealedEpochs
  /\ UNCHANGED << granted, lateHandouts >>

(* The bounded epoch range ends every behavior; stuttering is not a stuck *)
(* protocol.                                                               *)
Idle == UNCHANGED vars

Next ==
  \/ Grant
  \/ Rotate
  \/ Revoke
  \/ \E m \in Members : AddMember(m)
  \/ \E m \in Members : RemoveMember(m)
  \/ Idle

Spec == Init /\ [][Next]_vars

(* While the grant stands revoked, no group key handed to a joiner opens a *)
(* container wrap the group retained from before.                          *)
RevokedGrantUnreadableByLaterMembers ==
  ~granted => lateHandouts \cap sealedEpochs = {}

=============================================================================
