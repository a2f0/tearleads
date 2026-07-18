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
          live,
          served

vars == << phase, updates, currentEpoch, hasBaseline, coverage, live, served >>

TypeOK ==
  /\ phase \in {"pruning", "served"}
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ coverage \in VersionVectors
  /\ live \subseteq UpdateIds
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
  /\ \E id \in live : Older(id)
  /\ \A id \in live : Older(id) => Dominated(id)

Init ==
  /\ phase = "pruning"
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ coverage \in VersionVectors
  /\ live = UpdateIds
  /\ served = {}

Prune(id) ==
  /\ phase = "pruning"
  /\ id \in live
  /\ Dominated(id)
  /\ live' = live \ {id}
  /\ UNCHANGED << phase, updates, currentEpoch, hasBaseline, coverage, served >>

Serve ==
  /\ phase = "pruning"
  /\ phase' = "served"
  /\ served' = IF CanRedirect
                   THEN {id \in live : ~Older(id)}
                   ELSE live
  /\ UNCHANGED << updates, currentEpoch, hasBaseline, coverage, live >>

RemainServed ==
  /\ phase = "served"
  /\ UNCHANGED vars

Next ==
  \/ \E id \in UpdateIds : Prune(id)
  \/ Serve
  \/ RemainServed

Spec == Init /\ [][Next]_vars

PrunedOnlyWhenDominated ==
  \A id \in (UpdateIds \ live) : Dominated(id)

OmittedPayloadIsDominated ==
  phase # "served" \/ \A id \in (live \ served) : Dominated(id)

UncoveredUpdateIsServed ==
  phase # "served" \/ \A id \in UpdateIds : ~Dominated(id) => id \in served

CurrentOrNewerPayloadIsRetained ==
  \A id \in UpdateIds : ~Older(id) => id \in live

CurrentOrNewerUpdateIsServed ==
  phase # "served" \/ \A id \in UpdateIds : ~Older(id) => id \in served

ServedPayloadIsLive == served \subseteq live

NoDataLoss ==
  phase # "served" \/ \A id \in (UpdateIds \ served) : Dominated(id)

====================================================================
