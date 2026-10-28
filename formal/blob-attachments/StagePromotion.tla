--------------------------- MODULE StagePromotion ---------------------------
EXTENDS FiniteSets, Naturals

(***************************************************************************)
(* The server-side blob lifecycle across the database and the object       *)
(* store, which share no transaction. A client opens a stage, a multipart  *)
(* upload under the stage's own storage key, and uploads parts. Attachment *)
(* binding completes the upload before its transaction, verifies the       *)
(* assembled object against the declared digest, marks the stage complete, *)
(* and then, in one transaction holding the stage row, promotes it into a  *)
(* blob row that keeps the stage key and binds it to a document. A bind    *)
(* may also attach an existing blob. Detach, replacement and document      *)
(* purge mark a blob dereferenced once nothing binds it; the hourly sweep  *)
(* reclaims dereferenced blobs and deletes their objects afterwards, and   *)
(* cleans up expired stages.                                               *)
(***************************************************************************)

CONSTANTS Stages, BlobIds, Docs, None,
          CheckAssembledHash,      \* refuse and delete an object whose digest differs
          PromoteRequiresUnexpired,\* promotion refuses an expired stage
          ExpiryLocksStageRow,     \* cleanup claims a stage by writing its row
          DeleteStageOnPromote,    \* promotion consumes the stage row
          CheckRegistryOnPromote,  \* a blob id in the registry is never promoted again
          ReviveOnBind,            \* a bind clears its blob's dereferenced mark
          GcRechecksReference,     \* the sweep revives a blob that is still bound
          PurgeLocksBlobs,         \* document purge decides orphans under blob locks
          DeleteObjectAfterAbort   \* cleanup deletes the stage key after aborting

ASSUME /\ IsFiniteSet(Stages) /\ IsFiniteSet(BlobIds) /\ IsFiniteSet(Docs)
       /\ None \notin Stages \cup BlobIds \cup Docs
       /\ \A flag \in {CheckAssembledHash, PromoteRequiresUnexpired,
                       ExpiryLocksStageRow, DeleteStageOnPromote,
                       CheckRegistryOnPromote, ReviveOnBind,
                       GcRechecksReference, PurgeLocksBlobs,
                       DeleteObjectAfterAbort} : flag \in BOOLEAN

VARIABLES
  stage,       \* stage row: "none", "pending", "complete", or "gone"
  expired,     \* the stage's one-hour lifetime has passed
  upload,      \* object-store multipart upload: "none", "open", or "consumed"
  object,      \* object at the stage key: "none", "good", or "bad" bytes
  binder,      \* staged bind: "idle", "loaded", "assembled", "verified", "locked"
  bindTo,      \* <<blob id, document>> a staged bind targets, or None
  cleaner,     \* expiry cleanup of a stage: "idle", "claimed", or "stored"
  sawComplete, \* cleanup read the stage as complete when it claimed it
  blob,        \* blob row: "none", "live", or "deref" (dereferenced)
  blobKey,     \* stage key a blob row stores, or None
  audit,       \* registry row: "none", "live", "pruned", or "deleted"
  auditKey,    \* storage key the registry row still holds, or None
  binding,     \* each document's active binding, or None
  purged,      \* documents purged
  scanned,     \* orphans an unlocked purge computed before committing, or None
  lost         \* the sweep deleted a blob some document still bound

vars == << stage, expired, upload, object, binder, bindTo, cleaner,
           sawComplete, blob, blobKey, audit, auditKey, binding, purged,
           scanned, lost >>

LiveStage == {"pending", "complete"}

TypeOK ==
  /\ stage \in [Stages -> {"none", "pending", "complete", "gone"}]
  /\ expired \in [Stages -> BOOLEAN]
  /\ upload \in [Stages -> {"none", "open", "consumed"}]
  /\ object \in [Stages -> {"none", "good", "bad"}]
  /\ binder \in [Stages -> {"idle", "loaded", "assembled", "verified",
                            "locked"}]
  /\ bindTo \in [Stages -> (BlobIds \X Docs) \cup {None}]
  /\ cleaner \in [Stages -> {"idle", "claimed", "stored"}]
  /\ sawComplete \in [Stages -> BOOLEAN]
  /\ blob \in [BlobIds -> {"none", "live", "deref"}]
  /\ blobKey \in [BlobIds -> Stages \cup {None}]
  /\ audit \in [BlobIds -> {"none", "live", "pruned", "deleted"}]
  /\ auditKey \in [BlobIds -> Stages \cup {None}]
  /\ binding \in [Docs -> BlobIds \cup {None}]
  /\ purged \in SUBSET Docs
  /\ scanned \in [Docs -> (SUBSET BlobIds) \cup {None}]
  /\ lost \in BOOLEAN

Init ==
  /\ stage = [s \in Stages |-> "none"]
  /\ expired = [s \in Stages |-> FALSE]
  /\ upload = [s \in Stages |-> "none"]
  /\ object = [s \in Stages |-> "none"]
  /\ binder = [s \in Stages |-> "idle"]
  /\ bindTo = [s \in Stages |-> None]
  /\ cleaner = [s \in Stages |-> "idle"]
  /\ sawComplete = [s \in Stages |-> FALSE]
  /\ blob = [b \in BlobIds |-> "none"]
  /\ blobKey = [b \in BlobIds |-> None]
  /\ audit = [b \in BlobIds |-> "none"]
  /\ auditKey = [b \in BlobIds |-> None]
  /\ binding = [d \in Docs |-> None]
  /\ purged = {}
  /\ scanned = [d \in Docs |-> None]
  /\ lost = FALSE

(* A document accepts attachment mutations unless purged or mid-purge:     *)
(* purge holds the document head for its whole transaction.                *)
Writable(d) == d \notin purged /\ scanned[d] = None

BoundElsewhere(b, bindings) == \E d \in Docs : bindings[d] = b

(* Removing the last active reference starts the reclamation clock         *)
(* (`markBlobDereferencedIfInactive`, under the blob row lock).            *)
MarkIfUnbound(blobs, released, bindings) ==
  [b \in BlobIds |->
     IF b = released /\ blobs[b] = "live" /\ ~BoundElsewhere(b, bindings)
       THEN "deref"
       ELSE blobs[b]]

----------------------------------------------------------------------------
(* Stage lifecycle *)

OpenStage(s) ==
  /\ stage[s] = "none"
  /\ stage' = [stage EXCEPT ![s] = "pending"]
  /\ upload' = [upload EXCEPT ![s] = "open"]
  /\ UNCHANGED << expired, object, binder, bindTo, cleaner, sawComplete, blob,
                  blobKey, audit, auditKey, binding, purged, scanned, lost >>

(* Time passes: the stage's lifetime ends.                                 *)
Expire(s) ==
  /\ stage[s] \in LiveStage
  /\ ~expired[s]
  /\ expired' = [expired EXCEPT ![s] = TRUE]
  /\ UNCHANGED << stage, upload, object, binder, bindTo, cleaner, sawComplete,
                  blob, blobKey, audit, auditKey, binding, purged, scanned,
                  lost >>

----------------------------------------------------------------------------
(* A staged bind. Prevalidation runs outside any transaction; only the     *)
(* last two steps hold the stage row.                                      *)

BindLoad(s, b, d) ==
  /\ binder[s] = "idle"
  /\ stage[s] \in LiveStage
  /\ ~expired[s]
  /\ Writable(d)
  /\ binder' = [binder EXCEPT ![s] = "loaded"]
  /\ bindTo' = [bindTo EXCEPT ![s] = <<b, d>>]
  /\ UNCHANGED << stage, expired, upload, object, cleaner, sawComplete, blob,
                  blobKey, audit, auditKey, binding, purged, scanned, lost >>

Fail(s) ==
  /\ binder' = [binder EXCEPT ![s] = "idle"]
  /\ bindTo' = [bindTo EXCEPT ![s] = None]

(* Complete the multipart upload. The uploaded parts may assemble to       *)
(* bytes other than the declared digest. A consumed upload falls back to   *)
(* re-verifying whatever object survives at the key.                       *)
BindAssemble(s) ==
  /\ binder[s] = "loaded"
  /\ IF upload[s] = "open"
       THEN \E content \in {"good", "bad"} :
              /\ object' = [object EXCEPT ![s] = content]
              /\ upload' = [upload EXCEPT ![s] = "consumed"]
              /\ binder' = [binder EXCEPT ![s] = "assembled"]
              /\ UNCHANGED bindTo
       ELSE /\ IF object[s] # "none"
                 THEN /\ binder' = [binder EXCEPT ![s] = "assembled"]
                      /\ UNCHANGED bindTo
                 ELSE Fail(s)
            /\ UNCHANGED << object, upload >>
  /\ UNCHANGED << stage, expired, cleaner, sawComplete, blob, blobKey, audit,
                  auditKey, binding, purged, scanned, lost >>

(* Verify the digest, then flip the row to complete. The flip is a plain   *)
(* update that changes nothing once cleanup has deleted the row.           *)
BindVerify(s) ==
  /\ binder[s] = "assembled"
  /\ IF CheckAssembledHash /\ object[s] = "bad"
       THEN /\ object' = [object EXCEPT ![s] = "none"]
            /\ Fail(s)
            /\ UNCHANGED stage
       ELSE /\ stage' = [stage EXCEPT ![s] =
                           IF @ \in LiveStage THEN "complete" ELSE @]
            /\ binder' = [binder EXCEPT ![s] = "verified"]
            /\ UNCHANGED << object, bindTo >>
  /\ UNCHANGED << expired, upload, cleaner, sawComplete, blob, blobKey, audit,
                  auditKey, binding, purged, scanned, lost >>

(* The bind transaction locks the stage row and requires it complete and   *)
(* unexpired. Expiry may still pass while the lock is held.                *)
BindLock(s) ==
  /\ binder[s] = "verified"
  /\ IF /\ stage[s] = "complete"
        /\ PromoteRequiresUnexpired => ~expired[s]
       THEN /\ binder' = [binder EXCEPT ![s] = "locked"]
            /\ UNCHANGED bindTo
       ELSE Fail(s)
  /\ UNCHANGED << stage, expired, upload, object, cleaner, sawComplete, blob,
                  blobKey, audit, auditKey, binding, purged, scanned, lost >>

(* Promote and bind in the same transaction: the blob row keeps the stage  *)
(* key, the registry records the id, and the replaced blob is marked if    *)
(* nothing else binds it.                                                  *)
BindPromote(s) ==
  /\ binder[s] = "locked"
  /\ LET b == bindTo[s][1]
         d == bindTo[s][2]
         newBinding == [binding EXCEPT ![d] = b]
     IN IF /\ blob[b] = "none"
           /\ CheckRegistryOnPromote => audit[b] = "none"
           /\ Writable(d)
          THEN /\ blob' = [MarkIfUnbound(blob, binding[d], newBinding)
                             EXCEPT ![b] = "live"]
               /\ blobKey' = [blobKey EXCEPT ![b] = s]
               /\ audit' = [audit EXCEPT ![b] = IF @ = "none" THEN "live" ELSE @]
               /\ auditKey' = [auditKey EXCEPT ![b] =
                                 IF audit[b] = "none" THEN s ELSE @]
               /\ binding' = newBinding
               /\ stage' = [stage EXCEPT ![s] =
                              IF DeleteStageOnPromote THEN "gone" ELSE @]
          ELSE UNCHANGED << blob, blobKey, audit, auditKey, binding, stage >>
  /\ Fail(s)
  /\ UNCHANGED << expired, upload, object, cleaner, sawComplete, purged,
                  scanned, lost >>

