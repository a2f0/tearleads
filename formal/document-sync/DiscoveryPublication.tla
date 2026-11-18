---- MODULE DiscoveryPublication ----
EXTENDS Naturals, FiniteSets
CONSTANT SerializePublication
Rows == {"live", "removal"}
VARIABLES phase, order, nextOrder, watermark, applied
vars == <<phase, order, nextOrder, watermark, applied>>

Init == /\ phase = [r \in Rows |-> "writing"]
        /\ order = [r \in Rows |-> 0]
        /\ nextOrder = 1 /\ watermark = 0 /\ applied = {}

\* Each mutation may do arbitrary work before locking the publication counter.
\* Aborted reservations are conservatively allowed to leave a gap.
Publish(r) ==
  /\ phase[r] = "writing"
  /\ ~SerializePublication \/ \A t \in Rows : phase[t] # "publishing"
  /\ phase' = [phase EXCEPT ![r] = "publishing"]
  /\ order' = [order EXCEPT ![r] = nextOrder]
  /\ nextOrder' = nextOrder + 1
  /\ UNCHANGED <<watermark, applied>>

Finish(r, outcome) ==
  /\ phase[r] = "publishing"
  /\ phase' = [phase EXCEPT ![r] = outcome]
  /\ UNCHANGED <<order, nextOrder, watermark, applied>>

\* A single-statement page sees a single snapshot across both sources.
\* Page size one exposes every possible stop/resume boundary; no hints arrive.
Read ==
  LET eligible == {r \in Rows : phase[r] = "committed" /\ order[r] > watermark}
  IN /\ eligible # {}
     /\ LET r == CHOOSE r \in eligible : \A t \in eligible : order[r] <= order[t]
        IN /\ applied' = applied \cup {r} /\ watermark' = order[r]
     /\ UNCHANGED <<phase, order, nextOrder>>

Next == \/ Read
        \/ \E r \in Rows : Publish(r) \/ Finish(r, "committed") \/ Finish(r, "aborted")
        \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars /\ WF_vars(Read)
NeverSkip == \A r \in Rows :
  phase[r] = "committed" /\ order[r] <= watermark => r \in applied
Converges == \A r \in Rows : [](phase[r] = "committed" => <> (r \in applied))
====
