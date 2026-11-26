--------------------- MODULE BaselineDominance ---------------------
EXTENDS Naturals

CONSTANTS Peers, MaxCounter, MaxEpoch, UpdateCount, SegmentCount,
          CheckVectorCovers,            \* dominance requires the vector to cover the update
          RawModeServesAll,             \* raw history mode never redirects
          RedirectKeepsCurrentEpoch,    \* a redirect drops only older-epoch updates
          RequireWholeBaseline          \* only a whole signed group redirects

ASSUME /\ Peers # {}
       /\ MaxCounter \in Nat
       /\ MaxEpoch \in Nat \ {0}
       /\ UpdateCount \in Nat \ {0}
       /\ SegmentCount \in Nat \ {0}
       /\ {CheckVectorCovers, RawModeServesAll, RedirectKeepsCurrentEpoch,
           RequireWholeBaseline} \subseteq BOOLEAN

Counters == 0..MaxCounter
Epochs == 1..MaxEpoch
UpdateIds == 1..UpdateCount
Segments == 1..SegmentCount
NoSegment == 0
VersionVectors == [Peers -> Counters]
UpdateRecords == [epoch : Epochs, frontier : VersionVectors]
UpdateMaps == [UpdateIds -> UpdateRecords]

(* The latest current-epoch baseline is a group of `SegmentCount` signed  *)
(* segments, each an ordinary update. `coverage` is the version its       *)
(* segments' signed spans reach together, which run gapless from zero.    *)
(* `segmentOf` names the segment that carries each update's operations,   *)
(* or `NoSegment` for an update the group does not hold: a writer's group *)
(* holds exactly the updates its coverage covers. `storedSegments` are    *)
(* the segments the server still holds with the fields their writer       *)
(* signed. The final segment signs the count and a digest of the others,  *)
(* so a server can tell a whole group from one missing a segment.         *)
VARIABLES phase,
          updates,
          currentEpoch,
          hasBaseline,
          segmentOf,
          storedSegments,
          coverage,
          historyMode,
          served

vars == << phase, updates, currentEpoch, hasBaseline, segmentOf,
           storedSegments, coverage, historyMode, served >>

TypeOK ==
  /\ phase \in {"ready", "served"}
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ segmentOf \in [UpdateIds -> Segments \cup {NoSegment}]
  /\ storedSegments \subseteq Segments
  /\ coverage \in VersionVectors
  /\ historyMode \in {"normal", "raw"}
  /\ served \subseteq UpdateIds

Older(id) == updates[id].epoch < currentEpoch

VectorCovers(required) ==
  \A peer \in Peers : coverage[peer] >= required[peer]

(* What the stored segments carry: a reader redirected to the group is   *)
(* served these and no other part of it.                                  *)
BaselineContains == {id \in UpdateIds : segmentOf[id] \in storedSegments}

WholeBaseline == storedSegments = Segments

(* The baseline the redirect may use: production loads only a group      *)
(* whose stored segments are all there, in index order, each carrying    *)
(* the fields its metadata hash signs, and matching the signed count and  *)
(* digest.                                                                *)
ReadableBaseline ==
  hasBaseline /\ (RequireWholeBaseline => WholeBaseline)

Dominated(id) ==
  /\ ReadableBaseline
  /\ Older(id)
  /\ CheckVectorCovers => VectorCovers(updates[id].frontier)

CanRedirect ==
  /\ ReadableBaseline
  /\ \E id \in UpdateIds : Older(id)
  /\ \A id \in UpdateIds : Older(id) => Dominated(id)

(* What a redirect serves: the current-epoch updates, or, without that   *)
(* rule, only the updates the declared vector does not cover.            *)
RedirectServed ==
  IF RedirectKeepsCurrentEpoch
    THEN {id \in UpdateIds : ~Older(id)}
    ELSE {id \in UpdateIds : ~VectorCovers(updates[id].frontier)}

Init ==
  /\ phase = "ready"
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ coverage \in VersionVectors
  /\ segmentOf \in [UpdateIds -> Segments \cup {NoSegment}]
  /\ storedSegments \in SUBSET Segments
  /\ ~hasBaseline => storedSegments = {}
  /\ \A id \in UpdateIds :
       (segmentOf[id] # NoSegment) <=>
         (hasBaseline /\ VectorCovers(updates[id].frontier))
  /\ historyMode \in {"normal", "raw"}
  /\ served = {}

Serve ==
  /\ phase = "ready"
  /\ phase' = "served"
  /\ served' = IF (historyMode = "normal" \/ ~RawModeServesAll) /\ CanRedirect
                   THEN RedirectServed
                   ELSE UpdateIds
  /\ UNCHANGED << updates, currentEpoch, hasBaseline, segmentOf,
                  storedSegments, coverage, historyMode >>

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

(* Stated against what the stored segments carry, not against the        *)
(* predicate that guards the redirect: an omitted update must reach the   *)
(* reader inside a segment of the group it is redirected to.              *)
NoDataLoss ==
  phase # "served" \/ \A id \in (UpdateIds \ served) : id \in BaselineContains

RawModeServesCompleteFrontier ==
  phase # "served" \/ historyMode # "raw" \/ served = UpdateIds

====================================================================
