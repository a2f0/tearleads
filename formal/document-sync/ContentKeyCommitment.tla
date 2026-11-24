------------------------ MODULE ContentKeyCommitment ------------------------
EXTENDS FiniteSets, Naturals, Sequences

(***************************************************************************)
(* Content-key commitment and canonical verdicts (#3194).                  *)
(*                                                                         *)
(* Each content-key epoch of a document opens with a commitment to its    *)
(* key, which the API stores and never changes. Every update's envelope,   *)
(* signed through its header's ciphertext hash, names the commitment of    *)
(* the key it was encrypted under, and the API refuses an update whose     *)
(* commitment is not its epoch's. Wraps are opaque to the API, so an       *)
(* authorized key creator can still wrap another key to some target (wrap  *)
(* equivocation), and a cache or a dishonest server can hand a reader a    *)
(* stale key.                                                              *)
(*                                                                         *)
(* AES-GCM does not commit to its key: a crafted ciphertext can open under *)
(* two keys (`opens`). The plaintext hash is keyed by the content key, so  *)
(* it matches under at most one (`hashOk`). A reader judges each update in *)
(* server order. It judges only under the committed key: holding another   *)
(* it can say nothing about the update, which is unavailable and keeps the *)
(* cursor where it is. Under the committed key, an AES-GCM failure or a    *)
(* plaintext hash mismatch is a void, and anything else is accepted. A     *)
(* verdict advances the reader's cursor.                                   *)
(*                                                                         *)
(* Writers, rotations, and stale keys have no fairness; only server        *)
(* delivery of a reader's wraps (Fetch) and the reader's own judging       *)
(* (Judge) do, so no reader waits on another device.                       *)
(*                                                                         *)
(* Four switches each relax one rule, set safe in the registered config:   *)
(*   ReaderChecksCommitment  FALSE: judge under whatever key is held        *)
(*   VoidOnAeadFailure       FALSE: an AES-GCM failure fails the pass       *)
(*   ServerChecksCommitment  FALSE: append without the epoch check          *)
(*   CursorPastUnavailable   an unavailable update still moves the cursor   *)
(***************************************************************************)

CONSTANTS Readers, Keys, MaxEpochs, MaxUpdates, MaxStale,
          AllowEquivocation,
          ReaderChecksCommitment, VoidOnAeadFailure,
          ServerChecksCommitment, CursorPastUnavailable

ASSUME /\ Readers # {}
       /\ IsFiniteSet(Readers)
       /\ Keys # {}
       /\ IsFiniteSet(Keys)
       /\ MaxEpochs \in Nat \ {0}
       /\ MaxUpdates \in Nat \ {0}
       /\ MaxStale \in Nat
       /\ AllowEquivocation \in BOOLEAN
       /\ ReaderChecksCommitment \in BOOLEAN
       /\ VoidOnAeadFailure \in BOOLEAN
       /\ ServerChecksCommitment \in BOOLEAN
       /\ CursorPastUnavailable \in BOOLEAN

None == "none"
Epochs == 1..MaxEpochs
MaybeKey == Keys \cup {None}

(* An update: the epoch it is written at, the key its envelope commits to, *)
(* the keys AES-GCM opens it under, and the key (at most one) under which  *)
(* its plaintext matches the signed hash.                                  *)
Updates ==
  { u \in [epoch : Epochs, cm : Keys, opens : SUBSET Keys,
           hashOk : SUBSET Keys] :
      u.hashOk \subseteq u.opens /\ Cardinality(u.hashOk) <= 1 }

Verdicts == {"accept", "void"}

(* The wraps an epoch's opener stores, one per reader's target: the        *)
(* committed key, or any key when the opener equivocates.                  *)
WrapChoices(k) ==
  IF AllowEquivocation THEN [Readers -> Keys] ELSE {[r \in Readers |-> k]}

VARIABLES epoch, commit, wrap, log, held, cursor, verdict, stale

vars == << epoch, commit, wrap, log, held, cursor, verdict, stale >>

TypeOK ==
  /\ epoch \in Epochs
  /\ commit \in [Epochs -> MaybeKey]
  /\ wrap \in [Epochs -> [Readers -> MaybeKey]]
  /\ log \in Seq(Updates)
  /\ Len(log) <= MaxUpdates
  /\ held \in [Readers -> [Epochs -> MaybeKey]]
  /\ cursor \in [Readers -> 0..MaxUpdates]
  /\ verdict \in [Readers -> Seq(Verdicts)]
  /\ stale \in 0..MaxStale

(* The verdict every reader holding the committed key reaches. *)
Canonical(u) == IF u.cm \in u.hashOk THEN "accept" ELSE "void"

(* What reader r makes of the next update with the key it holds now. *)
Outcome(r) ==
  LET u == log[cursor[r] + 1]
      k == held[r][u.epoch]
  IN IF k = None THEN "unavailable"
     ELSE IF ReaderChecksCommitment /\ k # u.cm THEN "unavailable"
     ELSE IF k \notin u.opens
       THEN IF VoidOnAeadFailure THEN "void" ELSE "unavailable"
     ELSE IF k \notin u.hashOk THEN "void"
     ELSE "accept"

(* Keys are interchangeable, so the first epoch opens under one of them,   *)
(* honestly; a later epoch's opener may equivocate.                        *)
FirstKey == CHOOSE k \in Keys : TRUE

Init ==
  /\ epoch = 1
  /\ commit = [e \in Epochs |-> IF e = 1 THEN FirstKey ELSE None]
  /\ wrap = [e \in Epochs |-> [r \in Readers |->
                                  IF e = 1 THEN FirstKey ELSE None]]
  /\ log = << >>
  /\ held = [r \in Readers |-> [e \in Epochs |-> None]]
  /\ cursor = [r \in Readers |-> 0]
  /\ verdict = [r \in Readers |-> << >>]
  /\ stale = 0

(* A key creator opens the next epoch: an unlink or a stale-bundle heal.   *)
Rotate ==
  /\ epoch < MaxEpochs
  /\ \E k \in Keys : \E w \in WrapChoices(k) :
       /\ epoch' = epoch + 1
       /\ commit' = [commit EXCEPT ![epoch + 1] = k]
       /\ wrap' = [wrap EXCEPT ![epoch + 1] = w]
  /\ UNCHANGED << log, held, cursor, verdict, stale >>

(* Any writer appends at the current epoch; the API refuses an envelope     *)
(* that does not commit to the epoch's key.                                *)
Commit ==
  /\ Len(log) < MaxUpdates
  /\ \E u \in Updates :
       /\ u.epoch = epoch
       /\ ServerChecksCommitment => u.cm = commit[epoch]
       /\ log' = Append(log, u)
  /\ UNCHANGED << epoch, commit, wrap, held, cursor, verdict, stale >>

(* Server delivery: the reader unwraps the wraps stored for its target.   *)
Fetch(r) ==
  /\ held[r] # [e \in Epochs |-> wrap[e][r]]
  /\ held' = [held EXCEPT ![r] = [e \in Epochs |-> wrap[e][r]]]
  /\ UNCHANGED << epoch, commit, wrap, log, cursor, verdict, stale >>

(* A cache or a dishonest server hands the reader another key.             *)
StaleKey(r) ==
  /\ stale < MaxStale
  /\ \E e \in 1..epoch, k \in Keys :
       /\ held[r][e] # k
       /\ held' = [held EXCEPT ![r][e] = k]
  /\ stale' = stale + 1
  /\ UNCHANGED << epoch, commit, wrap, log, cursor, verdict >>

Record(r, v) ==
  /\ cursor' = [cursor EXCEPT ![r] = @ + 1]
  /\ verdict' = [verdict EXCEPT ![r] = Append(@, v)]

(* The reader judges its next update. An unavailable one is no step: the  *)
(* pass fails and the cursor stays, unless CursorPastUnavailable records   *)
(* it as void.                                                             *)
Judge(r) ==
  /\ cursor[r] < Len(log)
  /\ \/ /\ Outcome(r) # "unavailable"
        /\ Record(r, Outcome(r))
     \/ /\ Outcome(r) = "unavailable"
        /\ CursorPastUnavailable
        /\ Record(r, "void")
  /\ UNCHANGED << epoch, commit, wrap, log, held, stale >>

(* Every write is bounded, so a run ends; a reader left unable to read an *)
(* update waits there.                                                     *)
Idle == UNCHANGED vars

Next ==
  \/ Rotate
  \/ Commit
  \/ \E r \in Readers : Fetch(r) \/ StaleKey(r) \/ Judge(r)
  \/ Idle

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ \A r \in Readers : WF_vars(Fetch(r)) /\ WF_vars(Judge(r))

-----------------------------------------------------------------------------

(* Every verdict behind any reader's cursor is the one the committed key   *)
(* gives, whatever key the reader held: verdicts do not depend on keys.    *)
VerdictsAreCanonical ==
  \A r \in Readers : \A i \in 1..cursor[r] :
    verdict[r][i] = Canonical(log[i])

(* Two readers agree on every update both have judged. *)
ReadersAgree ==
  \A r, s \in Readers : \A i \in 1..cursor[r] :
    i <= cursor[s] => verdict[r][i] = verdict[s][i]

(* Every stored update commits to its epoch's key. *)
EpochCommitmentUniform ==
  \A i \in 1..Len(log) : log[i].cm = commit[log[i].epoch]

(* A reader whose stored wraps all hold the committed key eventually       *)
(* judges the whole log, however others' wraps or updates look.            *)
WrapsCanonical(r) == \A e \in 1..epoch : wrap[e][r] = commit[e]

DeviceEventuallyJudges ==
  \A r \in Readers :
    <>[]WrapsCanonical(r) => <>[](cursor[r] = Len(log))

=============================================================================
