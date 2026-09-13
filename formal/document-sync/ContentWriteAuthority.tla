--------------------- MODULE ContentWriteAuthority ---------------------
EXTENDS Naturals

(* A child pins parent 0. Parent 1 grants its group write; parent 2 removes *)
(* the writer and rematerializes that grant. Writes cite the current path. *)
(* The leaf may advance before a delayed document/blob write is read.      *)
CONSTANTS RequireCurrentCitations, ReadPinnedParent, ReadCurrentMembership
VARIABLES parent, leaf, writes, refused, invalidCommit
vars == <<parent, leaf, writes, refused, invalidCommit>>

Init == /\ parent = 0
        /\ leaf = 0
        /\ writes = {}
        /\ refused = FALSE
        /\ invalidCommit = FALSE

AdvanceParent ==
  /\ parent < 2
  /\ parent' = parent + 1
  /\ UNCHANGED <<leaf, writes, refused, invalidCommit>>

AdvanceLeaf ==
  /\ leaf = 0
  /\ leaf' = 1
  /\ UNCHANGED <<parent, writes, refused, invalidCommit>>

CommitWrite(citation) ==
  /\ citation \in 0..parent
  /\ (~RequireCurrentCitations \/ citation = parent)
  /\ citation = 1
  /\ writes' = writes \cup {<<citation, leaf>>}
  /\ invalidCommit' = (invalidCommit \/ citation # parent)
  /\ UNCHANGED <<parent, leaf, refused>>

ReadWrite(write) ==
  /\ write \in writes
  /\ LET citedParent == IF ReadPinnedParent /\ write[2] # leaf
                         THEN 0 ELSE write[1]
         membership == IF ReadCurrentMembership THEN parent ELSE citedParent
     IN refused' = (refused \/ citedParent # 1 \/ membership # 1)
  /\ UNCHANGED <<parent, leaf, writes, invalidCommit>>

Next == \/ AdvanceParent
        \/ AdvanceLeaf
        \/ \E citation \in 0..2 : CommitWrite(citation)
        \/ \E write \in writes : ReadWrite(write)
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK == /\ parent \in 0..2
          /\ leaf \in 0..1
          /\ writes \subseteq (0..2) \X (0..1)
          /\ refused \in BOOLEAN
          /\ invalidCommit \in BOOLEAN
HonestWritesRemainReadable == ~refused
NewWritesUseCurrentAuthority == ~invalidCommit
========================================================================
