--------------------- MODULE ContentWriteAuthority ---------------------
EXTENDS Naturals

(* A child pins parent 0. Parent 1 grants its group write; parent 2 removes *)
(* the writer and rematerializes that grant. Writes cite the current path. *)
(* The leaf may advance before a delayed document/blob write is read.      *)
CONSTANTS RequireCurrentCitations, ReadPinnedParent, ReadCurrentMembership,
          RefreshMissingCitations, RequireScopedCitations
VARIABLES parent, leaf, writes, refused, readerHeads
vars == <<parent, leaf, writes, refused, readerHeads>>

(* Separate granted paths and group membership: head 0 has no grant;
   head 1 grants the existing group; head 2 cites its post-removal version. *)
ParentHeads == [head \in 0..2 |->
  [grantsWrite |-> head > 0, groupVersion |-> IF head = 2 THEN 1 ELSE 0]]
GroupMembers == [version \in 0..1 |->
  IF version = 0 THEN {"writer"} ELSE {}]
Authorized(pathHead, membershipHead) ==
  /\ ParentHeads[pathHead].grantsWrite
  /\ "writer" \in GroupMembers[ParentHeads[membershipHead].groupVersion]

CitationScopes == {"linked", "ancestor", "unlinked", "foreign"}
ScopedCitations == {"linked", "ancestor"}

Init == /\ parent = 0
        /\ leaf = 0
        /\ writes = {}
        /\ refused = FALSE
        /\ readerHeads = {0}

AdvanceParent ==
  /\ parent < 2
  /\ parent' = parent + 1
  /\ UNCHANGED <<leaf, writes, refused, readerHeads>>

AdvanceLeaf ==
  /\ leaf = 0
  /\ leaf' = 1
  /\ UNCHANGED <<parent, writes, refused, readerHeads>>

CommitWrite(citation, extraScope) ==
  /\ citation \in 0..parent
  /\ (~RequireCurrentCitations \/ citation = parent)
  /\ Authorized(citation, citation)
  /\ extraScope \in CitationScopes
  /\ (~RequireScopedCitations \/ extraScope \in ScopedCitations)
  /\ writes' = writes \cup {<<citation, leaf, parent, extraScope>>}
  /\ UNCHANGED <<parent, leaf, refused, readerHeads>>

ReadWrite(write) ==
  /\ write \in writes
  /\ LET citedParent == IF ReadPinnedParent /\ write[2] # leaf
                         THEN 0 ELSE write[1]
         membership == IF ReadCurrentMembership THEN parent ELSE citedParent
     IN IF citedParent \notin readerHeads /\ RefreshMissingCitations
          THEN /\ readerHeads' = 0..parent
               /\ UNCHANGED refused
          ELSE /\ readerHeads' = readerHeads
               /\ refused' = (refused \/ citedParent \notin readerHeads
                                       \/ ~Authorized(citedParent, membership)
                                       \/ write[4] \notin ScopedCitations)
  /\ UNCHANGED <<parent, leaf, writes>>

Next == \/ AdvanceParent
        \/ AdvanceLeaf
        \/ \E citation \in 0..2, extraScope \in CitationScopes :
             CommitWrite(citation, extraScope)
        \/ \E write \in writes : ReadWrite(write)
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK == /\ parent \in 0..2
          /\ leaf \in 0..1
          /\ writes \subseteq (0..2) \X (0..1) \X (0..2) \X CitationScopes
          /\ refused \in BOOLEAN
          /\ readerHeads \subseteq 0..parent
HonestWritesRemainReadable == ~refused
NewWritesUseCurrentAuthority == \A write \in writes : write[1] = write[3]
CitationsStayInDocumentScope == \A write \in writes : write[4] \in ScopedCitations
========================================================================
