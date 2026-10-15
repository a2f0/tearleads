-------------------------- MODULE ManifestHistory --------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS ReadBound, MaxHistory, IterativeVerification, CapMutations,
          MaxCitations, CiteHeldBytes, OmitOnlyCited, RefetchUncited
ASSUME /\ ReadBound > 0 /\ MaxHistory > ReadBound /\ MaxCitations \in Nat
       /\ {IterativeVerification, CapMutations, CiteHeldBytes, OmitOnlyCited,
           RefetchUncited} \subseteq BOOLEAN
\* history: the honest lineage 1..history; warm: server verification markers.
\* held: versions whose verified bundle bytes the device's durable table stores.
\* known: versions the device has ever verified; a hash list without bytes.
VARIABLES history, warm, revoked, held, known, honestRefused
vars == <<history, warm, revoked, held, known, honestRefused>>
Versions == 1..MaxHistory
Lineage == 1..history
\* The positive guard specifies the desired acceptance contract. Negative
\* controls exercise the two faulty budgets; runtime tests cover traversal.
Readable == IterativeVerification \/ warm \/ history <= ReadBound
MutationAllowed == Readable /\ (~CapMutations \/ history < ReadBound)
\* A request cites at most MaxCitations versions: from the bytes it holds, or
\* (faulty) from hashes whose bytes may have been evicted.
Citable == IF CiteHeldBytes THEN held ELSE known
\* The API omits a cited version of the walked lineage; a faulty API omits
\* whatever it believes the device verified, cited or not.
Omitted(cited) == IF OmitOnlyCited THEN cited \cap Lineage ELSE known \cap Lineage
\* The device rebuilds only from the exact bytes it cited and still holds.
Rebuilds(cited) == Omitted(cited) \subseteq (cited \cap held)
Init == /\ history = 1 /\ warm = FALSE /\ revoked = FALSE
        /\ held = {} /\ known = {} /\ honestRefused = FALSE
Commit == /\ history < MaxHistory /\ MutationAllowed
          /\ history' = history + 1 /\ warm' = TRUE
          /\ UNCHANGED <<revoked, held, known, honestRefused>>
Restart == /\ warm' = FALSE
           /\ UNCHANGED <<history, revoked, held, known, honestRefused>>
\* Eviction or loss of the device's bundle table, down to nothing. The
\* faulty hash-only variant keeps its hashes while the bytes go.
Evict == /\ \E kept \in SUBSET held : held' = kept
         /\ UNCHANGED <<history, warm, revoked, known, honestRefused>>
\* One projection read. A rebuild gap refetches once with no citations, which
\* the honest API always serves in full; otherwise the read is refused.
Read == /\ Readable
        /\ \E cited \in SUBSET Citable :
             /\ Cardinality(cited) <= MaxCitations
             /\ LET accepted == Rebuilds(cited) \/ RefetchUncited IN
                  /\ honestRefused' = (honestRefused \/ ~accepted)
                  /\ held' = IF accepted THEN held \cup Lineage ELSE held
                  /\ known' = IF accepted THEN known \cup Lineage ELSE known
        /\ warm' = TRUE /\ UNCHANGED <<history, revoked>>
Revoke == /\ ~revoked /\ MutationAllowed /\ revoked' = TRUE
          /\ history' = IF history < MaxHistory THEN history + 1 ELSE history
          /\ warm' = TRUE /\ UNCHANGED <<held, known, honestRefused>>
Next == Commit \/ Restart \/ Evict \/ Read \/ Revoke
Spec == Init /\ [][Next]_vars
TypeOK == /\ history \in Versions /\ warm \in BOOLEAN /\ revoked \in BOOLEAN
          /\ held \subseteq Versions /\ known \subseteq Versions
          /\ honestRefused \in BOOLEAN
HonestReadsAvailable == ENABLED Read
RevocationAvailable == ~revoked => ENABLED Revoke
\* No honest projection is ever refused, whatever the device evicted.
HonestCitedReadsAccepted == ~honestRefused
=============================================================================
