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
(* Readers are devices with no local writes; writers are outside actors.  *)
(* Commits, decoder upgrades, and state replacement have no fairness; only *)
(* server delivery (Pull) and the device's own processing (Process) do.   *)
(*                                                                         *)
(* Six switches each relax one rule, set safe in the registered config:    *)
(*   RefuseVoid           a void fails the whole pass (the old behavior)   *)
(*   ImportCarriedOps     a span mismatch imports what the payload carries *)
(*   PullUsesCursor       FALSE: the server filters by frontier alone      *)
(*   KeepCursorOnUpgrade  the cursor survives a decoder upgrade            *)
(*   IgnoreCursorVersion  the cursor survives a frontier that no longer    *)
(*                        covers the one it was recorded with              *)
(*   IgnorePullPremise    a pull upgraded between its pages still records  *)
(*                        its cursor                                       *)
(***************************************************************************)

CONSTANTS Devices, MaxUpdates, MaxDecoder, MaxReplacements,
          RefuseVoid, ImportCarriedOps, PullUsesCursor,
          KeepCursorOnUpgrade, IgnoreCursorVersion, IgnorePullPremise

ASSUME /\ Devices # {}
       /\ IsFiniteSet(Devices)
       /\ MaxUpdates \in Nat \ {0}
       /\ MaxDecoder \in Nat \ {0}
       /\ MaxReplacements \in Nat
       /\ RefuseVoid \in BOOLEAN
       /\ ImportCarriedOps \in BOOLEAN
       /\ PullUsesCursor \in BOOLEAN
       /\ KeepCursorOnUpgrade \in BOOLEAN
       /\ IgnoreCursorVersion \in BOOLEAN
       /\ IgnorePullPremise \in BOOLEAN

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
(* `pullJudge` the judge the pull's first page was sent with.              *)
VARIABLES log, nextOp, decoder, held, cursor, cursorJudge, cursorVersion,
          phase, inbox, bound, pullJudge, replacements

vars == << log, nextOp, decoder, held, cursor, cursorJudge, cursorVersion,
           phase, inbox, bound, pullJudge, replacements >>

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

(* Judges indices `s` in order, starting from operations `h`. *)
RECURSIVE Judge(_, _, _)
Judge(s, dec, h) ==
  IF s = << >> THEN [held |-> h, voided |-> FALSE]
  ELSE LET u == log[Head(s)]
           ok == Accepts(u, dec, h)
           rest == Judge(Tail(s), dec, IF ok THEN h \cup u.carried ELSE h)
       IN [held |-> rest.held, voided |-> rest.voided \/ ~ok]

RECURSIVE Range(_, _)
Range(from, to) == IF from > to THEN << >> ELSE << from >> \o Range(from + 1, to)

(* What a fresh reader on decoder `dec` holds after judging the whole log. *)
Reference(dec) == Judge(Range(1, Len(log)), dec, {}).held

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

DeviceVars == << decoder, held, cursor, cursorJudge, cursorVersion, phase,
                 inbox, bound, pullJudge, replacements >>

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

(* Judges the pull in one transaction. A completed pull records the cursor *)
(* with the running judge and the frontier it reached, unless the judge is *)
(* not the one its first page was sent with: the server served it from a   *)
(* cursor another judge stood for, so it judged less than its bound claims. *)
Process(d) ==
  /\ phase[d] = "pulled"
  /\ LET r == Judge(inbox[d], decoder[d], held[d]) IN
       IF RefuseVoid /\ r.voided
         THEN UNCHANGED << held, cursor, cursorJudge, cursorVersion >>
         ELSE /\ held' = [held EXCEPT ![d] = r.held]
              /\ IF pullJudge[d] = decoder[d] \/ IgnorePullPremise
                   THEN /\ cursor' = [cursor EXCEPT ![d] = bound[d]]
                        /\ cursorJudge' = [cursorJudge EXCEPT ![d] = decoder[d]]
                        /\ cursorVersion' = [cursorVersion EXCEPT ![d] = r.held]
                   ELSE UNCHANGED << cursor, cursorJudge, cursorVersion >>
  /\ phase' = [phase EXCEPT ![d] = "idle"]
  /\ inbox' = [inbox EXCEPT ![d] = << >>]
  /\ UNCHANGED << log, nextOp, decoder, bound, pullJudge, replacements >>

(* A newer SDK, whose decoder reads formats the older one voided. It may    *)
(* land between a pull's pages, while its continuation is persisted.       *)
Upgrade(d) ==
  /\ decoder[d] < MaxDecoder
  /\ decoder' = [decoder EXCEPT ![d] = @ + 1]
  /\ UNCHANGED << log, nextOp, held, cursor, cursorJudge, cursorVersion,
                  phase, inbox, bound, pullJudge, replacements >>

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

Next ==
  \/ HonestCommit
  \/ Overclaim
  \/ Underclaim
  \/ \E d \in Devices :
       \/ Pull(d)
       \/ Process(d)
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

(* Devices that processed the whole log with the same judge hold the same *)
(* operations.                                                             *)
ProcessedDevicesAgree ==
  \A d, e \in Devices :
    (/\ Len(log) > 0
     /\ Processed(d, Len(log)) /\ Processed(e, Len(log))
     /\ decoder[d] = decoder[e])
      => held[d] = held[e]

(* Once writes stop, every device holds exactly what a fresh reader on its *)
(* decoder holds, so an honest update its decoder reads is imported.       *)
DeviceEventuallyCurrent ==
  \A d \in Devices : <>[](held[d] = Reference(decoder[d]))

=============================================================================
