------------------------ MODULE VoidUpdateProgress ------------------------
EXTENDS FiniteSets, Naturals, Sequences

(***************************************************************************)
(* Reading past a false op span (#3135).                                   *)
(*                                                                         *)
(* Every update in a document's server log declares, under its writer's    *)
(* signature, the operations it carries. The server cannot read the       *)
(* payload, so a dishonest or broken writer can commit an update whose     *)
(* declared span is not what it carries: an overclaim names an operation   *)
(* nobody ever carries, an underclaim hides an operation behind a span a   *)
(* reader may already cover. The server filters a pull by the reader's     *)
(* frontier against declared spans, so an overclaim is served forever.    *)
(*                                                                         *)
(* A reader judges each served update in server order: it accepts one     *)
(* whose payload is exactly its declared span, which its decoder can read, *)
(* and whose dependencies the operations it holds satisfy; otherwise it    *)
(* voids it and goes on. A completed pull records a processed cursor (the *)
(* pull's upper bound) with the judge (decoder) and the frontier it was    *)
(* reached with. A later pull sends the cursor only while both still hold, *)
(* and the server then serves only updates after it. A pull's pages are    *)
(* collapsed into one served inbox and one judging step; a decoder upgrade *)
(* between the two stands for one between pages, and such a pull leaves   *)
(* the cursor as it was.                                                   *)
(*                                                                         *)
(* The decoder's runtime can also fail on an update (a trap or exhausted   *)
(* memory) for reasons of the process, not the update. Such an update is   *)
(* unsettled: the pull applies what came before it, records no cursor, and *)
(* a later pull judges it again. Only the first runtime failure in a       *)
(* process lifetime counts as an attempt, and once MaxAttempts lifetimes   *)
(* have each failed it the update is a final void on that device until its *)
(* decoder changes. A device on which an honest update failed MaxAttempts  *)
(* lifetimes holds less than one on which it did not; that is the accepted *)
(* residual, so agreement and currency are stated for equal final voids.  *)
(*                                                                         *)
(* Readers are devices with no local writes; writers are outside actors.  *)
(* Commits, decoder upgrades, state replacement, runtime failures, and     *)
(* restarts have no fairness; only server delivery (Pull) and the device's *)
(* own processing (Process) do.                                            *)
(*                                                                         *)
(* Nine switches each relax one rule, set safe in the registered config:   *)
(*   RefuseVoid           a void fails the whole pass (the old behavior)   *)
(*   ImportCarriedOps     a span mismatch imports what the payload carries *)
(*   PullUsesCursor       FALSE: the server filters by frontier alone      *)
(*   KeepCursorOnUpgrade  the cursor survives a decoder upgrade            *)
(*   IgnoreCursorVersion  the cursor survives a frontier that no longer    *)
(*                        covers the one it was recorded with              *)
(*   IgnorePullPremise    a pull upgraded between its pages still records  *)
(*                        its cursor                                       *)
(*   MemoizeRuntimeFailure  a runtime failure voids its update at once     *)
(*   CountEveryFailure    every runtime failure counts, not only a          *)
(*                        lifetime's first                                 *)
(*   CursorPastUnsettled  a pull held at an unsettled update still records *)
(*                        its cursor                                       *)
(***************************************************************************)

CONSTANTS Devices, MaxUpdates, MaxDecoder, MaxReplacements,
          MaxAttempts, MaxLifetimes, FaultyDevices,
          RefuseVoid, ImportCarriedOps, PullUsesCursor,
          KeepCursorOnUpgrade, IgnoreCursorVersion, IgnorePullPremise,
          MemoizeRuntimeFailure, CountEveryFailure, CursorPastUnsettled

ASSUME /\ Devices # {}
       /\ IsFiniteSet(Devices)
       /\ MaxUpdates \in Nat \ {0}
       /\ MaxDecoder \in Nat \ {0}
       /\ MaxReplacements \in Nat
       /\ MaxAttempts \in Nat \ {0}
       /\ MaxLifetimes \in Nat \ {0}
       /\ FaultyDevices \subseteq Devices
       /\ RefuseVoid \in BOOLEAN
       /\ ImportCarriedOps \in BOOLEAN
       /\ PullUsesCursor \in BOOLEAN
       /\ KeepCursorOnUpgrade \in BOOLEAN
       /\ IgnoreCursorVersion \in BOOLEAN
       /\ IgnorePullPremise \in BOOLEAN
       /\ MemoizeRuntimeFailure \in BOOLEAN
       /\ CountEveryFailure \in BOOLEAN
       /\ CursorPastUnsettled \in BOOLEAN

(* An overclaim reserves a second id that no update ever carries. *)
Ops == 1..(2 * MaxUpdates)
Decoders == 1..MaxDecoder
Updates == [declared : SUBSET Ops, carried : SUBSET Ops, deps : SUBSET Ops,
            format : Decoders]
Phases == {"idle", "pulled"}

(* `log` is the server's committed history in server (commit) order. Per    *)
(* device: `decoder` is the running judge, `held` the operations its       *)
(* document holds (its frontier), `cursor` the processed cursor (0 when it *)
(* has none) with the `cursorJudge` and `cursorVersion` it was recorded    *)
(* with, `inbox`/`bound` a served pull and its upper bound, and          *)
(* `pullJudge` the judge the pull's first page was sent with. `attempts`  *)
(* counts, per update, the lifetimes whose runtime failure on it counted,  *)
(* `finalVoid` the updates those made void, `failedInLife` whether this    *)
(* lifetime has met a runtime failure, and `lifetime` which lifetime runs. *)
VARIABLES log, nextOp, decoder, held, cursor, cursorJudge, cursorVersion,
          phase, inbox, bound, pullJudge, replacements,
          attempts, finalVoid, failedInLife, lifetime

vars == << log, nextOp, decoder, held, cursor, cursorJudge, cursorVersion,
           phase, inbox, bound, pullJudge, replacements,
           attempts, finalVoid, failedInLife, lifetime >>

RuntimeVars == << attempts, finalVoid, failedInLife, lifetime >>

Truthful(u) == u.declared = u.carried
TruthfulOps ==
  UNION {log[i].carried : i \in {j \in DOMAIN log : Truthful(log[j])}}

(* One update's verdict against the operations accepted so far. A payload   *)
(* the decoder cannot read, whose dependencies are missing, or that is not  *)
(* its declared span is void; ImportCarriedOps keeps the last one.         *)
Accepts(u, dec, h) ==
  /\ u.format <= dec
  /\ u.deps \subseteq h
  /\ Truthful(u) \/ ImportCarriedOps

(* Judges indices `s` in order, starting from operations `h`; the updates  *)
(* in `fv` are final runtime voids, void without being read.              *)
RECURSIVE Judge(_, _, _, _)
Judge(s, dec, h, fv) ==
  IF s = << >> THEN [held |-> h, voided |-> FALSE]
  ELSE LET u == log[Head(s)]
           ok == Head(s) \notin fv /\ Accepts(u, dec, h)
           rest == Judge(Tail(s), dec, IF ok THEN h \cup u.carried ELSE h, fv)
       IN [held |-> rest.held, voided |-> rest.voided \/ ~ok]

RECURSIVE Range(_, _)
Range(from, to) == IF from > to THEN << >> ELSE << from >> \o Range(from + 1, to)

(* What a fresh reader on decoder `dec` holds after judging the whole log, *)
(* voiding the final runtime voids `fv` as well.                          *)
Reference(dec, fv) == Judge(Range(1, Len(log)), dec, {}, fv).held

RECURSIVE SumAttempts(_, _)
SumAttempts(f, k) == IF k = 0 THEN 0 ELSE f[k] + SumAttempts(f, k - 1)

(* The server's pull: every update after `from` whose declared span the      *)
(* frontier `h` does not cover, in server order.                          *)
RECURSIVE Uncovered(_, _, _)
Uncovered(h, from, k) ==
  IF k > Len(log) THEN << >>
  ELSE IF k > from /\ ~(log[k].declared \subseteq h)
         THEN << k >> \o Uncovered(h, from, k + 1)
         ELSE Uncovered(h, from, k + 1)

CursorSendable(d) ==
  /\ PullUsesCursor
  /\ cursor[d] > 0
  /\ KeepCursorOnUpgrade \/ cursorJudge[d] = decoder[d]
  /\ IgnoreCursorVersion \/ cursorVersion[d] \subseteq held[d]

TypeOK ==
  /\ log \in Seq(Updates)
  /\ Len(log) <= MaxUpdates
  /\ nextOp \in 1..(2 * MaxUpdates + 1)
  /\ decoder \in [Devices -> Decoders]
  /\ held \in [Devices -> SUBSET Ops]
  /\ cursor \in [Devices -> 0..MaxUpdates]
  /\ cursorJudge \in [Devices -> Decoders]
  /\ cursorVersion \in [Devices -> SUBSET Ops]
  /\ phase \in [Devices -> Phases]
  /\ inbox \in [Devices -> Seq(1..MaxUpdates)]
  /\ bound \in [Devices -> 0..MaxUpdates]
  /\ pullJudge \in [Devices -> Decoders]
  /\ replacements \in 0..MaxReplacements
  /\ attempts \in [Devices -> [1..MaxUpdates -> 0..MaxAttempts]]
  /\ finalVoid \in [Devices -> SUBSET (1..MaxUpdates)]
  /\ failedInLife \in [Devices -> BOOLEAN]
  /\ lifetime \in [Devices -> 1..MaxLifetimes]

Init ==
  /\ log = << >>
  /\ nextOp = 1
  /\ decoder = [d \in Devices |-> 1]
  /\ held = [d \in Devices |-> {}]
  /\ cursor = [d \in Devices |-> 0]
  /\ cursorJudge = [d \in Devices |-> 1]
  /\ cursorVersion = [d \in Devices |-> {}]
  /\ phase = [d \in Devices |-> "idle"]
  /\ inbox = [d \in Devices |-> << >>]
  /\ bound = [d \in Devices |-> 0]
  /\ pullJudge = [d \in Devices |-> 1]
  /\ replacements = 0
  /\ attempts = [d \in Devices |-> [i \in 1..MaxUpdates |-> 0]]
  /\ finalVoid = [d \in Devices |-> {}]
  /\ failedInLife = [d \in Devices |-> FALSE]
  /\ lifetime = [d \in Devices |-> 1]

DeviceVars == << decoder, held, cursor, cursorJudge, cursorVersion, phase,
                 inbox, bound, pullJudge, replacements, attempts, finalVoid,
                 failedInLife, lifetime >>

(* An honest writer, on any decoder, depends only on operations committed  *)
(* before its update, which it holds; it never holds a voided payload.     *)
HonestCommit ==
  /\ Len(log) < MaxUpdates
  /\ \E f \in Decoders, deps \in SUBSET TruthfulOps :
       log' = Append(log, [declared |-> {nextOp}, carried |-> {nextOp},
                           deps |-> deps, format |-> f])
  /\ nextOp' = nextOp + 1
  /\ UNCHANGED DeviceVars

(* Declares an operation the payload does not carry. *)
Overclaim ==
  /\ Len(log) < MaxUpdates
  /\ log' = Append(log, [declared |-> {nextOp, nextOp + 1},
                         carried |-> {nextOp}, deps |-> {}, format |-> 1])
  /\ nextOp' = nextOp + 2
  /\ UNCHANGED DeviceVars

(* Re-carries an earlier update's operations under that update's span and  *)
(* hides a new one behind it, so a reader covering the span never sees it. *)
Underclaim ==
  /\ Len(log) < MaxUpdates
  /\ \E i \in DOMAIN log :
       /\ Truthful(log[i])
       /\ log' = Append(log, [declared |-> log[i].carried,
                              carried |-> log[i].carried \cup {nextOp},
                              deps |-> {}, format |-> 1])
  /\ nextOp' = nextOp + 1
  /\ UNCHANGED DeviceVars

Pull(d) ==
  /\ phase[d] = "idle"
  /\ inbox' = [inbox EXCEPT ![d] =
                 Uncovered(held[d], IF CursorSendable(d) THEN cursor[d] ELSE 0, 1)]
  /\ bound' = [bound EXCEPT ![d] = Len(log)]
  /\ pullJudge' = [pullJudge EXCEPT ![d] = decoder[d]]
  /\ phase' = [phase EXCEPT ![d] = "pulled"]
  /\ UNCHANGED << log, nextOp, decoder, held, cursor, cursorJudge,
                  cursorVersion, replacements >>
  /\ UNCHANGED RuntimeVars

(* Judges the pull in one transaction. A completed pull records the cursor *)
(* with the running judge and the frontier it reached, unless the judge is *)
(* not the one its first page was sent with: the server served it from a   *)
(* cursor another judge stood for, so it judged less than its bound claims. *)
(* Applies a judged pull `r` and, when its premise holds, records the      *)
(* cursor: the shared tail of Process and of a runtime failure that made   *)
(* its update a final void.                                                *)
Complete(d, r) ==
  IF RefuseVoid /\ r.voided
    THEN UNCHANGED << held, cursor, cursorJudge, cursorVersion >>
    ELSE /\ held' = [held EXCEPT ![d] = r.held]
         /\ IF pullJudge[d] = decoder[d] \/ IgnorePullPremise
              THEN /\ cursor' = [cursor EXCEPT ![d] = bound[d]]
                   /\ cursorJudge' = [cursorJudge EXCEPT ![d] = decoder[d]]
                   /\ cursorVersion' = [cursorVersion EXCEPT ![d] = r.held]
              ELSE UNCHANGED << cursor, cursorJudge, cursorVersion >>

Process(d) ==
  /\ phase[d] = "pulled"
  /\ Complete(d, Judge(inbox[d], decoder[d], held[d], finalVoid[d]))
  /\ phase' = [phase EXCEPT ![d] = "idle"]
  /\ inbox' = [inbox EXCEPT ![d] = << >>]
  /\ UNCHANGED << log, nextOp, decoder, bound, pullJudge, replacements >>
  /\ UNCHANGED RuntimeVars

(* The runtime fails on the served update at inbox position `k`, one not   *)
(* already a final void, on a device in FaultyDevices (one is enough: the  *)
(* others stand for readers whose runtime never fails). The failure counts *)
(* only as the lifetime's first.                                           *)
(* Below MaxAttempts counted lifetimes the update is unsettled: the pull   *)
(* applies what came before it and records no cursor. At MaxAttempts it is *)
(* a final void and the pull completes like Process.                       *)
RuntimeFailure(d) ==
  /\ d \in FaultyDevices
  /\ phase[d] = "pulled"
  /\ ~failedInLife[d] \/ CountEveryFailure
  /\ \E k \in 1..Len(inbox[d]) :
       LET i == inbox[d][k]
           counted == attempts[d][i] + 1
           final == counted >= MaxAttempts \/ MemoizeRuntimeFailure
       IN /\ i \notin finalVoid[d]
          /\ attempts' = [attempts EXCEPT ![d][i] = counted]
          /\ failedInLife' = [failedInLife EXCEPT ![d] = TRUE]
          /\ IF final
               THEN /\ finalVoid' = [finalVoid EXCEPT ![d] = @ \cup {i}]
                    /\ Complete(d, Judge(inbox[d], decoder[d], held[d],
                                          finalVoid[d] \cup {i}))
               ELSE LET r == Judge(SubSeq(inbox[d], 1, k - 1), decoder[d],
                                   held[d], finalVoid[d])
                    IN /\ held' = [held EXCEPT ![d] = r.held]
                       /\ UNCHANGED finalVoid
                       /\ IF CursorPastUnsettled
                            THEN /\ cursor' = [cursor EXCEPT ![d] = bound[d]]
                                 /\ cursorJudge' =
                                      [cursorJudge EXCEPT ![d] = decoder[d]]
                                 /\ cursorVersion' =
                                      [cursorVersion EXCEPT ![d] = r.held]
                            ELSE UNCHANGED << cursor, cursorJudge,
                                              cursorVersion >>
  /\ phase' = [phase EXCEPT ![d] = "idle"]
  /\ inbox' = [inbox EXCEPT ![d] = << >>]
  /\ UNCHANGED << log, nextOp, decoder, bound, pullJudge, replacements,
                  lifetime >>

(* A new process: its first runtime failure counts again. A restart of a   *)
(* process that met none changes nothing the model tracks, so it is left   *)
(* out.                                                                    *)
Restart(d) ==
  /\ failedInLife[d]
  /\ phase[d] = "idle"
  /\ lifetime[d] < MaxLifetimes
  /\ lifetime' = [lifetime EXCEPT ![d] = @ + 1]
  /\ failedInLife' = [failedInLife EXCEPT ![d] = FALSE]
  /\ UNCHANGED << log, nextOp, decoder, held, cursor, cursorJudge,
                  cursorVersion, phase, inbox, bound, pullJudge,
                  replacements, attempts, finalVoid >>

(* A newer SDK, whose decoder reads formats the older one voided. It may    *)
(* land between a pull's pages, while its continuation is persisted. Every *)
(* runtime verdict belonged to the old decoder, so attempts start over.    *)
Upgrade(d) ==
  /\ decoder[d] < MaxDecoder
  /\ decoder' = [decoder EXCEPT ![d] = @ + 1]
  /\ attempts' = [attempts EXCEPT ![d] = [i \in 1..MaxUpdates |-> 0]]
  /\ finalVoid' = [finalVoid EXCEPT ![d] = {}]
  /\ UNCHANGED << log, nextOp, held, cursor, cursorJudge, cursorVersion,
                  phase, inbox, bound, pullJudge, replacements,
                  failedInLife, lifetime >>

(* The document's local state is replaced by an older copy; the cursor row *)
(* is left as it was.                                                      *)
Replace(d) ==
  /\ phase[d] = "idle"
  /\ replacements < MaxReplacements
  /\ held[d] # {}
  /\ held' = [held EXCEPT ![d] = {}]
  /\ replacements' = replacements + 1
  /\ UNCHANGED << log, nextOp, decoder, cursor, cursorJudge, cursorVersion,
                  phase, inbox, bound, pullJudge >>
  /\ UNCHANGED RuntimeVars

Next ==
  \/ HonestCommit
  \/ Overclaim
  \/ Underclaim
  \/ \E d \in Devices :
       \/ Pull(d)
       \/ Process(d)
       \/ RuntimeFailure(d)
       \/ Restart(d)
       \/ Upgrade(d)
       \/ Replace(d)

Fairness == \A d \in Devices : WF_vars(Pull(d)) /\ WF_vars(Process(d))

Spec == Init /\ [][Next]_vars /\ Fairness

(* --- Properties ------------------------------------------------------- *)

(* No device holds an operation that no signed span declares. *)
VoidNeverApplied == \A d \in Devices : held[d] \subseteq TruthfulOps

(* A device's cursor stands for everything through it, judged by its       *)
(* running judge from a frontier it still holds.                           *)
Processed(d, i) ==
  /\ i <= cursor[d]
  /\ cursorJudge[d] = decoder[d]
  /\ cursorVersion[d] \subseteq held[d]

(* The server never serves a device an update it already judged. *)
ServedOnceAfterProcessed ==
  \A d \in Devices :
    \A k \in 1..Len(inbox[d]) : ~Processed(d, inbox[d][k])

(* Devices that processed the whole log with the same judge and the same   *)
(* final runtime voids hold the same operations.                          *)
ProcessedDevicesAgree ==
  \A d, e \in Devices :
    (/\ Len(log) > 0
     /\ Processed(d, Len(log)) /\ Processed(e, Len(log))
     /\ decoder[d] = decoder[e]
     /\ finalVoid[d] = finalVoid[e])
      => held[d] = held[e]

(* No update, honest ones included, is void on a runtime failure until     *)
(* MaxAttempts process lifetimes have each failed it.                      *)
RuntimeVoidOnlyAfterAttempts ==
  \A d \in Devices : \A i \in finalVoid[d] : attempts[d][i] >= MaxAttempts

(* Each lifetime counts at most one runtime failure, so a process whose    *)
(* module a failure left unusable cannot spend another update's attempts. *)
AttemptsWithinLifetimes ==
  \A d \in Devices : SumAttempts(attempts[d], MaxUpdates) <= lifetime[d]

(* Once writes stop, every device holds exactly what a fresh reader on its *)
(* decoder holds that voids its final runtime voids too, so an honest      *)
(* update its decoder reads is imported unless MaxAttempts lifetimes each  *)
(* failed it there.                                                        *)
DeviceEventuallyCurrent ==
  \A d \in Devices : <>[](held[d] = Reference(decoder[d], finalVoid[d]))

=============================================================================
