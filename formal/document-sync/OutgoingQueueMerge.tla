------------------------ MODULE OutgoingQueueMerge ------------------------
EXTENDS FiniteSets, Naturals

(***************************************************************************)
(* Send-time merge of queued outgoing document updates (#2851).            *)
(*                                                                         *)
(* Two runtimes (tabs, or a tab and a worker) share one durable outgoing   *)
(* queue. Every local edit enqueues its own row under a fresh update id.   *)
(* A runtime's sync pass sends the queue in queue order; the server       *)
(* stores each new id with its content, refuses a whole request that      *)
(* repeats a stored id (409; the client re-encrypts every attempt, so a   *)
(* retry is never byte-identical), and settlement unqueues rows by id. A  *)
(* conflict runs the read-only recovery pass, which settles an id whose    *)
(* server copy matches the content captured at submit and re-keys every   *)
(* other submitted id that is still queued.                                *)
(*                                                                         *)
(* Before sending, the pass may replace a run of consecutive ordinary      *)
(* local rows with one row holding exactly their operations. The run is    *)
(* planned against the runtime's live document, which must prove every     *)
(* member, and is exported as each author's span from its first to its     *)
(* last member operation. The replacement takes the first member's queue   *)
(* position and a fresh update id. It runs only while the merging runtime  *)
(* has nothing in flight; the other runtime may have some of the members   *)
(* in flight, so the server may receive their operations twice.            *)
(*                                                                         *)
(* Three switches relax the merge rules, each set to the safe value in the *)
(* registered configuration:                                               *)
(*   MergeReusesId          the merged row keeps the first member's id     *)
(*   MergeAcrossCheckpoint  a run may skip a queued full-state row        *)
(*   MergeAcrossGap         a run may have an author-span gap, so the      *)
(*                          range export pulls in non-member operations   *)
(***************************************************************************)

CONSTANTS Runtimes, MaxOps, MaxRows, MaxIds,
          MergeReusesId, MergeAcrossCheckpoint, MergeAcrossGap

ASSUME /\ Runtimes # {}
       /\ IsFiniteSet(Runtimes)
       /\ MaxOps \in Nat \ {0}
       /\ MaxRows \in Nat \ {0}
       /\ MaxIds \in Nat \ {0}
       /\ MergeReusesId \in BOOLEAN
       /\ MergeAcrossCheckpoint \in BOOLEAN
       /\ MergeAcrossGap \in BOOLEAN

Ops == 1..MaxOps
Seqs == 1..MaxRows
Ids == 1..MaxIds
Kinds == {"local", "fullState"}
Phases == {"idle", "sent", "rekey"}
Payloads == [id : Ids, ops : SUBSET Ops]
Rows == [seq : Seqs, id : Ids, ops : SUBSET Ops, kind : Kinds,
         members : SUBSET Seqs]

(* `written` counts local operations; operation n is the n-th edit and     *)
(* `author[n]` the runtime (Loro peer) that made it. `doc[rt]` is the      *)
(* runtime's live document. `queue` is the durable outgoing queue; a row's *)
(* `seq` is its (created_at, rowid) position, `members` the positions of   *)
(* the rows it replaced, and `orig[s]` the operations row `s` was created  *)
(* with. `server` holds every accepted (id, content) pair. `lane[rt]`,     *)
(* `sent[rt]`, and `toRekey[rt]` are the runtime's in-flight request, the  *)
(* payloads it captured, and the ids recovery still has to re-key.         *)
VARIABLES written, author, doc, queue, orig, nextSeq, nextId, server,
          lane, sent, toRekey

vars == << written, author, doc, queue, orig, nextSeq, nextId, server,
           lane, sent, toRekey >>

Written == 1..written
QueuedOps == UNION {r.ops : r \in queue}
ServerOps == UNION {x.ops : x \in server}
ServerIds == {x.id : x \in server}
SentIds(rt) == {x.id : x \in sent[rt]}
Payload(r) == [id |-> r.id, ops |-> r.ops]
Row(seq, id, ops, kind, members) ==
  [seq |-> seq, id |-> id, ops |-> ops, kind |-> kind, members |-> members]
Min(S) == CHOOSE m \in S : \A n \in S : m <= n
Max(S) == CHOOSE m \in S : \A n \in S : m >= n

TypeOK ==
  /\ written \in 0..MaxOps
  /\ author \in [Ops -> Runtimes]
  /\ doc \in [Runtimes -> SUBSET Written]
  /\ queue \subseteq Rows
  /\ \A r, s \in queue : r.seq = s.seq => r = s
  /\ orig \in [Seqs -> SUBSET Ops]
  /\ nextSeq \in 1..(MaxRows + 1)
  /\ nextId \in 1..(MaxIds + 1)
  /\ server \subseteq Payloads
  /\ lane \in [Runtimes -> Phases]
  /\ sent \in [Runtimes -> SUBSET Payloads]
  /\ toRekey \in [Runtimes -> SUBSET Ids]

Init ==
  /\ written = 0
  /\ author = [o \in Ops |-> CHOOSE rt \in Runtimes : TRUE]
  /\ doc = [rt \in Runtimes |-> {}]
  /\ queue = {}
  /\ orig = [s \in Seqs |-> {}]
  /\ nextSeq = 1
  /\ nextId = 1
  /\ server = {}
  /\ lane = [rt \in Runtimes |-> "idle"]
  /\ sent = [rt \in Runtimes |-> {}]
  /\ toRekey = [rt \in Runtimes |-> {}]

(* A local write commits the operation and enqueues its own row under a    *)
(* fresh id in one transaction.                                            *)
Edit(rt) ==
  /\ written < MaxOps
  /\ nextSeq <= MaxRows
  /\ nextId <= MaxIds
  /\ LET op == written + 1 IN
       /\ written' = op
       /\ author' = [author EXCEPT ![op] = rt]
       /\ doc' = [doc EXCEPT ![rt] = @ \cup {op}]
       /\ queue' = queue \cup {Row(nextSeq, nextId, {op}, "local", {nextSeq})}
       /\ orig' = [orig EXCEPT ![nextSeq] = {op}]
  /\ nextSeq' = nextSeq + 1
  /\ nextId' = nextId + 1
  /\ UNCHANGED << server, lane, sent, toRekey >>

(* A rotation checkpoint (a row with a source version vector) or a         *)
(* remote-reset outbox row: the runtime's full history, never mergeable.   *)
(* The merge treats both alike, so one row kind stands for both.          *)
QueueFullState(rt) ==
  /\ doc[rt] # {}
  /\ nextSeq <= MaxRows
  /\ nextId <= MaxIds
  /\ queue' = queue \cup {Row(nextSeq, nextId, doc[rt], "fullState", {nextSeq})}
  /\ orig' = [orig EXCEPT ![nextSeq] = doc[rt]]
  /\ nextSeq' = nextSeq + 1
  /\ nextId' = nextId + 1
  /\ UNCHANGED << written, author, doc, server, lane, sent, toRekey >>

(* The pass sends the queue as it stands, in queue order.                 *)
BeginSubmit(rt) ==
  /\ lane[rt] = "idle"
  /\ queue # {}
  /\ sent' = [sent EXCEPT ![rt] = {Payload(r) : r \in queue}]
  /\ lane' = [lane EXCEPT ![rt] = "sent"]
  /\ UNCHANGED << written, author, doc, queue, orig, nextSeq, nextId, server,
                  toRekey >>

(* The server commits the whole request, or refuses all of it (409) when  *)
(* any id is already stored.                                               *)
Conflicted(rt) == SentIds(rt) \cap ServerIds # {}

Accept(rt) ==
  /\ lane[rt] = "sent"
  /\ IF Conflicted(rt) THEN UNCHANGED server
                       ELSE server' = server \cup sent[rt]
  /\ sent' = [sent EXCEPT ![rt] = {}]

(* The server answered, but the response never reaches the runtime. *)
LoseAck(rt) ==
  /\ Accept(rt)
  /\ lane' = [lane EXCEPT ![rt] = "idle"]
  /\ UNCHANGED << written, author, doc, queue, orig, nextSeq, nextId,
                  toRekey >>

(* The response arrives. Settlement unqueues by id. After a conflict,      *)
(* recovery settles only ids whose server copy matches the content         *)
(* captured at submit; the pulled page may omit any of them, so it settles *)
(* some subset and leaves the rest for Rekey.                              *)
Settle(rt) ==
  /\ Accept(rt)
  /\ IF Conflicted(rt)
       THEN \E settled \in SUBSET {x.id : x \in sent[rt] \cap server} :
              /\ queue' = {r \in queue : r.id \notin settled}
              /\ toRekey' = [toRekey EXCEPT ![rt] = SentIds(rt) \ settled]
              /\ lane' = [lane EXCEPT ![rt] = "rekey"]
       ELSE /\ queue' = {r \in queue : r.id \notin SentIds(rt)}
            /\ lane' = [lane EXCEPT ![rt] = "idle"]
            /\ UNCHANGED toRekey
  /\ UNCHANGED << written, author, doc, orig, nextSeq, nextId >>

(* Re-key every row still queued under an unsettled id: each takes a fresh *)
(* id in queue order. With no fresh id left a row keeps its id, as an      *)
(* exhausted rekey budget does.                                            *)
RekeyRows(rt) == {r \in queue : r.id \in toRekey[rt]}
RekeyedId(rt, r) ==
  nextId + Cardinality({s \in RekeyRows(rt) : s.seq < r.seq})

Rekey(rt) ==
  /\ lane[rt] = "rekey"
  /\ queue' = {IF r \in RekeyRows(rt) /\ RekeyedId(rt, r) <= MaxIds
                 THEN [r EXCEPT !.id = RekeyedId(rt, r)]
                 ELSE r : r \in queue}
  /\ nextId' = IF nextId + Cardinality(RekeyRows(rt)) <= MaxIds + 1
                 THEN nextId + Cardinality(RekeyRows(rt))
                 ELSE MaxIds + 1
  /\ lane' = [lane EXCEPT ![rt] = "idle"]
  /\ toRekey' = [toRekey EXCEPT ![rt] = {}]
  /\ UNCHANGED << written, author, doc, orig, nextSeq, server, sent >>

(* Restart reloads the live document from durable history, which holds    *)
(* every runtime's committed operations, and drops the request before it  *)
(* reaches the server; one the server answered first is LoseAck.          *)
Restart(rt) ==
  /\ doc' = [doc EXCEPT ![rt] = Written]
  /\ lane' = [lane EXCEPT ![rt] = "idle"]
  /\ sent' = [sent EXCEPT ![rt] = {}]
  /\ toRekey' = [toRekey EXCEPT ![rt] = {}]
  /\ UNCHANGED << written, author, queue, orig, nextSeq, nextId, server >>

(* --- Merge planning --------------------------------------------------- *)

MemberOps(g) == UNION {r.ops : r \in g}
GroupSeqs(g) == {r.seq : r \in g}

(* The live document proves an ordinary local row (updateMatchesDocument-  *)
(* History over a covered end vector).                                     *)
ProvesRow(rt, r) == r.kind = "local" /\ r.ops \subseteq doc[rt]

(* Queued rows strictly inside the run that are not members. *)
Skipped(g) ==
  {s \in queue : /\ Min(GroupSeqs(g)) < s.seq
                 /\ s.seq < Max(GroupSeqs(g))
                 /\ s \notin g}

ConsecutiveRun(g) ==
  \A s \in Skipped(g) : MergeAcrossCheckpoint /\ s.kind # "local"

(* The range export: per author, every operation the live document holds  *)
(* from the first to the last member operation.                            *)
AuthorSpan(rt, g, a) ==
  LET mine == {o \in MemberOps(g) : author[o] = a} IN
    IF mine = {} THEN {}
    ELSE {o \in doc[rt] : author[o] = a /\ Min(mine) <= o /\ o <= Max(mine)}

ExportedOps(rt, g) == UNION {AuthorSpan(rt, g, a) : a \in Runtimes}

(* No author-span gap: the export holds exactly the members' operations. *)
SpansContiguous(rt, g) == ExportedOps(rt, g) = MemberOps(g)

FirstMember(g) == CHOOSE r \in g : \A s \in g : r.seq <= s.seq

(* One replaceQueuedPendingUpdates transaction: every member still queued *)
(* under its id, the run consecutive, the first member updated in place,  *)
(* the rest deleted.                                                       *)
Merge(rt, g) ==
  /\ lane[rt] = "idle"
  /\ Cardinality(g) >= 2
  /\ \A r \in g : ProvesRow(rt, r)
  /\ ConsecutiveRun(g)
  /\ MergeAcrossGap \/ SpansContiguous(rt, g)
  /\ MergeReusesId \/ nextId <= MaxIds
  /\ LET first == FirstMember(g)
         id == IF MergeReusesId THEN first.id ELSE nextId
     IN queue' = (queue \ g)
                   \cup {Row(first.seq, id, ExportedOps(rt, g), "local",
                             UNION {r.members : r \in g})}
  /\ nextId' = IF MergeReusesId THEN nextId ELSE nextId + 1
  /\ UNCHANGED << written, author, doc, orig, nextSeq, server, lane, sent,
                  toRekey >>

Next ==
  \/ \E rt \in Runtimes :
       \/ Edit(rt)
       \/ QueueFullState(rt)
       \/ BeginSubmit(rt)
       \/ LoseAck(rt)
       \/ Settle(rt)
       \/ Rekey(rt)
       \/ Restart(rt)
       \/ \E g \in SUBSET queue : Merge(rt, g)

Spec == Init /\ [][Next]_vars

(* --- Invariants ------------------------------------------------------- *)

(* Every local operation is on the server or still queued. *)
NoLostLocalOps == Written \subseteq ServerOps \cup QueuedOps

(* An id never names two contents, whether stored by the server, captured *)
(* in a request, or queued.                                                *)
Bindings ==
  server \cup UNION {sent[rt] : rt \in Runtimes} \cup {Payload(r) : r \in queue}

ServerIdContentStable ==
  \A p, q \in Bindings : p.id = q.id => p.ops = q.ops

(* A row sits at its first member's position, and no member moved ahead   *)
(* of a row still queued between them.                                     *)
MergedRowKeepsPosition ==
  \A r \in queue :
    /\ r.seq = Min(r.members)
    /\ \A s \in queue : s.seq > r.seq => \A m \in r.members : m < s.seq

(* A row holds exactly the operations its members were created with. *)
MergedRowHoldsExactOps ==
  \A r \in queue : r.ops = UNION {orig[m] : m \in r.members}

=============================================================================
