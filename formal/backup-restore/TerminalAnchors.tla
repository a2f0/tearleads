-------------------------- MODULE TerminalAnchors --------------------------
EXTENDS Naturals, FiniteSets

(* A full restore preserves terminal purge pins and incident evidence. A pin *)
(* value abstracts the signed organization, manifest hash, and purge hash.   *)
(* The preflight can race a newly verified purge or incident before restore. *)
CONSTANTS Documents, PinValues, Incidents, None,
          PreserveAnchors, RecheckAtCommit
ASSUME /\ Documents # {} /\ IsFiniteSet(Documents)
       /\ PinValues # {} /\ IsFiniteSet(PinValues)
       /\ Incidents # {} /\ IsFiniteSet(Incidents)
       /\ None \notin PinValues
       /\ {PreserveAnchors, RecheckAtCommit} \subseteq BOOLEAN

Pins == [Documents -> PinValues \cup {None}]
EmptyPins == [d \in Documents |-> None]
VARIABLES pins, incidents, backupPins, backupIncidents,
          plannedPins, plannedIncidents, pending
vars == <<pins, incidents, backupPins, backupIncidents,
          plannedPins, plannedIncidents, pending>>

Compatible(a, b) ==
  \A d \in Documents : a[d] = None \/ b[d] = None \/ a[d] = b[d]
MergePins(a, b) == [d \in Documents |-> IF a[d] = None THEN b[d] ELSE a[d]]
RestoredPins(a, b) == IF PreserveAnchors THEN MergePins(a, b) ELSE b
RestoredIncidents(a, b) == IF PreserveAnchors THEN a \cup b ELSE b

Init ==
  /\ pins = EmptyPins /\ incidents = {}
  /\ backupPins = EmptyPins /\ backupIncidents = {}
  /\ plannedPins = EmptyPins /\ plannedIncidents = {}
  /\ pending = FALSE

ObservePurge(d, value) ==
  /\ pins[d] = None
  /\ pins' = [pins EXCEPT ![d] = value]
  /\ UNCHANGED <<incidents, backupPins, backupIncidents,
                  plannedPins, plannedIncidents, pending>>

ObserveIncident(i) ==
  /\ incidents' = incidents \cup {i}
  /\ UNCHANGED <<pins, backupPins, backupIncidents,
                  plannedPins, plannedIncidents, pending>>

(* A backup may come from another device, including conflicting evidence. *)
SelectBackup(p, i) ==
  /\ ~pending
  /\ backupPins' = p /\ backupIncidents' = i
  /\ UNCHANGED <<pins, incidents, plannedPins, plannedIncidents, pending>>

Preflight ==
  /\ ~pending /\ Compatible(pins, backupPins)
  /\ plannedPins' = RestoredPins(pins, backupPins)
  /\ plannedIncidents' = RestoredIncidents(incidents, backupIncidents)
  /\ pending' = TRUE
  /\ UNCHANGED <<pins, incidents, backupPins, backupIncidents>>

(* Conflict refusal leaves the database unchanged. The successful merge is *)
(* computed again inside the database write transaction, after any race.    *)
Restore ==
  /\ pending
  /\ IF RecheckAtCommit
       THEN IF Compatible(pins, backupPins)
              THEN /\ pins' = RestoredPins(pins, backupPins)
                   /\ incidents' = RestoredIncidents(incidents, backupIncidents)
              ELSE UNCHANGED <<pins, incidents>>
       ELSE /\ pins' = plannedPins
            /\ incidents' = plannedIncidents
  /\ pending' = FALSE
  /\ UNCHANGED <<backupPins, backupIncidents, plannedPins, plannedIncidents>>

Next ==
  \/ \E d \in Documents, v \in PinValues : ObservePurge(d, v)
  \/ \E i \in Incidents : ObserveIncident(i)
  \/ \E p \in Pins, i \in SUBSET Incidents : SelectBackup(p, i)
  \/ Preflight \/ Restore
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ pins \in Pins /\ backupPins \in Pins /\ plannedPins \in Pins
  /\ incidents \subseteq Incidents /\ backupIncidents \subseteq Incidents
  /\ plannedIncidents \subseteq Incidents /\ pending \in BOOLEAN
PurgePinsNeverChange ==
  [][\A d \in Documents : pins[d] # None => pins'[d] = pins[d]]_vars
IncidentEvidenceNeverLost == [][incidents \subseteq incidents']_vars
=============================================================================
