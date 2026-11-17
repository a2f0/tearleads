----------------------- MODULE EnvelopeSetReference -----------------------
(* A principal policy successor in an unchanged key epoch may send its     *)
(* member envelopes as changes to its predecessor's set instead of in full *)
(* (#2903 P17). The server rebuilds the full set from the envelopes stored *)
(* for the cited predecessor, which never change once written, stores it  *)
(* only when it matches the root the author signed, and recognizes a      *)
(* replay by the rebuilt request, so a retry in either form is answered as *)
(* the commit it repeats. Envelope sets are sets of member ids; the signed *)
(* root is the set itself (a collision-free hash).                         *)
EXTENDS Naturals, FiniteSets
CONSTANTS Members, MaxVersion, CheckRoot, HashRebuilt
ASSUME CheckRoot \in BOOLEAN /\ HashRebuilt \in BOOLEAN

Sets == (SUBSET Members) \ {{}}
NoMsg == [v |-> 0, target |-> {}, full |-> TRUE, adds |-> {}, removes |-> {}]

VARIABLES
  head,       \* current state version on the server
  stored,     \* version -> envelope set stored for that state
  signed,     \* version -> envelope set the author signed for that state
  acked,      \* committed versions whose acknowledgement reached the author
  sent,       \* the in-flight request, or NoMsg
  outcomes,   \* replay keys of committed requests
  refusedOwn  \* a retry of the author's own committed state was refused
vars == <<head, stored, signed, acked, sent, outcomes, refusedOwn>>

Init ==
  /\ head = 1
  /\ \E s \in Sets:
       /\ stored = [v \in 1..MaxVersion |-> IF v = 1 THEN s ELSE {}]
       /\ signed = stored
  /\ acked = {1}
  /\ sent = NoMsg
  /\ outcomes = {}
  /\ refusedOwn = FALSE

(* Changes from `basis` to `target`; an honest author's basis is the       *)
(* predecessor's set, a faulty one's may be any set.                       *)
Changes(v, target, basis) ==
  [v |-> v, target |-> target, full |-> FALSE,
   adds |-> target \ basis, removes |-> basis \ target]
Full(v, target) ==
  [v |-> v, target |-> target, full |-> TRUE, adds |-> {}, removes |-> {}]

Rebuild(msg) ==
  IF msg.full THEN msg.target
  ELSE (stored[msg.v - 1] \ msg.removes) \cup msg.adds

ReplayKey(msg) ==
  IF HashRebuilt THEN <<msg.v, Rebuild(msg)>>
  ELSE <<msg.v, msg.full, msg.target, msg.adds, msg.removes>>

Author ==
  /\ sent = NoMsg
  /\ head \in acked
  /\ head < MaxVersion
  /\ \E target \in Sets, basis \in SUBSET Members:
       /\ sent' \in {Full(head + 1, target), Changes(head + 1, target, basis)}
       /\ signed' = [signed EXCEPT ![head + 1] = target]
  /\ UNCHANGED <<head, stored, acked, outcomes, refusedOwn>>

Commit ==
  /\ sent # NoMsg
  /\ IF ReplayKey(sent) \in outcomes
       THEN /\ acked' = acked \cup {sent.v}
            /\ UNCHANGED <<head, stored, outcomes, refusedOwn>>
     ELSE IF /\ head = sent.v - 1
             /\ \/ ~CheckRoot
                \/ Rebuild(sent) = signed[sent.v]
       THEN /\ head' = sent.v
            /\ stored' = [stored EXCEPT ![sent.v] = Rebuild(sent)]
            /\ outcomes' = outcomes \cup {ReplayKey(sent)}
            /\ \E delivered \in BOOLEAN:
                 acked' = IF delivered THEN acked \cup {sent.v} ELSE acked
            /\ UNCHANGED refusedOwn
       ELSE /\ refusedOwn' = (sent.v <= head)
            /\ UNCHANGED <<head, stored, outcomes, acked>>
  /\ sent' = NoMsg
  /\ UNCHANGED signed

(* The acknowledgement was lost: the author resends its signed state, in   *)
(* either form, with honest changes from its predecessor.                  *)
Retry ==
  /\ sent = NoMsg
  /\ head \notin acked
  /\ sent' \in {Full(head, signed[head]),
                Changes(head, signed[head], signed[head - 1])}
  /\ UNCHANGED <<head, stored, signed, acked, outcomes, refusedOwn>>

(* Every version is used and acknowledged. *)
Done ==
  /\ head = MaxVersion /\ head \in acked /\ sent = NoMsg
  /\ UNCHANGED vars

Next == Author \/ Commit \/ Retry \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ head \in 1..MaxVersion
  /\ stored \in [1..MaxVersion -> SUBSET Members]
  /\ acked \subseteq 1..MaxVersion
  /\ refusedOwn \in BOOLEAN

(* Every stored state holds exactly the envelope set its author signed. *)
StoredMatchesSigned == \A v \in 1..head: stored[v] = signed[v]
(* A retry of a committed state is answered as committed, never refused. *)
OwnCommitNeverRefused == ~refusedOwn
=============================================================================
