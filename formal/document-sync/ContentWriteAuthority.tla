--------------------- MODULE ContentWriteAuthority ---------------------
EXTENDS Naturals

(* A child pins parent 0. Parent 1 grants its group write; parent 2 removes *)
(* the writer and rematerializes that grant. Writes cite the current path. *)
(* The leaf may advance before a delayed document/blob write is read.      *)
(*                                                                         *)
(* The document is linked into that leaf and into a second container. One  *)
(* reader opens it through the leaf, the other only through the second     *)
(* link and never held the leaf's history. The writer writes through the   *)
(* leaf until the document is unlinked from it, after which the empty leaf *)
(* may be deleted. Every reader that can still open the document must be   *)
(* served the heads each committed write cites.                            *)
CONSTANTS RequireCurrentCitations, ReadPinnedParent, ReadCurrentMembership,
          RefreshMissingCitations,
          CheckWriteAuthority, \* the API refuses a write its cited path does not authorize
          ServeEveryWriteDependency, \* projections carry every write's cited path, not the reader's own
          RetainManifestsOnDelete    \* deleting a container keeps its signed manifests
VARIABLES parent, leaf, writes, refused, readerHeads, linked, deleted
vars == <<parent, leaf, writes, refused, readerHeads, linked, deleted>>

Readers == {"leafReader", "linkReader"}

(* Separate granted paths and group membership: head 0 has no grant;
   head 1 grants the existing group; head 2 cites its post-removal version. *)
ParentHeads == [head \in 0..2 |->
  [grantsWrite |-> head > 0, groupVersion |-> IF head = 2 THEN 1 ELSE 0]]
GroupMembers == [version \in 0..1 |->
  IF version = 0 THEN {"writer"} ELSE {}]
Authorized(pathHead, membershipHead) ==
  /\ ParentHeads[pathHead].grantsWrite
  /\ "writer" \in GroupMembers[ParentHeads[membershipHead].groupVersion]

(* The leaf reader opens the document while it stays linked to the leaf;  *)
(* the other link never goes away.                                         *)
CanOpen(reader) == reader = "linkReader" \/ linked

(* The cited heads a fresh projection serves a reader. A projection        *)
(* filtered to the reader's own authorized paths omits the leaf's path for *)
(* the reader on the other link; a deleted leaf whose manifests went with  *)
(* it leaves no path to serve.                                             *)
Served(reader) ==
  IF deleted /\ ~RetainManifestsOnDelete THEN {}
  ELSE IF reader = "leafReader" \/ ServeEveryWriteDependency THEN 0..parent
  ELSE {}

Init == /\ parent = 0
        /\ leaf = 0
        /\ writes = {}
        /\ refused = FALSE
        /\ readerHeads = [reader \in Readers |->
                            IF reader = "leafReader" THEN {0} ELSE {}]
        /\ linked = TRUE
        /\ deleted = FALSE

AdvanceParent ==
  /\ parent < 2
  /\ parent' = parent + 1
  /\ UNCHANGED <<leaf, writes, refused, readerHeads, linked, deleted>>

AdvanceLeaf ==
  /\ leaf = 0
  /\ ~deleted
  /\ leaf' = 1
  /\ UNCHANGED <<parent, writes, refused, readerHeads, linked, deleted>>

(* A write may cite any head, authorized or not: a revoked writer can still *)
(* submit one. The API commits it only when the cited path authorizes it.  *)
CommitWrite(citation) ==
  /\ linked
  /\ citation \in 0..parent
  /\ (~RequireCurrentCitations \/ citation = parent)
  /\ CheckWriteAuthority => Authorized(citation, citation)
  /\ writes' = writes \cup {<<citation, leaf, parent>>}
  /\ UNCHANGED <<parent, leaf, refused, readerHeads, linked, deleted>>

(* The document leaves the leaf; it stays linked to the other container.   *)
Unlink ==
  /\ linked
  /\ linked' = FALSE
  /\ UNCHANGED <<parent, leaf, writes, refused, readerHeads, deleted>>

(* The API deletes a container only once no user document is linked to it. *)
DeleteLeaf ==
  /\ ~linked
  /\ ~deleted
  /\ deleted' = TRUE
  /\ UNCHANGED <<parent, leaf, writes, refused, readerHeads, linked>>

ReadWrite(reader, write) ==
  /\ CanOpen(reader)
  /\ write \in writes
  /\ LET citedParent == IF ReadPinnedParent /\ write[2] # leaf
                         THEN 0 ELSE write[1]
         membership == IF ReadCurrentMembership THEN parent ELSE citedParent
         held == IF citedParent \notin readerHeads[reader]
                         /\ RefreshMissingCitations
                   THEN Served(reader) ELSE readerHeads[reader]
     IN (* One refresh, then the frozen response is verified. *)
        /\ readerHeads' = [readerHeads EXCEPT ![reader] = held]
        /\ refused' = (refused \/ citedParent \notin held
                                \/ ~Authorized(citedParent, membership))
  /\ UNCHANGED <<parent, leaf, writes, linked, deleted>>

Next == \/ AdvanceParent
        \/ AdvanceLeaf
        \/ \E citation \in 0..2 : CommitWrite(citation)
        \/ Unlink
        \/ DeleteLeaf
        \/ \E reader \in Readers, write \in writes : ReadWrite(reader, write)
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK == /\ parent \in 0..2
          /\ leaf \in 0..1
          /\ writes \subseteq (0..2) \X (0..1) \X (0..2)
          /\ refused \in BOOLEAN
          /\ readerHeads \in [Readers -> SUBSET (0..parent)]
          /\ linked \in BOOLEAN
          /\ deleted \in BOOLEAN
HonestWritesRemainReadable == ~refused
NewWritesUseCurrentAuthority == \A write \in writes : write[1] = write[3]
CommittedWritesAreAuthorized == \A write \in writes : Authorized(write[1], write[1])
(* Every reader that can open the document is served every committed       *)
(* write's cited head, whichever link it opens the document through.       *)
CitedHeadsReachEveryReader ==
  \A reader \in Readers, write \in writes :
    CanOpen(reader) => write[1] \in Served(reader)
========================================================================
