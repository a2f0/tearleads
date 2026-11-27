------------------------ MODULE StagedBaselineCommit ------------------------
EXTENDS FiniteSets, Naturals, Sequences

(***************************************************************************)
(* A rotation baseline staged ahead of time and committed by reference.    *)
(* Segments are staged in index order and committed under the document     *)
(* head lock with the final segment inline; staged payloads stay in the    *)
(* staged-segment table and are read by reference. Readers page committed  *)
(* rows only. History is a count of operations: update n is [n - 1, n),    *)
(* and a segment carries [lo, hi). See StagedBaselineCommit.md.            *)
(***************************************************************************)

CONSTANTS MaxOps,                 \* ordinary updates the writers commit
          BaselineIds,            \* the ids a rotator may give a baseline
          MaxRotations,           \* baselines the rotator commits
          MaxFaults,              \* expiries, abandons and rotator restarts
          None,
          CommitUnderHeadLock,    \* no writer commits inside a commit
          CoverageFromSpans,      \* coverage is what the spans carry
          CommitRequiresNextIndex,\* the final index is the stage's next
          PromoteAllOrNone,       \* every staged row commits, or none
          SweepLocksStageRow,     \* the sweep waits for a commit's stage lock
          DeleteKeepsCommitted,   \* a delete skips committed segments
          ServeOnlyCommittedRows, \* a page reads committed rows only
          RedirectRequiresWholeGroup, \* a redirect needs a whole group
          OpenReplacesPriorStage, \* opening replaces the caller's stage
          ReproveOnStaleRefusal,  \* a refused rotator proves its history again
          ResumeChecksStage       \* a resumed rotator clears a lost stage

ASSUME /\ MaxOps \in Nat \ {0}
       /\ MaxRotations \in Nat \ {0}
       /\ MaxFaults \in Nat
       /\ None \notin BaselineIds
       /\ CommitUnderHeadLock \in BOOLEAN
       /\ CoverageFromSpans \in BOOLEAN
       /\ CommitRequiresNextIndex \in BOOLEAN
       /\ PromoteAllOrNone \in BOOLEAN
       /\ SweepLocksStageRow \in BOOLEAN
       /\ DeleteKeepsCommitted \in BOOLEAN
       /\ ServeOnlyCommittedRows \in BOOLEAN
       /\ RedirectRequiresWholeGroup \in BOOLEAN
       /\ OpenReplacesPriorStage \in BOOLEAN
       /\ ReproveOnStaleRefusal \in BOOLEAN
       /\ ResumeChecksStage \in BOOLEAN