(* Attach a blob that already exists, locking its row first.               *)
BindExisting(b, d) ==
  /\ Writable(d)
  /\ blob[b] \in {"live", "deref"}
  /\ binding[d] # b
  /\ LET newBinding == [binding EXCEPT ![d] = b]
         marked == MarkIfUnbound(blob, binding[d], newBinding)
     IN /\ blob' = [marked EXCEPT ![b] = IF ReviveOnBind THEN "live" ELSE @]
        /\ binding' = newBinding
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, cleaner,
                  sawComplete, blobKey, audit, auditKey, purged, scanned,
                  lost >>

Detach(d) ==
  /\ Writable(d)
  /\ binding[d] # None
  /\ LET newBinding == [binding EXCEPT ![d] = None]
     IN /\ blob' = MarkIfUnbound(blob, binding[d], newBinding)
        /\ binding' = newBinding
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, cleaner,
                  sawComplete, blobKey, audit, auditKey, purged, scanned,
                  lost >>

----------------------------------------------------------------------------
(* Document purge deletes the document's bindings and marks the blobs no   *)
(* other document binds. Production locks those blobs before deciding;     *)
(* without the lock the decision and the commit are separate steps.        *)

Orphans(d) ==
  IF binding[d] = None THEN {}
  ELSE IF \E other \in Docs \ {d} : binding[other] = binding[d] THEN {}
  ELSE {binding[d]}

CommitPurge(d, orphans) ==
  /\ binding' = [binding EXCEPT ![d] = None]
  /\ blob' = [b \in BlobIds |->
                IF b \in orphans /\ blob[b] = "live" THEN "deref" ELSE blob[b]]
  /\ purged' = purged \cup {d}

