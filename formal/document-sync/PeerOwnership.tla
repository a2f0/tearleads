--------------------------- MODULE PeerOwnership ---------------------------
EXTENDS FiniteSets, Naturals, Sequences

(***************************************************************************)
(* Document peer ownership (#3194, part B1b).                              *)
(*                                                                         *)
(* A Loro operation id is (peer, counter), and each committed update       *)
(* declares a span (peer, start, end) per peer it carries. The server      *)
(* keeps the committed frontier F[p], the highest span end on peer p.      *)
(* Readers apply updates in server order and void one that reuses an op id *)
(* they already hold with other content, so the earliest carrier wins. A   *)
(* writer that commits a victim's next counters before the victim's own    *)
(* update lands has every reader void the victim's update (preemption).    *)
(*                                                                         *)
(* The server now walks a request's spans under the document lock: a span  *)
(* ending at or below F[p] is a re-assertion any writer may send; one      *)
(* beyond F[p] claims an unowned peer for its writer's user, passes on a   *)
(* peer that user owns, and refuses the whole request on a peer another    *)
(* user owns, naming the refused peers with their F. Peers are secret per  *)
(* record (B1a), so nobody names an honest device's peer before that       *)
(* peer's first commit, which claims it. A purge deletes the owner rows,   *)
(* and the organization's owner, who alone may recreate the freed id,      *)
(* claims every peer the committed history it carries. A device still      *)
(* holding unsent operations on such a peer is refused, forks it at        *)
(* A[p] = min(live[p], F[p]), moves to a fresh secret peer, re-expresses   *)
(* everything beyond A on it (content kept, attribution not), and          *)
(* resubmits; the fresh peer is unknown to anyone, so the resubmission     *)
(* claims it.                                                              *)
(*                                                                         *)
(* Each update also depends on the op ids it builds on, and a reader that  *)
(* lacks one voids it (B2). A writer who reads a device's peer can make    *)
(* its own update depend on the device's next counter: the device holds    *)
(* that op while it is unsent and accepts the update, while every other    *)
(* reader voids it, and so voids each later update the device builds on   *)
(* it. Each update now signs the dependencies it declares; the server     *)
(* refuses a declared dependency past F, naming its peer with F, and every *)
(* reader voids an update whose payload depends on other ops than it      *)
(* declares. Every reader then judges dependencies against committed ops. *)
(*                                                                         *)
(* A request is collapsed into one update, and the device's request and    *)
(* the server's locked processing into one step. The honest devices' own  *)
(* submit, rebase, and pull steps are fair. Edits, the dishonest writer,   *)
(* and the republisher have no fairness, so no device waits on another.    *)
(*                                                                         *)
(* Six switches each relax one rule, set safe in the registered config:   *)
(*   NoOwnership         the server skips the owner rule                   *)
(*   RefuseForeignSpans  the server refuses any span on a peer another     *)
(*                       user owns, even one within F                      *)
(*   NoRebase            a refused device retries without rebasing         *)
(*   PublicPeers         device-stable peers the dishonest writer can name *)
(*                       before their first commit                         *)
(*   NoDependencyCheck   the server skips the dependency rule              *)
(*   NoDeclaredJudge     readers do not compare an update's dependencies   *)
(*                       with those it declares                            *)
(***************************************************************************)

CONSTANTS MaxEdits, MaxRecreations, MaxForges,
          NoOwnership, RefuseForeignSpans, NoRebase, PublicPeers,
          NoDependencyCheck, NoDeclaredJudge

ASSUME /\ MaxEdits \in Nat \ {0}
       /\ MaxRecreations \in Nat
       /\ MaxForges \in Nat
       /\ NoOwnership \in BOOLEAN
       /\ RefuseForeignSpans \in BOOLEAN
       /\ NoRebase \in BOOLEAN
       /\ PublicPeers \in BOOLEAN
       /\ NoDependencyCheck \in BOOLEAN
       /\ NoDeclaredJudge \in BOOLEAN

(* Two honest devices, each its own user, a dishonest member, and a member *)
(* who republishes a purged document.                                      *)
Devices == {1, 2}
UserOf(d) == IF d = 1 THEN "u1" ELSE "u2"
Dishonest == "x"
Republisher == "r"
NoOwner == "none"
Users == {UserOf(d) : d \in Devices} \cup {Dishonest, Republisher}

(* Device d's secret peer of generation g. A device rebases at most once  *)
(* per recreation, so MaxRecreations + 1 generations suffice. The         *)
(* dishonest member writes its own ops on peer 0.                         *)
Peers == 1..(2 * (MaxRecreations + 1))
DishonestPeer == 0
AllPeers == {DishonestPeer} \cup Peers
PeerOf(d, g) == 2 * g + d
PeerDevice(p) == 2 - (p % 2)
RightfulUser(p) == UserOf(PeerDevice(p))

(* An operation is << peer, counter, content >>. Each honest edit has      *)
(* unique content, which a rebase keeps under a new op id.                 *)
Counters == 0..(MaxEdits - 1)
Content(d, k) == 10 * d + k
Forged == 0
Contents == {Forged} \cup {Content(d, k) : d \in Devices, k \in 1..MaxEdits}
Ops == AllPeers \X Counters \X Contents
OpIds == AllPeers \X Counters

Max(S) == CHOOSE m \in S : \A n \in S : n <= m
Min(S) == CHOOSE m \in S : \A n \in S : m <= n

PeersIn(ops) == {op[1] : op \in ops}
IdsOf(ops) == {<< op[1], op[2] >> : op \in ops}

(* The end of the span `ops` declares on peer p (0 when it carries none). *)
End(ops, p) ==
  LET cs == {op[2] : op \in {o \in ops : o[1] = p}}
  IN IF cs = {} THEN 0 ELSE Max(cs) + 1

(* `log` is the server's committed history in server order: each entry's   *)
(* writer, whether an honest actor wrote it, its operations, the op ids    *)
(* its payload depends on (`deps`), and those it declares. Per             *)
(* device: `gen` its peer generation, `doc` the operations it holds,      *)
(* `pending` its own operations not yet committed, `phase` and `refusal`  *)
(* (the frontier a 409 returned for the request's peers), and `edits` the  *)
(* edits made. `ownerEnd` (ghost) is the highest end each peer's own       *)
(* device has had committed; `wrongRefusal` (ghost) records a refusal of   *)
(* an honest request with no beyond-F span on another user's peer.         *)
VARIABLES log, recreations, forges, gen, doc, pending, phase, refusal,
          edits, ownerEnd, wrongRefusal

vars == << log, recreations, forges, gen, doc, pending, phase, refusal,
           edits, ownerEnd, wrongRefusal >>

DeviceVars == << gen, doc, pending, phase, refusal, edits >>

(* --- Server ------------------------------------------------------------ *)

LogOps == UNION {log[i].ops : i \in DOMAIN log}

(* The committed frontier F[p]. *)
Frontier(p) == End(LogOps, p)

(* The first commit on a peer is beyond F = 0 and claims it, so the owner  *)
(* row is the writer of the first entry carrying the peer. A purge clears  *)
(* the log and so the rows.                                                *)
Owner(p) ==
  LET carriers == {i \in DOMAIN log : p \in PeersIn(log[i].ops)}
  IN IF carriers = {} THEN NoOwner ELSE log[Min(carriers)].user

(* The request's beyond-F spans on a peer another user owns. *)
Preempting(w, req) ==
  {p \in PeersIn(req) : /\ End(req, p) > Frontier(p)
                        /\ Owner(p) \notin {NoOwner, w}}

(* Every span on a peer another user owns, within F or not. *)
Foreign(w, req) == {p \in PeersIn(req) : Owner(p) \notin {NoOwner, w}}

(* The peers of the declared dependencies past F: nobody committed them. *)
Uncommitted(declared) ==
  {dep[1] : dep \in {x \in declared : x[2] >= Frontier(x[1])}}

(* The peers the server refuses the request on, which a refusal names     *)
(* with their frontiers.                                                   *)
RefusedPeers(w, req, declared) ==
  (IF NoOwnership THEN {} ELSE Preempting(w, req)) \cup
    (IF RefuseForeignSpans THEN Foreign(w, req) ELSE {}) \cup
    (IF NoDependencyCheck THEN {} ELSE Uncommitted(declared))

Refuses(w, req, declared) == RefusedPeers(w, req, declared) # {}

(* --- Readers ----------------------------------------------------------- *)

Conflicts(ops, held) ==
  \E o \in ops, h \in held : o[1] = h[1] /\ o[2] = h[2] /\ o[3] # h[3]

(* An entry whose payload depends on other ops than it declares, or on an *)
(* op id not yet held, is void.                                            *)
Unreadable(entry, held) ==
  \/ ~NoDeclaredJudge /\ entry.declared # entry.deps
  \/ ~(entry.deps \subseteq IdsOf(held))

(* Judges entries i.. in server order from operations `held`: an entry     *)
(* reusing a held op id with other content is void, the earliest wins.    *)
RECURSIVE JudgeFrom(_, _, _)
JudgeFrom(i, held, voids) ==
  IF i > Len(log) THEN [held |-> held, voids |-> voids]
  ELSE IF Conflicts(log[i].ops, held) \/ Unreadable(log[i], held)
         THEN JudgeFrom(i + 1, held, voids \cup {i})
         ELSE JudgeFrom(i + 1, held \cup log[i].ops, voids)

(* A fresh reader of the committed log. *)
Reader == JudgeFrom(1, {}, {})

(* --- Honest devices ---------------------------------------------------- *)

CurrentPeer(d) == PeerOf(d, gen[d])

Init ==
  /\ log = << >>
  /\ recreations = 0
  /\ forges = 0
  /\ gen = [d \in Devices |-> 0]
  /\ doc = [d \in Devices |-> {}]
  /\ pending = [d \in Devices |-> {}]
  /\ phase = [d \in Devices |-> "idle"]
  /\ refusal = [d \in Devices |-> {}]
  /\ edits = [d \in Devices |-> 0]
  /\ ownerEnd = [p \in Peers |-> 0]
  /\ wrongRefusal = FALSE

(* A local edit at the next counter of the device's current peer, refused  *)
(* or not.                                                                 *)
Edit(d) ==
  /\ edits[d] < MaxEdits
  /\ LET p == CurrentPeer(d)
         op == << p, End(doc[d], p), Content(d, edits[d] + 1) >>
     IN /\ doc' = [doc EXCEPT ![d] = @ \cup {op}]
        /\ pending' = [pending EXCEPT ![d] = @ \cup {op}]
  /\ edits' = [edits EXCEPT ![d] = @ + 1]
  /\ UNCHANGED << log, recreations, forges, gen, phase, refusal, ownerEnd,
                  wrongRefusal >>

(* Sends the unsent operations, alone or with everything the device holds *)
(* (a lagging delta or a rotation baseline re-asserting every peer from    *)
(* counter 0), and the server answers under its lock. The update depends   *)
(* on every op the device holds that it does not carry, and declares so.  *)
Submit(d) ==
  /\ phase[d] = "idle"
  /\ pending[d] # {}
  /\ \E carryHistory \in BOOLEAN :
       LET req == IF carryHistory THEN doc[d] ELSE pending[d]
           deps == IdsOf(doc[d] \ req)
           w == UserOf(d)
       IN IF Refuses(w, req, deps)
            THEN /\ phase' = [phase EXCEPT ![d] = "refused"]
                 /\ refusal' = [refusal EXCEPT ![d] =
                                  {<< p, Frontier(p) >> :
                                     p \in RefusedPeers(w, req, deps)}]
                 /\ wrongRefusal' = (wrongRefusal \/ Preempting(w, req) = {})
                 /\ UNCHANGED << log, pending, ownerEnd >>
            ELSE /\ log' = Append(log, [user |-> w, honest |-> TRUE,
                                        ops |-> req, deps |-> deps,
                                        declared |-> deps])
                 /\ pending' = [pending EXCEPT ![d] = {}]
                 /\ ownerEnd' = [p \in Peers |->
                                   IF PeerDevice(p) = d
                                     THEN Max({ownerEnd[p], End(req, p)})
                                     ELSE ownerEnd[p]]
                 /\ UNCHANGED << phase, refusal, wrongRefusal >>
  /\ UNCHANGED << recreations, forges, gen, doc, edits >>

(* Re-expresses operations `S`, in peer and counter order, as consecutive *)
(* operations on peer `fresh` from counter `next`, keeping their content.  *)
Key(op) == op[1] * (MaxEdits + 1) + op[2]
RECURSIVE Renumber(_, _, _)
Renumber(S, fresh, next) ==
  IF S = {} THEN {}
  ELSE LET m == CHOOSE o \in S : \A o2 \in S : Key(o) <= Key(o2)
       IN {<< fresh, next, m[3] >>} \cup Renumber(S \ {m}, fresh, next + 1)

(* A[p] = min(live[p], F[p]) for the peers the refusal names; the device   *)
(* keeps everything it holds on a peer the refusal does not name.          *)
ForkPoint(d, p) ==
  Min({End(doc[d], p)} \cup {pr[2] : pr \in {q \in refusal[d] : q[1] = p}})

(* On refusal the device forks at A, moves to a fresh secret peer, and     *)
(* queues everything beyond A on it; with NoRebase it only retries.        *)
Rebase(d) ==
  /\ phase[d] = "refused"
  /\ IF NoRebase
       THEN UNCHANGED << gen, doc, pending >>
       ELSE /\ gen[d] < MaxRecreations
            /\ LET kept == {op \in doc[d] : op[2] < ForkPoint(d, op[1])}
                   moved == Renumber(doc[d] \ kept, PeerOf(d, gen[d] + 1), 0)
               IN /\ doc' = [doc EXCEPT ![d] = kept \cup moved]
                  /\ pending' = [pending EXCEPT ![d] = moved]
            /\ gen' = [gen EXCEPT ![d] = @ + 1]
  /\ phase' = [phase EXCEPT ![d] = "idle"]
  /\ refusal' = [refusal EXCEPT ![d] = {}]
  /\ UNCHANGED << log, recreations, forges, edits, ownerEnd, wrongRefusal >>

(* Imports the committed log in server order into what the device holds,  *)
(* voiding what conflicts with it.                                         *)
Pull(d) ==
  /\ LET imported == JudgeFrom(1, doc[d], {}).held
     IN /\ imported # doc[d]
        /\ doc' = [doc EXCEPT ![d] = imported]
  /\ UNCHANGED << log, recreations, forges, gen, pending, phase, refusal,
                  edits, ownerEnd, wrongRefusal >>

(* --- Outside actors ---------------------------------------------------- *)

(* Peers the dishonest member can name: those in the committed log, and    *)
(* with PublicPeers every device's current peer.                           *)
Nameable ==
  PeersIn(LogOps) \cup
    (IF PublicPeers THEN {CurrentPeer(d) : d \in Devices} ELSE {})

(* Commits forged content at counter c of a nameable peer: a re-assertion  *)
(* below F, or the peer's next counter. A refused forgery changes nothing. *)
Forge(p, c) ==
  /\ forges < MaxForges
  /\ p \in Nameable
  /\ c <= Frontier(p)
  /\ ~Refuses(Dishonest, {<< p, c, Forged >>}, {})
  /\ log' = Append(log, [user |-> Dishonest, honest |-> FALSE,
                         ops |-> {<< p, c, Forged >>}, deps |-> {},
                         declared |-> {}])
  /\ forges' = forges + 1
  /\ UNCHANGED << recreations, ownerEnd, wrongRefusal >>
  /\ UNCHANGED DeviceVars

(* Commits an op on the dishonest member's own peer whose payload depends *)
(* on the next counter of a nameable peer, which the peer's device may    *)
(* hold unsent, declaring that dependency or none. A dependency on a      *)
(* committed op is one any honest writer may have.                        *)
ForgeDependent(p) ==
  /\ forges < MaxForges
  /\ p \in Nameable
  /\ Frontier(p) \in Counters
  /\ LET op == << DishonestPeer, 0, Forged >>
         deps == {<< p, Frontier(p) >>}
     IN \E declared \in {deps, {}} :
          /\ ~Refuses(Dishonest, {op}, declared)
          /\ log' = Append(log, [user |-> Dishonest, honest |-> FALSE,
                                 ops |-> {op}, deps |-> deps,
                                 declared |-> declared])
  /\ forges' = forges + 1
  /\ UNCHANGED << recreations, ownerEnd, wrongRefusal >>
  /\ UNCHANGED DeviceVars

(* Purges the document and recreates it from the committed history a       *)
(* reader holds. F starts at 0 and the owner rows are gone, so the         *)
(* recreation claims every peer it carries for the republisher. A full     *)
(* history depends on nothing.                                             *)
Recreate ==
  /\ recreations < MaxRecreations
  /\ Reader.held # {}
  /\ log' = << [user |-> Republisher, honest |-> TRUE, ops |-> Reader.held,
                deps |-> {}, declared |-> {}] >>
  /\ recreations' = recreations + 1
  /\ UNCHANGED << forges, ownerEnd, wrongRefusal >>
  /\ UNCHANGED DeviceVars

Idle == UNCHANGED vars

Next ==
  \/ \E d \in Devices :
       \/ Edit(d)
       \/ Submit(d)
       \/ Rebase(d)
       \/ Pull(d)
  \/ \E p \in AllPeers, c \in Counters : Forge(p, c)
  \/ \E p \in AllPeers : ForgeDependent(p)
  \/ Recreate
  \/ Idle

(* Only the honest devices' own steps are fair; edits, the dishonest       *)
(* member, and the republisher are not.                                    *)
Fairness ==
  \A d \in Devices :
    WF_vars(Submit(d)) /\ WF_vars(Rebase(d)) /\ WF_vars(Pull(d))

Spec == Init /\ [][Next]_vars /\ Fairness

(* --- Properties -------------------------------------------------------- *)

TypeOK ==
  /\ log \in Seq([user : Users, honest : BOOLEAN, ops : SUBSET Ops,
                  deps : SUBSET OpIds, declared : SUBSET OpIds])
  /\ recreations \in 0..MaxRecreations
  /\ forges \in 0..MaxForges
  /\ gen \in [Devices -> 0..MaxRecreations]
  /\ doc \in [Devices -> SUBSET Ops]
  /\ pending \in [Devices -> SUBSET Ops]
  /\ \A d \in Devices : pending[d] \subseteq doc[d]
  /\ phase \in [Devices -> {"idle", "refused"}]
  /\ refusal \in [Devices -> SUBSET (AllPeers \X (0..MaxEdits))]
  /\ edits \in [Devices -> 0..MaxEdits]
  /\ ownerEnd \in [Peers -> 0..MaxEdits]
  /\ wrongRefusal \in BOOLEAN

(* No reader voids a committed honest update. *)
HonestUpdatesAccepted == \A i \in Reader.voids : ~log[i].honest

(* No committed update by another user occupies a device's counters beyond *)
(* what that device has had committed.                                    *)
NoPreemption ==
  \A i \in DOMAIN log : \A p \in PeersIn(log[i].ops) \cap Peers :
    log[i].user # RightfulUser(p) => End(log[i].ops, p) <= ownerEnd[p]

(* An honest request is refused only for a beyond-F span on a peer another *)
(* user owns: never for a re-assertion within F, nor for a dependency.     *)
ReassertionsNeverRefused == ~wrongRefusal

(* No device accepts a committed update that a fresh reader voids, so      *)
(* nothing a device builds on is void for the other readers. A device     *)
(* voiding what a fresh reader accepts is a preemption of its unsent ops, *)
(* which NoPreemption excludes.                                           *)
ReadersAgree ==
  \A d \in Devices : Reader.voids \subseteq JudgeFrom(1, doc[d], {}).voids

(* Every refusal of a device, and so every rebase, is paid for by its own  *)
(* recreation: the resubmission after a rebase is never refused.           *)
RebaseCannotLoop ==
  \A d \in Devices :
    gen[d] + (IF phase[d] = "refused" THEN 1 ELSE 0) <= recreations

Committed(v) == \E op \in Reader.held : op[3] = v

(* Every honest edit's content is eventually committed and accepted by     *)
(* readers, possibly under a rebased peer.                                 *)
HonestWorkEventuallyCommitted ==
  \A d \in Devices, k \in 1..MaxEdits :
    (edits[d] >= k) ~> Committed(Content(d, k))

=============================================================================
