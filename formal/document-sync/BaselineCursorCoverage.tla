----------------------- MODULE BaselineCursorCoverage -----------------------
EXTENDS Naturals, Sequences

(***************************************************************************)
(* Rotation baselines past a false op span (#3135).                        *)
(*                                                                         *)
(* A rotation baseline is a full-history snapshot the next content-key     *)
(* epoch starts from. The server cannot read it, so it compares the        *)
(* baseline's signed source version with the spans committed updates       *)
(* declare: a rotation, an unlink, or a checkpoint is refused while a      *)
(* committed update declares an operation the source lacks, and a new      *)
(* reader's pull jumps to the baseline only when its source covers every   *)
(* update the jump skips. An overclaim declares an operation no update     *)
(* carries, so no source covers it, and one overclaim refused every        *)
(* rotation of its document.                                               *)
(*                                                                         *)
(* A baseline now signs its author's processed cursor: the last update of  *)
(* a pull the author completed, having imported or voided every update up  *)
(* to it. The author signs it only when the snapshot holds the frontier    *)
(* the cursor was recorded with, so every update the author imported up    *)
(* to the cursor is in the snapshot. The gate and the redirect weigh only  *)
(* updates committed after the signed cursor.                              *)
(*                                                                         *)
(* Operations are ids. A truthful update declares what it carries; an      *)
(* overclaim also declares an id nothing carries. Every reader voids an    *)
(* overclaim and imports a truthful update (VoidUpdateProgress covers      *)
(* decoders, dependencies, and runtime failures). A rotation's author has  *)
(* judged a prefix of the log for its cursor and built its snapshot from a *)
(* prefix no longer than that, as a device whose snapshot predates its     *)
(* latest pull does. A snapshot with no operations encodes no baseline;    *)
(* EmptyFrontierUnlink covers the unlink that carries none.               *)
(*                                                                         *)
(* Three switches each relax one rule, set safe in the registered config:  *)
(*   WeighAfterCursor       FALSE: the gate weighs every committed update   *)
(*   SignCoveredCursorOnly  FALSE: a baseline signs its author's cursor     *)
(*                          though its snapshot predates the cursor        *)
(*   RedirectAfterCursor    FALSE: the redirect weighs every update it      *)
(*                          would skip                                     *)
(***************************************************************************)

CONSTANTS MaxWrites, MaxRotations,
          WeighAfterCursor, SignCoveredCursorOnly, RedirectAfterCursor

ASSUME /\ MaxWrites \in Nat \ {0}
       /\ MaxRotations \in Nat \ {0}
       /\ {WeighAfterCursor, SignCoveredCursorOnly, RedirectAfterCursor}
            \subseteq BOOLEAN

(* Write w carries id w; an overclaim also declares MaxWrites + w. *)
Ops == 1..(2 * MaxWrites)
Entries == [declared : SUBSET Ops, carried : SUBSET Ops]
Baselines == [pos : Nat, snapshot : SUBSET Ops, cursor : Nat]
NoBaseline == [pos |-> 0, snapshot |-> {}, cursor |-> 0]

(* `log` is the committed history in commit order, accepted baselines     *)
(* included. `baseline` is the latest accepted one: its position in the   *)
(* log, the operations its snapshot holds (its source covers exactly     *)
(* these), and its signed cursor (0 when it signs none). `lost` records    *)
(* an accepted baseline missing a truthful operation committed before it, *)
(* `refusedHonest` a refusal of an author that judged the whole log.      *)
VARIABLES log, writes, rotations, baseline, lost, refusedHonest

vars == << log, writes, rotations, baseline, lost, refusedHonest >>

Truthful(entry) == entry.declared = entry.carried

(* What a reader holds after judging the first k committed updates. *)
Judged(k) ==
  UNION {log[i].carried : i \in {j \in 1..k : Truthful(log[j])}}

TruthfulOps == Judged(Len(log))

(* The server's coverage check: every update committed after `from`       *)
(* declares only operations the source covers.                           *)
CoversAfter(from, snapshot) ==
  \A i \in (from + 1)..Len(log) : log[i].declared \subseteq snapshot

Gate(snapshot, cursor) ==
  CoversAfter(IF WeighAfterCursor THEN cursor ELSE 0, snapshot)

(* A fresh reader's first pull jumps to the latest baseline when the       *)
(* baseline's source covers every update between where the pull starts    *)
(* (after the baseline's cursor) and the baseline itself.                *)
RedirectJumps ==
  /\ baseline.pos > 0
  /\ \A i \in ((IF RedirectAfterCursor THEN baseline.cursor ELSE 0) + 1)
                ..(baseline.pos - 1) :
       log[i].declared \subseteq baseline.snapshot

TypeOK ==
  /\ log \in Seq(Entries)
  /\ writes \in 0..MaxWrites
  /\ rotations \in 0..MaxRotations
  /\ baseline \in Baselines
  /\ lost \in BOOLEAN
  /\ refusedHonest \in BOOLEAN

Init ==
  /\ log = << >>
  /\ writes = 0
  /\ rotations = 0
  /\ baseline = NoBaseline
  /\ lost = FALSE
  /\ refusedHonest = FALSE

(* A writer commits an update: a truthful one, or an overclaim. *)
Write ==
  /\ writes < MaxWrites
  /\ \E overclaim \in BOOLEAN :
       LET w == writes + 1
       IN /\ log' = Append(log,
                [declared |-> IF overclaim THEN {w, MaxWrites + w} ELSE {w},
                 carried |-> {w}])
          /\ writes' = w
  /\ UNCHANGED << rotations, baseline, lost, refusedHonest >>

(* An author whose cursor stands after `cursor` judged updates builds a     *)
(* snapshot from the first `prefix` of them and submits it; the gate       *)
(* checks it against the committed log and the server appends an accepted *)
(* one under the document's write lock.                                   *)
Rotate ==
  /\ rotations < MaxRotations
  /\ \E cursor \in 0..Len(log), prefix \in 0..Len(log) :
       LET snapshot == Judged(prefix)
           signed == IF Judged(cursor) \subseteq snapshot
                          \/ ~SignCoveredCursorOnly
                       THEN cursor ELSE 0
       IN /\ prefix <= cursor
          /\ snapshot # {}
          /\ rotations' = rotations + 1
          /\ IF Gate(snapshot, signed)
               THEN /\ log' = Append(log,
                         [declared |-> snapshot, carried |-> snapshot])
                    /\ baseline' = [pos |-> Len(log) + 1,
                                    snapshot |-> snapshot,
                                    cursor |-> signed]
                    /\ lost' = (lost \/ ~(TruthfulOps \subseteq snapshot))
                    /\ UNCHANGED refusedHonest
               ELSE /\ refusedHonest' =
                         (refusedHonest \/ prefix = Len(log))
                    /\ UNCHANGED << log, baseline, lost >>
  /\ UNCHANGED writes

(* The bounded writers and authors stop; the log stays as it is. *)
Quiesce == UNCHANGED vars

Next == Write \/ Rotate \/ Quiesce

Spec == Init /\ [][Next]_vars

(* No accepted baseline drops a truthful operation committed before it. *)
RotationKeepsTruthfulOps == ~lost

(* An author that judged the whole log and holds what it imported is never *)
(* refused, however many overclaims the log holds: only its own device     *)
(* acts, so no device waits on another.                                   *)
HonestRotationAccepted == ~refusedHonest

(* A jump never skips a truthful operation the baseline lacks. *)
RedirectSkipsNoTruthfulOp ==
  RedirectJumps =>
    \A i \in 1..(baseline.pos - 1) :
      Truthful(log[i]) => log[i].carried \subseteq baseline.snapshot

(* A fresh reader starts at the latest accepted baseline. *)
AcceptedBaselineRedirects == baseline.pos > 0 => RedirectJumps

=============================================================================