Purge(d) ==
  /\ PurgeLocksBlobs
  /\ Writable(d)
  /\ CommitPurge(d, Orphans(d))
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, cleaner,
                  sawComplete, blobKey, audit, auditKey, scanned, lost >>

PurgeScan(d) ==
  /\ ~PurgeLocksBlobs
  /\ Writable(d)
  /\ scanned' = [scanned EXCEPT ![d] = Orphans(d)]
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, cleaner,
                  sawComplete, blob, blobKey, audit, auditKey, binding, purged,
                  lost >>

PurgeCommit(d) ==
  /\ scanned[d] # None
  /\ CommitPurge(d, scanned[d])
  /\ scanned' = [scanned EXCEPT ![d] = None]
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, cleaner,
                  sawComplete, blobKey, audit, auditKey, lost >>

----------------------------------------------------------------------------
(* The hourly sweep. *)

(* Reclaim one dereferenced blob under its row lock. A blob that is still  *)
(* bound is revived. Otherwise the registry row must still name the blob's *)
(* storage key, or the transaction throws and the blob waits for a retry   *)
(* that changes nothing. Reclaiming deletes the blob's bindings with it.   *)
Reclaim(b) ==
  /\ blob[b] = "deref"
  /\ IF GcRechecksReference /\ BoundElsewhere(b, binding)
       THEN /\ blob' = [blob EXCEPT ![b] = "live"]
            /\ UNCHANGED << blobKey, audit, auditKey, binding, lost >>
       ELSE /\ audit[b] = "live"
            /\ auditKey[b] = blobKey[b]
            /\ lost' = (lost \/ BoundElsewhere(b, binding))
            /\ binding' = [d \in Docs |->
                             IF binding[d] = b THEN None ELSE binding[d]]
            /\ blob' = [blob EXCEPT ![b] = "none"]
            /\ blobKey' = [blobKey EXCEPT ![b] = None]
            /\ audit' = [audit EXCEPT ![b] = "pruned"]
            /\ UNCHANGED auditKey
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, cleaner,
                  sawComplete, purged, scanned >>

(* Delete a reclaimed blob's object, then record it.                       *)
DeletePrunedObject(b) ==
  /\ audit[b] = "pruned"
  /\ object' = [object EXCEPT ![auditKey[b]] = "none"]
  /\ audit' = [audit EXCEPT ![b] = "deleted"]
  /\ auditKey' = [auditKey EXCEPT ![b] = None]
  /\ UNCHANGED << stage, expired, upload, binder, bindTo, cleaner, sawComplete,
                  blob, blobKey, binding, purged, scanned, lost >>

(* Claim an expired stage by writing its row, which waits for a bind       *)
(* transaction holding it; once that promotes the stage, no row is left to *)
(* claim. A plain read instead sees the row as it was before the commit.   *)
CleanupClaim(s) ==
  /\ cleaner[s] = "idle"
  /\ stage[s] \in LiveStage
  /\ expired[s]
  /\ ExpiryLocksStageRow => binder[s] # "locked"
  /\ cleaner' = [cleaner EXCEPT ![s] = "claimed"]
  /\ sawComplete' = [sawComplete EXCEPT ![s] = (stage[s] = "complete")]
  /\ UNCHANGED << stage, expired, upload, object, binder, bindTo, blob,
                  blobKey, audit, auditKey, binding, purged, scanned, lost >>

(* A stage read as complete has its object deleted; otherwise the upload   *)
(* is aborted, and an abort that finds no upload counts as done.           *)
CleanupStorage(s) ==
  /\ cleaner[s] = "claimed"
  /\ IF sawComplete[s]
       THEN /\ object' = [object EXCEPT ![s] = "none"]
            /\ UNCHANGED upload
       ELSE /\ upload' = [upload EXCEPT ![s] = "consumed"]
            /\ object' = [object EXCEPT ![s] =
                            IF DeleteObjectAfterAbort THEN "none" ELSE @]
  /\ cleaner' = [cleaner EXCEPT ![s] = "stored"]
  /\ UNCHANGED << stage, expired, binder, bindTo, sawComplete, blob, blobKey,
                  audit, auditKey, binding, purged, scanned, lost >>

CleanupRow(s) ==
  /\ cleaner[s] = "stored"
  /\ stage' = [stage EXCEPT ![s] = IF @ \in LiveStage THEN "gone" ELSE @]
  /\ cleaner' = [cleaner EXCEPT ![s] = "idle"]
  /\ UNCHANGED << expired, upload, object, binder, bindTo, sawComplete, blob,
                  blobKey, audit, auditKey, binding, purged, scanned, lost >>

(* Every behavior is finite; stuttering is not a stuck protocol.           *)
Idle == UNCHANGED vars

Next ==
  \/ \E s \in Stages :
       \/ OpenStage(s) \/ Expire(s)
       \/ \E b \in BlobIds, d \in Docs : BindLoad(s, b, d)
       \/ BindAssemble(s) \/ BindVerify(s) \/ BindLock(s) \/ BindPromote(s)
       \/ CleanupClaim(s) \/ CleanupStorage(s) \/ CleanupRow(s)
  \/ \E b \in BlobIds, d \in Docs : BindExisting(b, d)
  \/ \E d \in Docs : Detach(d) \/ Purge(d) \/ PurgeScan(d) \/ PurgeCommit(d)
  \/ \E b \in BlobIds : Reclaim(b) \/ DeletePrunedObject(b)
  \/ Idle

(* A bind that started runs to its end, a started purge commits, and the   *)
(* sweep keeps running. Clients need not open, bind, detach or purge.      *)
Fairness ==
  /\ \A s \in Stages :
       /\ WF_vars(BindAssemble(s)) /\ WF_vars(BindVerify(s))
       /\ WF_vars(BindLock(s)) /\ WF_vars(BindPromote(s))
       /\ WF_vars(CleanupClaim(s)) /\ WF_vars(CleanupStorage(s))
       /\ WF_vars(CleanupRow(s))
  /\ \A d \in Docs : WF_vars(PurgeCommit(d))
  /\ \A b \in BlobIds : WF_vars(Reclaim(b)) /\ WF_vars(DeletePrunedObject(b))

Spec == Init /\ [][Next]_vars /\ Fairness

----------------------------------------------------------------------------
(* Properties *)

(* Every blob row's object exists and holds the declared bytes.            *)
BlobsHoldDeclaredBytes ==
  \A b \in BlobIds :
    blob[b] # "none" => object[blobKey[b]] = "good"

(* The sweep never deletes a blob some document still binds.               *)
SweepKeepsBoundBlobs == ~lost

(* A live blob is bound somewhere; one nothing binds is marked, so the     *)
(* sweep will find it.                                                     *)
UnboundBlobsAreMarked ==
  \A b \in BlobIds : blob[b] = "live" => BoundElsewhere(b, binding)

(* Every object in the store has a record that will remove it: its stage   *)
(* row, a blob row, or a reclaimed blob's pending deletion.                *)
NoOrphanObjects ==
  \A s \in Stages :
    object[s] # "none" =>
      \/ stage[s] \in LiveStage
      \/ \E b \in BlobIds : blob[b] # "none" /\ blobKey[b] = s
      \/ \E b \in BlobIds : audit[b] = "pruned" /\ auditKey[b] = s

(* Expired stages are cleaned up, and dereferenced blobs are revived or    *)
(* reclaimed and their objects deleted.                                    *)
ExpiredStagesAreCleared ==
  \A s \in Stages : (expired[s] /\ stage[s] \in LiveStage) ~> stage[s] = "gone"

DereferencedBlobsAreSettled ==
  \A b \in BlobIds : blob[b] = "deref" ~> blob[b] # "deref"

PrunedObjectsAreDeleted ==
  \A b \in BlobIds : audit[b] = "pruned" ~> audit[b] = "deleted"

=============================================================================
