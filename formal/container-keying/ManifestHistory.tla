-------------------------- MODULE ManifestHistory --------------------------
EXTENDS Naturals
CONSTANTS ReadBound, MaxHistory, IterativeVerification, CapMutations
ASSUME /\ ReadBound > 0 /\ MaxHistory > ReadBound
       /\ {IterativeVerification, CapMutations} \subseteq BOOLEAN
VARIABLES history, warm, revoked
vars == <<history, warm, revoked>>
Readable == IterativeVerification \/ warm \/ history <= ReadBound
MutationAllowed == Readable /\ (~CapMutations \/ history < ReadBound)
Init == /\ history = 1 /\ warm = FALSE /\ revoked = FALSE
Commit == /\ history < MaxHistory /\ MutationAllowed
          /\ history' = history + 1 /\ warm' = TRUE /\ UNCHANGED revoked
Restart == /\ warm' = FALSE /\ UNCHANGED <<history, revoked>>
Read == /\ Readable /\ warm' = TRUE /\ UNCHANGED <<history, revoked>>
Revoke == /\ ~revoked /\ MutationAllowed /\ revoked' = TRUE
          /\ history' = IF history < MaxHistory THEN history + 1 ELSE history
          /\ warm' = TRUE
Next == Commit \/ Restart \/ Read \/ Revoke
Spec == Init /\ [][Next]_vars
TypeOK == /\ history \in 1..MaxHistory /\ warm \in BOOLEAN /\ revoked \in BOOLEAN
HonestReadsAvailable == ENABLED Read
RevocationAvailable == ~revoked => ENABLED Revoke
=============================================================================