(* `log` is the document's committed rows in commit order. `frontier` is   *)
(* how many ordinary updates are committed, and `rotations` how many       *)
(* baselines. `stage` is the rotator's open stage row and `staged` the     *)
(* staged-segment table, which keeps a committed segment's payload. `txn`  *)
(* and `pending` are a commit between its gate and its inserts. `known` is *)
(* the history the rotator last proved and `rphase` what it is doing.      *)
(* `reader` is one cold reader. `stranded` records a rotation that left a  *)
(* committed update uncovered, and `servedStaged` a page that served an    *)
(* uncommitted segment.                                                    *)
VARIABLES log, frontier, rotations, stage, staged, txn, pending, known,
          rphase, reader, faults, stranded, servedStaged

vars == << log, frontier, rotations, stage, staged, txn, pending, known,
           rphase, reader, faults, stranded, servedStaged >>

Min(S) == CHOOSE x \in S : \A y \in S : x <= y
Max(S) == CHOOSE x \in S : \A y \in S : x >= y

RowType ==
  [kind : {"update", "segment"}, base : BaselineIds \cup {None},
   index : 0..(MaxOps + 1), final : BOOLEAN, lo : 0..MaxOps, hi : 0..MaxOps]

StagedType ==
  [base : BaselineIds, index : 0..MaxOps, lo : 0..MaxOps, hi : 0..MaxOps]

UpdateRow(n) ==
  [kind |-> "update", base |-> None, index |-> 0, final |-> FALSE,
   lo |-> n - 1, hi |-> n]

SegmentRow(b, i, f, lo, hi) ==
  [kind |-> "segment", base |-> b, index |-> i, final |-> f,
   lo |-> lo, hi |-> hi]

TypeOK ==
  /\ \A i \in DOMAIN log : log[i] \in RowType
  /\ frontier \in 0..MaxOps
  /\ rotations \in 0..MaxRotations
  /\ \/ stage = None
     \/ stage \in [id : BaselineIds, next : 0..MaxOps, reach : 0..MaxOps,
                   expired : BOOLEAN]
  /\ staged \subseteq StagedType
  /\ txn \in {"idle", "gated"}
  /\ \/ pending = None
     \/ /\ pending.id \in BaselineIds
        /\ pending.rows \subseteq StagedType
        /\ pending.index \in 0..(MaxOps + 1)
        /\ pending.lo \in 0..MaxOps
        /\ pending.hi \in 0..MaxOps
  /\ known \in 0..MaxOps
  /\ rphase \in {"idle", "staging", "stale", "resuming"}
  /\ reader \in [started : BOOLEAN, pos : 0..Len(log), held : 0..MaxOps]
  /\ faults \in 0..MaxFaults
  /\ stranded \in BOOLEAN
  /\ servedStaged \in BOOLEAN

Init ==
  /\ log = << >>
  /\ frontier = 0
  /\ rotations = 0
  /\ stage = None
  /\ staged = {}
  /\ txn = "idle"
  /\ pending = None
  /\ known = 0
  /\ rphase = "idle"
  /\ reader = [started |-> FALSE, pos |-> 0, held |-> 0]
  /\ faults = 0
  /\ stranded = FALSE
  /\ servedStaged = FALSE

----------------------------------------------------------------------------
(* Stored state *)

(* A committed row reads a staged segment's payload by its place in the    *)
(* group. The final segment arrives inline and stores its own payload.     *)
Committed(s) ==
  \E i \in DOMAIN log :
    /\ log[i].kind = "segment" /\ ~log[i].final
    /\ log[i].base = s.base /\ log[i].index = s.index

(* A group's rows are unique by baseline and index, so a baseline id that  *)
(* holds committed rows takes no second group.                             *)
IdCommitted(b) == \E i \in DOMAIN log : log[i].base = b

StageUsable == stage # None /\ ~stage.expired

(* What deleting a stage's segments leaves in the staged-segment table:    *)
(* every other baseline's rows, and this baseline's committed ones.        *)
KeptAfterDelete(b) ==
  {s \in staged : s.base # b \/ (DeleteKeepsCommitted /\ Committed(s))}

RECURSIVE RowsInOrder(_)
RowsInOrder(S) ==
  IF S = {} THEN << >>
  ELSE LET first == CHOOSE s \in S : \A t \in S : s.index <= t.index
       IN << SegmentRow(first.base, first.index, FALSE, first.lo, first.hi) >>
            \o RowsInOrder(S \ {first})

GroupPositions(b) == {i \in DOMAIN log : log[i].base = b}

(* A group is whole when its rows sit together in index order from zero,   *)
(* only the last is final, and each starts where the one before it ended.  *)
GroupWhole(b) ==
  LET P == GroupPositions(b) IN
  /\ P # {}
  /\ LET first == Min(P)
         last == Max(P)
     IN /\ P = first..last
        /\ \A i \in P :
             /\ log[i].index = i - first
             /\ log[i].final <=> i = last
             /\ log[i].lo = IF i = first THEN 0 ELSE log[i - 1].hi

GroupSealed(b) == \E i \in GroupPositions(b) : log[i].final

----------------------------------------------------------------------------
(* Writers *)

(* An ordinary sync write. It takes the manifest-head write lock a commit  *)
(* holds from its gate to its inserts.                                     *)
Write ==
  /\ frontier < MaxOps
  /\ txn = "idle" \/ ~CommitUnderHeadLock
  /\ frontier' = frontier + 1
  /\ log' = Append(log, UpdateRow(frontier + 1))
  /\ UNCHANGED << rotations, stage, staged, txn, pending, known, rphase,
                  reader, faults, stranded, servedStaged >>

----------------------------------------------------------------------------
(* The rotator and its stage *)

(* The rotator proves its history and opens a stage. A user has one open   *)
(* stage per document, so opening replaces the one the rotator left.       *)
OpenStage ==
  /\ rphase = "idle"
  /\ txn = "idle"
  /\ rotations < MaxRotations
  /\ stage = None \/ OpenReplacesPriorStage
  /\ \E b \in BaselineIds :
       stage' = [id |-> b, next |-> 0, reach |-> 0, expired |-> FALSE]
  /\ staged' = IF stage = None THEN staged ELSE KeptAfterDelete(stage.id)
  /\ known' = frontier
  /\ rphase' = "staging"
  /\ UNCHANGED << log, frontier, rotations, txn, pending, reader, faults,
                  stranded, servedStaged >>

(* Stage the next segment. It starts where the stage's segments end, and   *)
(* carries only operations the rotator holds. No two staged segments share *)
(* a baseline and an index.                                                *)
StageSegment ==
  /\ rphase = "staging"
  /\ txn = "idle"
  /\ StageUsable
  /\ ~\E s \in staged : s.base = stage.id /\ s.index = stage.next
  /\ \E hi \in (stage.reach + 1)..known :
       /\ staged' = staged \cup {[base |-> stage.id, index |-> stage.next,
                                  lo |-> stage.reach, hi |-> hi]}
       /\ stage' = [stage EXCEPT !.next = @ + 1, !.reach = hi]
  /\ UNCHANGED << log, frontier, rotations, txn, pending, known, rphase,
                  reader, faults, stranded, servedStaged >>

FinalIndexes ==
  IF CommitRequiresNextIndex THEN {stage.next}
  ELSE {stage.next, stage.next + 1}

(* The commit's gate. The final segment carries the rest of what the       *)
(* rotator holds and declares a vector `d`, which may claim more. The gate *)
(* reads coverage from the spans the stage walked and the final segment's  *)
(* own, and holds the stage row and the head lock until the inserts.       *)
CommitGate ==
  /\ rphase = "staging"
  /\ txn = "idle"
  /\ StageUsable
  /\ ~IdCommitted(stage.id)
  /\ \E f \in FinalIndexes, d \in known..MaxOps :
       /\ (IF CoverageFromSpans THEN known ELSE d) >= frontier
       /\ pending' = [id |-> stage.id,
                      rows |-> {s \in staged : s.base = stage.id},
                      index |-> f, lo |-> stage.reach, hi |-> known]
  /\ txn' = "gated"
  /\ UNCHANGED << log, frontier, rotations, stage, staged, known, rphase,
                  reader, faults, stranded, servedStaged >>

(* The gate refuses a baseline that stops short of the committed frontier. *)
(* Nothing is written and the stage stays as it was.                       *)
CommitRefusedStale ==
  /\ rphase = "staging"
  /\ txn = "idle"
  /\ StageUsable
  /\ ~IdCommitted(stage.id)
  /\ known < frontier
  /\ rphase' = "stale"
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, reader, faults, stranded, servedStaged >>

(* A rotator refused for stale coverage pulls, proves its history again    *)
(* and goes on staging: the tail lands after the segments it staged.       *)
Reprove ==
  /\ rphase = "stale"
  /\ known' = IF ReproveOnStaleRefusal THEN frontier ELSE known
  /\ rphase' = "staging"
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  reader, faults, stranded, servedStaged >>

(* A stage that is gone or expired, or whose baseline id is taken, refuses *)
(* the rotator with a code, and the rotator starts over.                   *)
RotatorSeesRefusal ==
  /\ rphase = "staging"
  /\ txn = "idle"
  /\ IF StageUsable THEN IdCommitted(stage.id) ELSE TRUE
  /\ rphase' = "idle"
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, reader, faults, stranded, servedStaged >>

(* The commit's inserts: one row per staged segment in index order, then   *)
(* the final segment, and the stage row is deleted. The payloads stay in   *)
(* the staged-segment table. `dropped` is what a commit that was not all   *)
(* or none would leave out.                                                *)
Promote ==
  /\ txn = "gated"
  /\ \E dropped \in SUBSET pending.rows :
       /\ PromoteAllOrNone => dropped = {}
       /\ log' = log \o RowsInOrder(pending.rows \ dropped)
                     \o << SegmentRow(pending.id, pending.index, TRUE,
                                      pending.lo, pending.hi) >>
  /\ stranded' = (stranded \/ pending.hi < frontier)
  /\ stage' = None
  /\ rotations' = rotations + 1
  /\ rphase' = "idle"
  /\ txn' = "idle"
  /\ pending' = None
  /\ UNCHANGED << frontier, staged, known, reader, faults, servedStaged >>

(* The rotator gives its stage up.                                         *)
Abandon ==
  /\ rphase = "staging"
  /\ txn = "idle"
  /\ stage # None
  /\ faults < MaxFaults
  /\ staged' = KeptAfterDelete(stage.id)
  /\ stage' = None
  /\ rphase' = "idle"
  /\ faults' = faults + 1
  /\ UNCHANGED << log, frontier, rotations, txn, pending, known, reader,
                  stranded, servedStaged >>

(* The rotator's process restarts and forgets its stage, which stays on    *)
(* the server (for example after a local database reset or lost row).      *)
RotatorRestart ==
  /\ rphase # "idle"
  /\ txn = "idle"
  /\ faults < MaxFaults
  /\ rphase' = "idle"
  /\ faults' = faults + 1
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, reader, stranded, servedStaged >>

(* The rotator's process crashes mid-stage, keeping its durable record of  *)
(* the open stage in local SQLite.                                         *)
RotatorCrash ==
  /\ rphase \in {"staging", "stale"}
  /\ txn = "idle"
  /\ stage # None
  /\ faults < MaxFaults
  /\ rphase' = "resuming"
  /\ faults' = faults + 1
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, reader, stranded, servedStaged >>

(* After a crash, the rotator reads its durable stage from the server. If  *)
(* the stage is usable and uncommitted, it re-proves its history and goes  *)
(* on staging from the server-acknowledged index (`stage.next`). If the    *)
(* stage expired, was swept, or its id committed while the process was     *)
(* down, the rotator drops its durable record and starts anew.             *)
ResumeStage ==
  /\ rphase = "resuming"
  /\ txn = "idle"
  /\ IF StageUsable /\ ~IdCommitted(stage.id) THEN
       /\ known' = frontier
       /\ rphase' = "staging"
     ELSE
       /\ ResumeChecksStage
       /\ known' = known
       /\ rphase' = "idle"
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  reader, faults, stranded, servedStaged >>

----------------------------------------------------------------------------
(* Expiry and the sweep *)

(* The stage's expiry passes. A commit that locked the stage before then   *)
(* goes on.                                                                *)
Expire ==
  /\ stage # None
  /\ ~stage.expired
  /\ faults < MaxFaults
  /\ stage' = [stage EXCEPT !.expired = TRUE]
  /\ faults' = faults + 1
  /\ UNCHANGED << log, frontier, rotations, staged, txn, pending, known,
                  rphase, reader, stranded, servedStaged >>

(* The sweep deletes an expired stage and its segments. It deletes the     *)
(* stage row first, so it waits for a commit that holds the row.           *)
Sweep ==
  /\ stage # None
  /\ stage.expired
  /\ txn = "idle" \/ ~SweepLocksStageRow
  /\ staged' = KeptAfterDelete(stage.id)
  /\ stage' = None
  /\ UNCHANGED << log, frontier, rotations, txn, pending, known, rphase,
                  reader, faults, stranded, servedStaged >>

----------------------------------------------------------------------------
(* The reader *)

RedirectCandidates ==
  {b \in BaselineIds :
     GroupSealed(b) /\ (RedirectRequiresWholeGroup => GroupWhole(b))}

LatestGroup ==
  CHOOSE b \in RedirectCandidates :
    \A c \in RedirectCandidates :
      Max(GroupPositions(b)) >= Max(GroupPositions(c))

(* Where a cold reader's pull starts: just before the first segment of the *)
(* latest whole group, or at the beginning when there is none.             *)
RedirectStart ==
  IF RedirectCandidates = {} THEN 0
  ELSE Min(GroupPositions(LatestGroup)) - 1

ReaderStart ==
  /\ ~reader.started
  /\ reader' = [started |-> TRUE, pos |-> RedirectStart, held |-> 0]
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, rphase, faults, stranded, servedStaged >>

(* One more committed row, in commit order. The reader applies a row that  *)
(* starts within what it holds.                                            *)
ReaderPage ==
  /\ reader.started
  /\ reader.pos < Len(log)
  /\ LET row == log[reader.pos + 1] IN
       reader' = [reader EXCEPT
                    !.pos = @ + 1,
                    !.held = IF row.lo <= @ /\ row.hi > @ THEN row.hi ELSE @]
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, rphase, faults, stranded, servedStaged >>

(* A page that read the staged-segment table on its own would serve a      *)
(* segment no commit placed.                                               *)
ReaderServedStaged ==
  /\ ~ServeOnlyCommittedRows
  /\ reader.started
  /\ \E s \in staged : ~Committed(s)
  /\ servedStaged' = TRUE
  /\ UNCHANGED << log, frontier, rotations, stage, staged, txn, pending,
                  known, rphase, reader, faults, stranded >>

----------------------------------------------------------------------------

RotatorStep ==
  \/ OpenStage
  \/ StageSegment
  \/ CommitGate
  \/ CommitRefusedStale
  \/ Reprove
  \/ ResumeStage
  \/ RotatorSeesRefusal
  \/ Promote

(* Every behavior is finite; stuttering is not a stuck protocol.           *)
Idle == UNCHANGED vars

Next ==
  \/ Write
  \/ RotatorStep
  \/ Abandon
  \/ RotatorRestart
  \/ RotatorCrash
  \/ Expire
  \/ Sweep
  \/ ReaderStart
  \/ ReaderPage
  \/ ReaderServedStaged
  \/ Idle

(* The rotator keeps going and a started commit finishes. Writers, expiry, *)
(* the sweep and the reader are not forced.                                *)
Fairness == WF_vars(RotatorStep)

Spec == Init /\ [][Next]_vars /\ Fairness

----------------------------------------------------------------------------
(* Properties *)

(* No page serves a segment that is staged and not committed.              *)
UncommittedNeverServed == ~servedStaged

(* Every committed group is whole: its rows sit together in index order    *)
(* from zero, the last is the final segment, and their spans run gapless   *)
(* from zero.                                                              *)
CommittedGroupsAreWhole ==
  \A b \in BaselineIds : GroupPositions(b) # {} => GroupWhole(b)

(* Every rotation's baseline carried the whole committed frontier when it  *)
(* committed.                                                              *)
EpochAdvanceCoversFrontier == ~stranded

(* While a commit is between its gate and its inserts, what it will commit *)
(* still covers the committed frontier.                                    *)
GatedCommitCoversFrontier ==
  (txn = "gated" /\ CommitUnderHeadLock /\ CoverageFromSpans)
    => pending.hi >= frontier

(* Every committed row that reads its payload by reference still has it.   *)
SweepKeepsCommittedSegments ==
  \A i \in DOMAIN log :
    (log[i].kind = "segment" /\ ~log[i].final)
      => \E s \in staged : s.base = log[i].base /\ s.index = log[i].index

(* A reader that has paged to the end holds every committed operation,     *)
(* whichever baseline it started at and whatever committed meanwhile.      *)
ReaderLosesNothing ==
  (reader.started /\ reader.pos = Len(log)) => reader.held = frontier

(* Committed rows are never removed or reordered: a commit only appends.   *)
CommittedRowsStay ==
  [][Len(log') >= Len(log) /\ SubSeq(log', 1, Len(log)) = log]_vars

(* An honest rotator commits a baseline.                                   *)
RotatorEventuallyCommits == <>(rotations >= 1)

=============================================================================
