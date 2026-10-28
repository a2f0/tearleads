--------------------- MODULE BaselineDominance ---------------------
EXTENDS Naturals

CONSTANTS Peers, MaxCounter, MaxEpoch, UpdateCount,
          CheckVectorCovers,            \* dominance requires the vector to cover the update
          RawModeServesAll,             \* raw history mode never redirects
          RedirectKeepsCurrentEpoch,    \* a redirect drops only older-epoch updates
          RequireAuthenticatedBaseline  \* only a signed full-history baseline redirects

ASSUME /\ Peers # {}
       /\ MaxCounter \in Nat
       /\ MaxEpoch \in Nat \ {0}
       /\ UpdateCount \in Nat \ {0}
       /\ {CheckVectorCovers, RawModeServesAll, RedirectKeepsCurrentEpoch,
           RequireAuthenticatedBaseline} \subseteq BOOLEAN

Counters == 0..MaxCounter
Epochs == 1..MaxEpoch
UpdateIds == 1..UpdateCount
VersionVectors == [Peers -> Counters]
UpdateRecords == [epoch : Epochs, frontier : VersionVectors]
UpdateMaps == [UpdateIds -> UpdateRecords]

(* `coverage` is the source version vector the latest current-epoch      *)
(* baseline declares; `baselineContains` is what its snapshot actually    *)
(* carries. A baseline whose signed metadata binds a full-history span to *)
(* that vector carries exactly the updates the vector covers; any other    *)
(* baseline's contents are unconstrained.                                  *)
VARIABLES phase,
          updates,
          currentEpoch,
          hasBaseline,
          baselineAuthenticated,
          baselineContains,
          coverage,
          historyMode,
          served

vars == << phase, updates, currentEpoch, hasBaseline, baselineAuthenticated,
           baselineContains, coverage, historyMode, served >>

TypeOK ==
  /\ phase \in {"ready", "served"}
  /\ updates \in UpdateMaps
  /\ currentEpoch \in Epochs
  /\ hasBaseline \in BOOLEAN
  /\ baselineAuthenticated \in BOOLEAN
  /\ baselineContains \subseteq UpdateIds
  /\ coverage \in VersionVectors
  /\ historyMode \in {"normal", "raw"}
  /\ served \subseteq UpdateIds

Older(id) == updates[id].epoch < currentEpoch

VectorCovers(required) ==
  \A peer \in Peers : coverage[peer] >= required[peer]

(* The baseline the redirect may use: production loads only one whose    *)
(* signed metadata binds the declared vector to a full-history span.      *)
ReadableBaseline ==
  hasBaseline /\ (RequireAuthenticatedBaseline => baselineAuthenticated)

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
  /\ baselineAuthenticated \in BOOLEAN
  /\ coverage \in VersionVectors
  /\ baselineContains \in SUBSET UpdateIds
  /\ ~hasBaseline => baselineContains = {}
  /\ (hasBaseline /\ baselineAuthenticated) =>
       baselineContains = {id \in UpdateIds : VectorCovers(updates[id].frontier)}
  /\ historyMode \in {"normal", "raw"}
  /\ served = {}

Serve ==
  /\ phase = "ready"
  /\ phase' = "served"
  /\ served' = IF (historyMode = "normal" \/ ~RawModeServesAll) /\ CanRedirect
                   THEN RedirectServed
                   ELSE UpdateIds
  /\ UNCHANGED << updates, currentEpoch, hasBaseline, baselineAuthenticated,
                  baselineContains, coverage, historyMode >>

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

(* Stated against what the baseline carries, not against the predicate   *)
(* that guards the redirect: an omitted update must reach the reader      *)
(* inside the baseline it is redirected to.                               *)
NoDataLoss ==
  phase # "served" \/ \A id \in (UpdateIds \ served) : id \in baselineContains

RawModeServesCompleteFrontier ==
  phase # "served" \/ historyMode # "raw" \/ served = UpdateIds

====================================================================
