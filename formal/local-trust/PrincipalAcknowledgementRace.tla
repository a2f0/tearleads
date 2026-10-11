---------------------- MODULE PrincipalAcknowledgementRace --------------------
EXTENDS Naturals
CONSTANTS CapturePredecessor, RequireReceiptAncestry, PreserveProgress, RetryCAS,
          DeferUncoveredPin, RetryDeferredReceipt
ASSUME {CapturePredecessor, RequireReceiptAncestry, PreserveProgress, RetryCAS,
        DeferUncoveredPin, RetryDeferredReceipt} \subseteq BOOLEAN
Principals == {"group", "directory"}
VARIABLES prefix, pin, maximumPrefix, maximumPin, branch, readerDone,
          phase, observedPrefix, observedPin, incident, published
vars == <<prefix, pin, maximumPrefix, maximumPin, branch, readerDone,
          phase, observedPrefix, observedPin, incident, published>>
Init ==
  /\ prefix = [p \in Principals |-> 0] /\ pin = prefix
  /\ maximumPrefix = prefix /\ maximumPin = pin /\ branch = "receipt"
  /\ readerDone = FALSE /\ phase = "prepare"
  /\ observedPrefix = prefix /\ observedPin = pin
  /\ incident = FALSE /\ published = FALSE
Reader ==
  /\ ~readerDone /\ phase \in {"prepare", "ready"}
  /\ \E v \in {1, 2}, b \in {"receipt", "fork"}, admit \in BOOLEAN:
       /\ prefix' = [prefix EXCEPT !["directory"] = v]
       /\ pin' = IF admit THEN [pin EXCEPT !["directory"] = v] ELSE pin
       /\ branch' = b
  /\ maximumPrefix' = prefix' /\ maximumPin' = pin'
  /\ readerDone' = TRUE
  /\ UNCHANGED <<phase, observedPrefix, observedPin, incident, published>>
(* Other verified evidence, such as a document purge proof, pins a head
   without advancing this scope's private prefix. *)
PinOnlyReader ==
  /\ ~readerDone /\ phase \in {"prepare", "ready"}
  /\ \E v \in {1, 2}, b \in {"receipt", "fork"}:
       /\ pin' = [pin EXCEPT !["directory"] = v]
       /\ branch' = b
  /\ maximumPin' = pin'
  /\ readerDone' = TRUE
  /\ UNCHANGED <<prefix, maximumPrefix, phase, observedPrefix, observedPin,
                  incident, published>>
(* A pin newer than the receipt that no scoped prefix covers. *)
UncoveredPin == \E p \in Principals: pin[p] > 1 /\ prefix[p] < pin[p]
Prepare ==
  /\ phase = "prepare"
  /\ LET lostPredecessor == ~CapturePredecessor /\ prefix["directory"] > 0
         conflict == RequireReceiptAncestry /\ branch = "fork" /\ ~UncoveredPin
     IN /\ phase' = CASE lostPredecessor \/ conflict -> "refused"
                       [] UncoveredPin -> "deferred"
                       [] OTHER -> "ready"
        \* Without deferral, the stale receipt fails the pin check as a rollback.
        /\ incident' = (lostPredecessor \/ conflict \/
                        (UncoveredPin /\ ~DeferUncoveredPin))
  /\ observedPrefix' = prefix /\ observedPin' = pin
  /\ UNCHANGED <<prefix, pin, maximumPrefix, maximumPin, branch, readerDone, published>>
Commit ==
  /\ phase = "ready" /\ observedPrefix = prefix /\ observedPin = pin
  /\ prefix' = [p \in Principals |-> IF PreserveProgress /\ prefix[p] > 1 THEN prefix[p] ELSE 1]
  /\ pin' = [p \in Principals |-> IF PreserveProgress /\ pin[p] > 1 THEN pin[p] ELSE 1]
  /\ maximumPrefix' = [p \in Principals |-> IF prefix[p] > 1 THEN prefix[p] ELSE 1]
  /\ maximumPin' = [p \in Principals |-> IF pin[p] > 1 THEN pin[p] ELSE 1]
  /\ phase' = "done" /\ published' = TRUE
  /\ UNCHANGED <<branch, readerDone, observedPrefix, observedPin, incident>>
LostCAS ==
  /\ phase = "ready" /\ (observedPrefix # prefix \/ observedPin # pin)
  /\ phase' = IF RetryCAS THEN "prepare" ELSE "refused"
  \* A lost comparison is an ordinary error; without retry it fails the receipt.
  /\ UNCHANGED <<prefix, pin, maximumPrefix, maximumPin, branch, readerDone,
                  observedPrefix, observedPin, incident, published>>
(* A later scoped read covers the pin; the host retries the retained receipt.
   The branch is now known, so an honest successor publishes and a fork refuses. *)
RecoverAndRetry ==
  /\ RetryDeferredReceipt /\ phase = "deferred"
  /\ prefix' = pin /\ maximumPrefix' = pin
  /\ phase' = "prepare"
  /\ UNCHANGED <<pin, maximumPin, branch, readerDone, observedPrefix,
                  observedPin, incident, published>>
Next == Reader \/ PinOnlyReader \/ Prepare \/ Commit \/ LostCAS \/ RecoverAndRetry
        \/ (phase \in {"done", "refused", "deferred"} /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(Prepare) /\ WF_vars(Commit) /\ WF_vars(LostCAS)
        /\ WF_vars(RecoverAndRetry)
TypeOK ==
  /\ prefix \in [Principals -> 0..2] /\ pin \in [Principals -> 0..2]
  /\ maximumPrefix \in [Principals -> 0..2] /\ maximumPin \in [Principals -> 0..2]
  /\ observedPrefix \in [Principals -> 0..2] /\ observedPin \in [Principals -> 0..2]
  /\ branch \in {"receipt", "fork"} /\ readerDone \in BOOLEAN
  /\ phase \in {"prepare", "ready", "done", "refused", "deferred"}
  /\ incident \in BOOLEAN /\ published \in BOOLEAN
HonestReaderIsNotIncident == branch = "receipt" => ~incident
ReceiptIsOnCurrentBranch == published => branch = "receipt"
ProgressIsMonotonic == \A p \in Principals: prefix[p] >= maximumPrefix[p] /\ pin[p] >= maximumPin[p]
CompoundPublication == published => \A p \in Principals: prefix[p] >= 1 /\ pin[p] >= 1
(* Retention defers only when no local evidence can prove the receipt. *)
DeferralNeedsUncoveredPin == phase = "deferred" => UncoveredPin
UncoveredPinIsNotIncident == UncoveredPin => ~incident
HonestReceiptCompletes ==
  (branch = "receipt") ~> (published \/ branch = "fork")
=============================================================================
