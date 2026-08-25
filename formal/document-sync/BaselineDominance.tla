--------------------- MODULE BaselineDominance ---------------------
EXTENDS Naturals

CONSTANTS Peers, MaxCounter, MaxEpoch, UpdateCount

ASSUME /\ Peers # {}
       /\ MaxCounter \in Nat
       /\ MaxEpoch \in Nat \ {0}
       /\ UpdateCount \in Nat \ {0}

Counters == 0..MaxCounter
Epochs == 1..MaxEpoch
UpdateIds == 1..UpdateCount
VersionVectors == [Peers -> Counters]
UpdateRecords == [epoch : Epochs, frontier : VersionVectors]
UpdateMaps == [UpdateIds -> UpdateRecords]

VARIABLES phase,
          updates,
          currentEpoch,
          hasBaseline,
          coverage,
          historyMode,
          served

vars == << phase, updates, currentEpoch, hasBaseline, coverage, historyMode, served >>

TypeOK ==
  /\ phase \in {"ready", "served"}
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ coverage \in VersionVectors
  /\ historyMode \in {"normal", "raw"}
  /\ served \subseteq UpdateIds

Older(id) == updates[id].epoch < currentEpoch

VectorCovers(required) ==
  \A peer \in Peers : coverage[peer] >= required[peer]

Dominated(id) ==
  /\ hasBaseline
  /\ Older(id)
  /\ VectorCovers(updates[id].frontier)

CanRedirect ==
  /\ hasBaseline
  /\ \E id \in UpdateIds : Older(id)
  /\ \A id \in UpdateIds : Older(id) => Dominated(id)

Init ==
  /\ phase = "ready"
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ coverage \in VersionVectors
  /\ historyMode \in {"normal", "raw"}
  /\ served = {}

Serve ==
  /\ phase = "ready"
  /\ phase' = "served"
  /\ served' = IF historyMode = "normal" /\ CanRedirect
                   THEN {id \in UpdateIds : ~Older(id)}
                   ELSE UpdateIds
  /\ UNCHANGED << updates, currentEpoch, hasBaseline, coverage, historyMode >>

RemainServed ==
  /\ phase = "served"
  /\ UNCHANGED vars

Next ==
  \/ Serve
  \/ RemainServed

Spec == Init /\ [][Next]_vars

OmittedUpdateIsDominated ==
  phase # "served" \/ \A id \in (UpdateIds \ served) : Dominated(id)

UncoveredUpdateIsServed ==
  phase # "served" \/ \A id \in UpdateIds : ~Dominated(id) => id \in served

CurrentOrNewerUpdateIsServed ==
  phase # "served" \/ \A id \in UpdateIds : ~Older(id) => id \in served

NoDataLoss ==
  phase # "served" \/ \A id \in (UpdateIds \ served) : Dominated(id)

RawModeServesCompleteFrontier ==
  phase # "served" \/ historyMode # "raw" \/ served = UpdateIds

====================================================================
