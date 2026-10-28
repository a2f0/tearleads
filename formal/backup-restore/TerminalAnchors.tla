-------------------------- MODULE TerminalAnchors --------------------------
EXTENDS Naturals, FiniteSets

(* A full restore preserves the three kinds of local trust anchor:         *)
(* immutable terminal pins, append-only incident evidence, and monotone     *)
(* verification checkpoints. A pin value abstracts the signed organization, *)
(* manifest hash, and purge hash. A checkpoint is a position (an epoch or   *)
(* version) with the hash signed at it. The preflight can race a newly      *)
(* verified purge, incident, or checkpoint advance before restore.          *)
CONSTANTS Documents, PinValues, Incidents, None,
          MaxPosition, CheckpointHashes,
          PreserveAnchors, RecheckAtCommit,
          MergeCheckpointsByMax, RefuseCheckpointConflict
ASSUME /\ Documents # {} /\ IsFiniteSet(Documents)
       /\ PinValues # {} /\ IsFiniteSet(PinValues)
       /\ Incidents # {} /\ IsFiniteSet(Incidents)
       /\ None \notin PinValues
       /\ MaxPosition \in Nat \ {0}
       /\ CheckpointHashes # {} /\ None \notin CheckpointHashes
       /\ {PreserveAnchors, RecheckAtCommit, MergeCheckpointsByMax,
           RefuseCheckpointConflict} \subseteq BOOLEAN

Pins == [Documents -> PinValues \cup {None}]
EmptyPins == [d \in Documents |-> None]
(* Position 0 is a checkpoint not yet taken. *)
Checkpoints ==
  {[position |-> 0, hash |-> None]} \cup
    [position: 1..MaxPosition, hash: CheckpointHashes]
NoCheckpoint == [position |-> 0, hash |-> None]
VARIABLES pins, incidents, checkpoint,
          backupPins, backupIncidents, backupCheckpoint,
          plannedPins, plannedIncidents, plannedCheckpoint, pending
vars == <<pins, incidents, checkpoint,
          backupPins, backupIncidents, backupCheckpoint,
          plannedPins, plannedIncidents, plannedCheckpoint, pending>>

PinsCompatible(a, b) ==
  \A d \in Documents : a[d] = None \/ b[d] = None \/ a[d] = b[d]
(* Two checkpoints conflict when they sign different hashes at one position. *)
CheckpointsCompatible(a, b) ==
  ~RefuseCheckpointConflict \/ a.position # b.position \/ a.hash = b.hash
Compatible ==
  /\ PinsCompatible(pins, backupPins)
  /\ CheckpointsCompatible(checkpoint, backupCheckpoint)
MergePins(a, b) == [d \in Documents |-> IF a[d] = None THEN b[d] ELSE a[d]]
MergeCheckpoint(a, b) ==
  IF ~MergeCheckpointsByMax \/ b.position > a.position \/
       (b.position = a.position /\ ~RefuseCheckpointConflict)
    THEN b ELSE a
RestoredPins(a, b) == IF PreserveAnchors THEN MergePins(a, b) ELSE b
RestoredIncidents(a, b) == IF PreserveAnchors THEN a \cup b ELSE b
RestoredCheckpoint(a, b) == IF PreserveAnchors THEN MergeCheckpoint(a, b) ELSE b

Init ==
  /\ pins = EmptyPins /\ incidents = {} /\ checkpoint = NoCheckpoint
  /\ backupPins = EmptyPins /\ backupIncidents = {}
  /\ backupCheckpoint = NoCheckpoint
  /\ plannedPins = EmptyPins /\ plannedIncidents = {}
  /\ plannedCheckpoint = NoCheckpoint
  /\ pending = FALSE

backupVars == <<backupPins, backupIncidents, backupCheckpoint>>
plannedVars == <<plannedPins, plannedIncidents, plannedCheckpoint>>

ObservePurge(d, value) ==
  /\ pins[d] = None
  /\ pins' = [pins EXCEPT ![d] = value]
  /\ UNCHANGED <<incidents, checkpoint, backupVars, plannedVars, pending>>

ObserveIncident(i) ==
  /\ incidents' = incidents \cup {i}
  /\ UNCHANGED <<pins, checkpoint, backupVars, plannedVars, pending>>

(* Verification only ever advances a checkpoint. *)
AdvanceCheckpoint(h) ==
  /\ checkpoint.position < MaxPosition
  /\ checkpoint' = [position |-> checkpoint.position + 1, hash |-> h]
  /\ UNCHANGED <<pins, incidents, backupVars, plannedVars, pending>>

(* A backup may come from another device, including conflicting evidence: *)
(* an older checkpoint, or a different hash signed at the same position.  *)
SelectBackup(p, i, c) ==
  /\ ~pending
  /\ backupPins' = p /\ backupIncidents' = i /\ backupCheckpoint' = c
  /\ UNCHANGED <<pins, incidents, checkpoint, plannedVars, pending>>

Preflight ==
  /\ ~pending /\ Compatible
  /\ plannedPins' = RestoredPins(pins, backupPins)
  /\ plannedIncidents' = RestoredIncidents(incidents, backupIncidents)
  /\ plannedCheckpoint' = RestoredCheckpoint(checkpoint, backupCheckpoint)
  /\ pending' = TRUE
  /\ UNCHANGED <<pins, incidents, checkpoint, backupVars>>

(* Conflict refusal leaves the database unchanged. The successful merge is *)
(* computed again inside the database write transaction, after any race.    *)
Restore ==
  /\ pending
  /\ IF RecheckAtCommit
       THEN IF Compatible
              THEN /\ pins' = RestoredPins(pins, backupPins)
                   /\ incidents' = RestoredIncidents(incidents, backupIncidents)
                   /\ checkpoint' =
                        RestoredCheckpoint(checkpoint, backupCheckpoint)
              ELSE UNCHANGED <<pins, incidents, checkpoint>>
       ELSE /\ pins' = plannedPins
            /\ incidents' = plannedIncidents
            /\ checkpoint' = plannedCheckpoint
  /\ pending' = FALSE
  /\ UNCHANGED <<backupVars, plannedVars>>

Next ==
  \/ \E d \in Documents, v \in PinValues : ObservePurge(d, v)
  \/ \E i \in Incidents : ObserveIncident(i)
  \/ \E h \in CheckpointHashes : AdvanceCheckpoint(h)
  \/ \E p \in Pins, i \in SUBSET Incidents, c \in Checkpoints :
       SelectBackup(p, i, c)
  \/ Preflight \/ Restore
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ pins \in Pins /\ backupPins \in Pins /\ plannedPins \in Pins
  /\ incidents \subseteq Incidents /\ backupIncidents \subseteq Incidents
  /\ plannedIncidents \subseteq Incidents /\ pending \in BOOLEAN
  /\ {checkpoint, backupCheckpoint, plannedCheckpoint} \subseteq Checkpoints
PurgePinsNeverChange ==
  [][\A d \in Documents : pins[d] # None => pins'[d] = pins[d]]_vars
IncidentEvidenceNeverLost == [][incidents \subseteq incidents']_vars
(* A restore never moves a checkpoint below its position, nor swaps the    *)
(* hash signed at a position for another.                                  *)
CheckpointsNeverRegress ==
  [][/\ checkpoint'.position >= checkpoint.position
     /\ checkpoint'.position = checkpoint.position =>
          checkpoint'.hash = checkpoint.hash]_vars
=============================================================================
