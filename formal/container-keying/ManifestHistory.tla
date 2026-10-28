-------------------------- MODULE ManifestHistory --------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS ReadBound, MaxHistory, IterativeVerification, CapMutations,
          MaxCitations, CiteHeldBytes, OmitOnlyCited, RefetchUncited,
          SameKekBudget, ReciteCeiling, RotationBypassesBudget
ASSUME /\ ReadBound > 0 /\ MaxHistory > ReadBound /\ MaxCitations \in Nat
       /\ SameKekBudget \in Nat \ {0} /\ ReciteCeiling \in Nat \ {0}
       /\ {IterativeVerification, CapMutations, CiteHeldBytes, OmitOnlyCited,
           RefetchUncited, RotationBypassesBudget} \subseteq BOOLEAN
\* history: the honest lineage 1..history; warm: server verification markers.
\* held: versions whose verified bundle bytes the device's durable table stores.
\* known: versions the device has ever verified; a hash list without bytes.
\* sameKek: manifests committed under the current container key, which the
\* API caps; a rotation (rekey or revoke) starts a new key.
VARIABLES history, warm, revoked, held, known, honestRefused, sameKek
vars == <<history, warm, revoked, held, known, honestRefused, sameKek>>
Versions == 1..MaxHistory
Lineage == 1..history
\* The positive guard specifies the desired acceptance contract. Negative
\* controls exercise the two faulty budgets; runtime tests cover traversal.
Readable == IterativeVerification \/ warm \/ history <= ReadBound
MutationAllowed == Readable /\ (~CapMutations \/ history < ReadBound)
\* Production refuses a same-key mutation past the budget ("rekey
\* required") and a recite at or past an absolute epoch ceiling. A rotation
\* starts a new key, so it must not itself be refused by the same-key budget.
WithinSameKekBudget == sameKek < SameKekBudget
RotationAllowed == MutationAllowed /\ (RotationBypassesBudget \/ WithinSameKekBudget)
\* A request cites at most MaxCitations versions: from the bytes it holds, or
\* (faulty) from hashes whose bytes may have been evicted.
Citable == IF CiteHeldBytes THEN held ELSE known
\* The API omits a cited version of the walked lineage; a faulty API omits
\* whatever it believes the device verified, cited or not.
Omitted(cited) == IF OmitOnlyCited THEN cited \cap Lineage ELSE known \cap Lineage
\* The device rebuilds only from the exact bytes it cited and still holds.
Rebuilds(cited) == Omitted(cited) \subseteq (cited \cap held)
Init == /\ history = 1 /\ warm = FALSE /\ revoked = FALSE
        /\ held = {} /\ known = {} /\ honestRefused = FALSE /\ sameKek = 1
\* A share or grant change under the current key.
Commit == /\ history < MaxHistory /\ MutationAllowed /\ WithinSameKekBudget
          /\ history' = history + 1 /\ warm' = TRUE /\ sameKek' = sameKek + 1
          /\ UNCHANGED <<revoked, held, known, honestRefused>>
\* A re-citation under the current key, refused at the epoch ceiling.
Recite == /\ history < MaxHistory /\ MutationAllowed /\ WithinSameKekBudget
          /\ history < ReciteCeiling
          /\ history' = history + 1 /\ warm' = TRUE /\ sameKek' = sameKek + 1
          /\ UNCHANGED <<revoked, held, known, honestRefused>>
\* A rekey rotates the container key, starting a new same-key budget.
Rekey == /\ history < MaxHistory /\ RotationAllowed
         /\ history' = history + 1 /\ warm' = TRUE /\ sameKek' = 1
         /\ UNCHANGED <<revoked, held, known, honestRefused>>
Restart == /\ warm' = FALSE
           /\ UNCHANGED <<history, revoked, held, known, honestRefused, sameKek>>
\* Eviction or loss of the device's bundle table, down to nothing. The
\* faulty hash-only variant keeps its hashes while the bytes go.
Evict == /\ \E kept \in SUBSET held : held' = kept
         /\ UNCHANGED <<history, warm, revoked, known, honestRefused, sameKek>>
\* One projection read. A rebuild gap refetches once with no citations, which
\* the honest API always serves in full; otherwise the read is refused.
Read == /\ Readable
        /\ \E cited \in SUBSET Citable :
             /\ Cardinality(cited) <= MaxCitations
             /\ LET accepted == Rebuilds(cited) \/ RefetchUncited IN
                  /\ honestRefused' = (honestRefused \/ ~accepted)
                  /\ held' = IF accepted THEN held \cup Lineage ELSE held
                  /\ known' = IF accepted THEN known \cup Lineage ELSE known
        /\ warm' = TRUE /\ UNCHANGED <<history, revoked, sameKek>>
\* A revoke rotates the container key as well.
Revoke == /\ ~revoked /\ RotationAllowed /\ revoked' = TRUE
          /\ history' = IF history < MaxHistory THEN history + 1 ELSE history
          /\ warm' = TRUE /\ sameKek' = 1
          /\ UNCHANGED <<held, known, honestRefused>>
Next == Commit \/ Recite \/ Rekey \/ Restart \/ Evict \/ Read \/ Revoke
Spec == Init /\ [][Next]_vars
TypeOK == /\ history \in Versions /\ warm \in BOOLEAN /\ revoked \in BOOLEAN
          /\ held \subseteq Versions /\ known \subseteq Versions
          /\ honestRefused \in BOOLEAN /\ sameKek \in 1..MaxHistory
HonestReadsAvailable == ENABLED Read
RevocationAvailable == ~revoked => ENABLED Revoke
\* Neither the same-key budget nor the recite ceiling strands a container:
\* a rekey stays available, and after it a share is again.
RekeyAvailable == history < MaxHistory => ENABLED Rekey
\* No honest projection is ever refused, whatever the device evicted.
HonestCitedReadsAccepted == ~honestRefused
=============================================================================
