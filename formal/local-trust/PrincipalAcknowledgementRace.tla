---------------------- MODULE PrincipalAcknowledgementRace --------------------
EXTENDS Naturals
CONSTANTS CapturePredecessor, RequireReceiptAncestry, PreserveProgress, RetryCAS
ASSUME {CapturePredecessor, RequireReceiptAncestry, PreserveProgress, RetryCAS} \subseteq BOOLEAN
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
Prepare ==
  /\ phase = "prepare"
  /\ LET lostPredecessor == ~CapturePredecessor /\ prefix["directory"] > 0
         conflict == RequireReceiptAncestry /\ branch = "fork"
     IN /\ phase' = IF lostPredecessor \/ conflict THEN "refused" ELSE "ready"
        /\ incident' = (lostPredecessor \/ conflict)
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
  /\ incident' = ~RetryCAS
  /\ UNCHANGED <<prefix, pin, maximumPrefix, maximumPin, branch, readerDone,
                  observedPrefix, observedPin, published>>
Next == Reader \/ Prepare \/ Commit \/ LostCAS
        \/ (phase \in {"done", "refused"} /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(Prepare) /\ WF_vars(Commit) /\ WF_vars(LostCAS)
TypeOK ==
  /\ prefix \in [Principals -> 0..2] /\ pin \in [Principals -> 0..2]
  /\ maximumPrefix \in [Principals -> 0..2] /\ maximumPin \in [Principals -> 0..2]
  /\ observedPrefix \in [Principals -> 0..2] /\ observedPin \in [Principals -> 0..2]
  /\ branch \in {"receipt", "fork"} /\ readerDone \in BOOLEAN
  /\ phase \in {"prepare", "ready", "done", "refused"}
  /\ incident \in BOOLEAN /\ published \in BOOLEAN
HonestReaderIsNotIncident == branch = "receipt" => ~incident
ReceiptIsOnCurrentBranch == published => branch = "receipt"
ProgressIsMonotonic == \A p \in Principals: prefix[p] >= maximumPrefix[p] /\ pin[p] >= maximumPin[p]
CompoundPublication == published => \A p \in Principals: prefix[p] >= 1 /\ pin[p] >= 1
HonestReceiptCompletes == (branch = "receipt") ~> (published \/ branch = "fork")
=============================================================================
