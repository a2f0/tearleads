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
          RetainManifestsOnDelete,   \* deleting a container keeps its signed manifests
          RekeyBeforeFrontierLock    \* a write's carried rekeys apply before the head lock
VARIABLES parent, leaf, writes, refused, readerHeads, linked, deleted,
          parentEpoch
vars == <<parent, leaf, writes, refused, readerHeads, linked, deleted,
          parentEpoch>>

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
        /\ parentEpoch = 0

AdvanceParent ==
  /\ parent < 2
  /\ parent' = parent + 1
  /\ UNCHANGED <<leaf, writes, refused, readerHeads, linked, deleted,
                 parentEpoch>>

AdvanceLeaf ==
  /\ leaf = 0
  /\ ~deleted
  /\ leaf' = 1
  /\ UNCHANGED <<parent, writes, refused, readerHeads, linked, deleted,
                 parentEpoch>>

(* A write may cite any head, authorized or not: a revoked writer can still *)
(* submit one. The API commits it only when the cited path authorizes it.  *)
(* The request may carry a signed rekey of the parent, which gives it a    *)
(* new key epoch without changing its grants. The client cites the head    *)
(* the rekey produces. The API applies carried rekeys, then locks the      *)
(* heads FOR SHARE and checks the citation against the rows that lock      *)
(* read, which nothing else can change until commit. A rekey applied after *)
(* the lock would leave those rows stale within the same transaction.      *)
(* A write records <<cited head, leaf, head at commit, cited epoch, epoch  *)
(* at commit>>.                                                            *)
CommitWrite(citation, citedEpoch, carriesRekey) ==
  /\ linked
  /\ citation \in 0..parent
  /\ carriesRekey => parentEpoch = 0
  /\ LET committedEpoch == IF carriesRekey THEN 1 ELSE parentEpoch
         lockedEpoch == IF RekeyBeforeFrontierLock THEN committedEpoch
                        ELSE parentEpoch
     IN (* A client cites an epoch that exists or that its own rekey makes. *)
        /\ citedEpoch <= committedEpoch
        /\ RequireCurrentCitations =>
             (citation = parent /\ citedEpoch = lockedEpoch)
        /\ CheckWriteAuthority => Authorized(citation, citation)
        /\ writes' = writes \cup
                       {<<citation, leaf, parent, citedEpoch, committedEpoch>>}
        /\ parentEpoch' = committedEpoch
  /\ UNCHANGED <<parent, leaf, refused, readerHeads, linked, deleted>>

(* The document leaves the leaf; it stays linked to the other container.   *)
Unlink ==
  /\ linked
  /\ linked' = FALSE
  /\ UNCHANGED <<parent, leaf, writes, refused, readerHeads, deleted,
                 parentEpoch>>

(* The API deletes a container only once no user document is linked to it. *)
DeleteLeaf ==
  /\ ~linked
  /\ ~deleted
  /\ deleted' = TRUE
  /\ UNCHANGED <<parent, leaf, writes, refused, readerHeads, linked,
                 parentEpoch>>

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
  /\ UNCHANGED <<parent, leaf, writes, linked, deleted, parentEpoch>>

Next == \/ AdvanceParent
        \/ AdvanceLeaf
        \/ \E citation \in 0..2, citedEpoch \in 0..1, carriesRekey \in BOOLEAN :
             CommitWrite(citation, citedEpoch, carriesRekey)
        \/ Unlink
        \/ DeleteLeaf
        \/ \E reader \in Readers, write \in writes : ReadWrite(reader, write)
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK == /\ parent \in 0..2
          /\ leaf \in 0..1
          /\ writes \subseteq (0..2) \X (0..1) \X (0..2) \X (0..1) \X (0..1)
          /\ refused \in BOOLEAN
          /\ readerHeads \in [Readers -> SUBSET (0..parent)]
          /\ linked \in BOOLEAN
          /\ deleted \in BOOLEAN
          /\ parentEpoch \in 0..1
HonestWritesRemainReadable == ~refused
(* Submission freshness: a committed write cites the parent head, and its  *)
(* key epoch, that are current when it commits.                           *)
NewWritesUseCurrentAuthority ==
  \A write \in writes : write[1] = write[3] /\ write[4] = write[5]
CommittedWritesAreAuthorized == \A write \in writes : Authorized(write[1], write[1])
(* Every reader that can open the document is served every committed       *)
(* write's cited head, whichever link it opens the document through.       *)
CitedHeadsReachEveryReader ==
  \A reader \in Readers, write \in writes :
    CanOpen(reader) => write[1] \in Served(reader)
========================================================================
