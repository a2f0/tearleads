-------------------------- MODULE PrincipalHistory -------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Principals, OldCeiling, MaxHistory, BatchSize, CapWrites, CapReads
ASSUME /\ Principals # {} /\ OldCeiling > 0 /\ MaxHistory > OldCeiling
       /\ BatchSize > 0 /\ {CapWrites, CapReads} \subseteq BOOLEAN
VARIABLES version, verified, revoked
vars == <<version, verified, revoked>>

\* Version summarizes a contiguous, authorized signed chain. Cryptographic
\* validity and key rotation are premises, exercised by implementation tests.
Init == /\ version = [p \in Principals |-> 1]
        /\ verified = [p \in Principals |-> 0]
        /\ revoked = {}
WriteAllowed(p) == ~CapWrites \/ version[p] < OldCeiling
Commit(p) == /\ version[p] < MaxHistory /\ WriteAllowed(p)
             /\ version' = [version EXCEPT ![p] = @ + 1]
             /\ UNCHANGED <<verified, revoked>>
\* Reserve one successor beyond the explored normal history for revocation;
\* the finite exploration bound must not itself invent a refusal.
Revoke(p) == /\ p \notin revoked /\ WriteAllowed(p)
             /\ version' = [version EXCEPT ![p] = @ + 1]
             /\ revoked' = revoked \cup {p}
             /\ UNCHANGED verified
Recover(p) == /\ verified[p] < version[p]
              /\ (~CapReads \/ version[p] <= OldCeiling)
              /\ verified' = [verified EXCEPT ![p] =
                    IF @ + BatchSize < version[p] THEN @ + BatchSize
                    ELSE version[p]]
              /\ UNCHANGED <<version, revoked>>
LoseCaches == /\ verified' = [p \in Principals |-> 0]
              /\ UNCHANGED <<version, revoked>>
Next == (\E p \in Principals: Commit(p) \/ Revoke(p) \/ Recover(p)) \/ LoseCaches
Spec == Init /\ [][Next]_vars
TypeOK == /\ version \in [Principals -> 1..(MaxHistory + 1)]
          /\ verified \in [Principals -> 0..(MaxHistory + 1)]
          /\ \A p \in Principals: verified[p] <= version[p]
          /\ revoked \subseteq Principals
RevocationAvailable == \A p \in Principals: p \notin revoked => ENABLED Revoke(p)
RecoveryCanProgress == \A p \in Principals:
                        verified[p] < version[p] => ENABLED Recover(p)
=============================================================================
