------------------- MODULE DeferredTailSettlement -------------------
EXTENDS FiniteSets, Naturals

(* Device-first tail coverage. A guarded durable start linearizes its fixed *)
(* effect; stale completion cannot publish into a replacement or remove B. *)

CONSTANTS Ops, Identities, MaxGeneration

(* Each identity is one abstract token for the local/remote identifiers,   *)
(* container, access epoch/hash/level, and content-keying context.         *)

ASSUME /\ Ops # {}
       /\ IsFiniteSet(Ops)
       /\ Identities # {}
       /\ IsFiniteSet(Identities)
       /\ MaxGeneration \in Nat \ {0}
VARIABLES snapshot, durableSnapshot, durableBase, workingBase, queued, remote,
          durableRemoteRows,
          lane, capturedFrontier, capturedCoverage, capturedGeneration,
          capturedIdentity, rerunRequested,
          localPresent, durablePresent, authoritativelyDeleted,
          liveIdentity, liveGeneration,
          responseIdentity, responseGeneration, responseIncoming,
          responseAccepted, responseDeletes, responsePending,
          durableOp, allPublicationsMatchedContext
coverageVars == << snapshot, durableSnapshot, durableBase, workingBase,
                  queued, remote, durableRemoteRows >>
captureVars == << capturedFrontier, capturedCoverage, capturedGeneration,
                  capturedIdentity, rerunRequested >>
responseVars == << responseIdentity, responseGeneration, responseIncoming,
                   responseAccepted, responseDeletes, responsePending >>
durableOpVars == << durableOp >>
auditVars == << allPublicationsMatchedContext >>
presenceVars == << localPresent, durablePresent, authoritativelyDeleted >>
livePublicationVars == << snapshot, workingBase, localPresent,
                          authoritativelyDeleted, liveIdentity, liveGeneration >>
vars == << coverageVars, lane, captureVars, presenceVars, liveIdentity,
           liveGeneration, responseVars, durableOpVars, auditVars >>
RetainedTail == snapshot \ durableBase
SemanticCoverage == workingBase \cup queued
HasDurableWork == queued # {} \/ RetainedTail # {}
ActivePass == lane \in {"captured", "materialized", "planned", "persisting",
                        "prepared"}
NoDurableOp == durableOp = "none"
CaptureIsLive ==
  /\ capturedGeneration = liveGeneration
  /\ capturedIdentity = liveIdentity
StaleCapture == ~CaptureIsLive
ResponseIsLive ==
  /\ responseGeneration = liveGeneration
  /\ responseIdentity = liveIdentity
DurableOpIsLive ==
  CASE durableOp = "marker" -> CaptureIsLive
    [] durableOp \in {"response", "delete"} -> ResponseIsLive
    [] OTHER -> TRUE
TypeOK ==
  /\ snapshot \subseteq Ops /\ durableSnapshot \subseteq Ops
  /\ snapshot \subseteq durableSnapshot /\ durableBase \subseteq durableSnapshot
  /\ workingBase \subseteq snapshot /\ queued \subseteq durableSnapshot
  /\ remote \subseteq durableSnapshot
  /\ durableRemoteRows \subseteq durableSnapshot
  /\ durableRemoteRows \subseteq remote
  /\ lane \in {"idle", "running", "captured", "materialized", "planned",
                "persisting", "prepared", "complete"}
  /\ capturedFrontier \subseteq snapshot /\ capturedCoverage \subseteq snapshot
  /\ capturedGeneration \in 0..MaxGeneration /\ capturedIdentity \in Identities
  /\ rerunRequested \in BOOLEAN
  /\ localPresent \in BOOLEAN /\ durablePresent \in BOOLEAN
  /\ authoritativelyDeleted \in BOOLEAN
  /\ liveIdentity \in Identities /\ liveGeneration \in 0..MaxGeneration
  /\ responseIdentity \in Identities /\ responseGeneration \in 0..MaxGeneration
  /\ responseIncoming \subseteq Ops /\ responseAccepted \subseteq Ops
  /\ responseDeletes \in BOOLEAN /\ responsePending \in BOOLEAN
  /\ durableOp \in {"none", "marker", "tail", "response", "delete"}
  /\ allPublicationsMatchedContext \in BOOLEAN
Init ==
  /\ snapshot = {} /\ durableSnapshot = {} /\ durableBase = {}
  /\ workingBase = {} /\ queued = {} /\ remote = {}
  /\ durableRemoteRows = {}
  /\ lane = "idle"
  /\ liveIdentity \in Identities /\ liveGeneration = 0
  /\ capturedFrontier = {} /\ capturedCoverage = {} /\ capturedGeneration = 0
  /\ capturedIdentity = liveIdentity /\ rerunRequested = FALSE
  /\ localPresent = TRUE /\ durablePresent = TRUE
  /\ authoritativelyDeleted = FALSE
  /\ responseIdentity = liveIdentity /\ responseGeneration = 0
  /\ responseIncoming = {} /\ responseAccepted = {}
  /\ responseDeletes = FALSE /\ responsePending = FALSE
  /\ durableOp = "none" /\ allPublicationsMatchedContext = TRUE
QueueEdit(op) ==
  /\ localPresent
  /\ op \in Ops \ snapshot
  /\ snapshot' = snapshot \cup {op}
  /\ durableSnapshot' = durableSnapshot \cup {op}
  /\ queued' = queued \cup (snapshot \ workingBase) \cup {op}
  /\ workingBase' = snapshot \cup {op}
  /\ lane' = IF lane \in {"idle", "complete"} THEN "running" ELSE lane
  /\ rerunRequested' = (rerunRequested \/ ActivePass)
  /\ UNCHANGED << durableBase, remote, durableRemoteRows,
                  capturedFrontier, capturedCoverage,
                  capturedGeneration, capturedIdentity, presenceVars,
                  liveIdentity, liveGeneration, responseVars, durableOpVars,
                  auditVars >>
DeferEdit(op) ==
  /\ localPresent
  /\ op \in Ops \ snapshot
  /\ snapshot' = snapshot \cup {op}
  /\ durableSnapshot' = durableSnapshot \cup {op}
  /\ UNCHANGED << durableBase, workingBase, queued, remote,
                  durableRemoteRows, lane,
                  capturedFrontier, capturedCoverage, rerunRequested,
                  capturedGeneration, capturedIdentity, presenceVars,
                  liveIdentity, liveGeneration, responseVars, durableOpVars,
                  auditVars >>
Prime ==
  /\ localPresent
  /\ lane \in {"idle", "complete"}
  /\ HasDurableWork
  /\ lane' = "running"
  /\ UNCHANGED << coverageVars, captureVars, presenceVars, liveIdentity,
                  liveGeneration, responseVars, durableOpVars, auditVars >>
CapturePreparation ==
  /\ localPresent
  /\ lane = "running"
  /\ capturedFrontier' = snapshot
  /\ capturedCoverage' = SemanticCoverage
  /\ capturedGeneration' = liveGeneration
  /\ capturedIdentity' = liveIdentity
  /\ lane' = "captured"
  /\ rerunRequested' = FALSE
  /\ UNCHANGED << coverageVars, presenceVars, liveIdentity, liveGeneration,
                  responseVars, durableOpVars, auditVars >>
MaterializeCapturedTail ==
  /\ localPresent
  /\ lane = "captured"
  /\ ~(capturedFrontier \subseteq capturedCoverage)
  /\ queued' = queued \cup (capturedFrontier \ capturedCoverage)
  /\ capturedCoverage' = capturedFrontier
  /\ lane' = "materialized"
  /\ UNCHANGED << snapshot, durableSnapshot, durableBase, workingBase, remote,
                  durableRemoteRows,
                  capturedFrontier, capturedGeneration, capturedIdentity,
                  rerunRequested, presenceVars, liveIdentity, liveGeneration,
                  responseVars, durableOpVars, auditVars >>
CapturedCoverageIsComplete ==
  capturedFrontier \subseteq capturedCoverage

ResetCapturedPass ==
  /\ lane' = IF HasDurableWork THEN "running" ELSE "idle"
  /\ capturedFrontier' = {}
  /\ capturedCoverage' = {}
  /\ capturedGeneration' = liveGeneration
  /\ capturedIdentity' = liveIdentity
  /\ rerunRequested' = FALSE

RecordPublication(matched) ==
  allPublicationsMatchedContext' =
    allPublicationsMatchedContext /\ matched

PlanMarkerPersist ==
  /\ localPresent /\ NoDurableOp
  /\ lane \in {"captured", "materialized"}
  /\ CaptureIsLive /\ CapturedCoverageIsComplete
  /\ capturedCoverage' = workingBase \cup capturedFrontier
  /\ lane' = "planned"
  /\ UNCHANGED << coverageVars, capturedFrontier, capturedGeneration,
                  capturedIdentity, rerunRequested, presenceVars, liveIdentity,
                  liveGeneration, responseVars, durableOpVars, auditVars >>
StartMarkerPersist ==
  /\ localPresent /\ NoDurableOp
  /\ lane = "planned" /\ CaptureIsLive
  /\ durableBase' = capturedCoverage
  /\ lane' = "persisting"
  /\ durableOp' = "marker"
  /\ UNCHANGED << snapshot, durableSnapshot, workingBase, queued, remote,
                  durableRemoteRows,
                  captureVars, presenceVars, liveIdentity, liveGeneration,
                  responseVars, auditVars >>
CompleteLiveMarkerPersist ==
  /\ durableOp = "marker"
  /\ CaptureIsLive
  /\ workingBase' = workingBase \cup capturedCoverage
  /\ lane' = "prepared"
  /\ durableOp' = "none"
  /\ RecordPublication(CaptureIsLive)
  /\ UNCHANGED << snapshot, durableSnapshot, durableBase, queued, remote,
                  durableRemoteRows, captureVars, presenceVars,
                  liveIdentity, liveGeneration, responseVars >>
CompleteStaleMarkerPersist ==
  /\ durableOp = "marker"
  /\ StaleCapture
  /\ ResetCapturedPass
  /\ durableOp' = "none"
  /\ UNCHANGED << coverageVars, presenceVars, liveIdentity, liveGeneration,
                  responseVars, auditVars >>
BeginSyncResponse(incoming, accepted, deletes) ==
  /\ localPresent
  /\ NoDurableOp
  /\ lane = "prepared"
  /\ CaptureIsLive
  /\ ~responsePending
  /\ incoming \subseteq Ops
  /\ accepted \subseteq (queued \cap capturedFrontier)
  /\ deletes \in BOOLEAN
  /\ (deletes => (incoming = {} /\ accepted = {}))
  /\ responseIdentity' = liveIdentity
  /\ responseGeneration' = liveGeneration
  /\ responseIncoming' = incoming
  /\ responseAccepted' = accepted
  /\ responseDeletes' = deletes
  /\ responsePending' = TRUE
  /\ UNCHANGED << coverageVars, lane, captureVars, presenceVars,
                  liveIdentity, liveGeneration, durableOpVars, auditVars >>

Relink(nextIdentity) ==
  /\ localPresent
  /\ NoDurableOp
  /\ (responsePending \/ ActivePass)
  /\ nextIdentity \in Identities \ {liveIdentity}
  /\ liveIdentity' = nextIdentity
  /\ rerunRequested' = TRUE
  /\ UNCHANGED << coverageVars, lane, capturedFrontier, capturedCoverage,
                  capturedGeneration, capturedIdentity, presenceVars,
                  liveGeneration, responseVars, durableOpVars, auditVars >>

ResetReinitialize(nextIdentity) ==
  /\ localPresent
  /\ liveGeneration < MaxGeneration
  /\ nextIdentity \in Identities
  /\ liveGeneration' = liveGeneration + 1
  /\ liveIdentity' = nextIdentity
  /\ snapshot' = durableSnapshot
  /\ workingBase' = durableBase \cup durableRemoteRows
  /\ rerunRequested' = TRUE
  /\ UNCHANGED << durableSnapshot, durableBase, queued, remote,
                  durableRemoteRows, lane,
                  capturedFrontier, capturedCoverage, capturedGeneration,
                  capturedIdentity, presenceVars, responseVars,
                  durableOpVars, auditVars >>

AbortStalePreparation ==
  /\ localPresent
  /\ NoDurableOp
  /\ lane \in {"captured", "materialized", "planned", "prepared"}
  /\ StaleCapture
  /\ ResetCapturedPass
  /\ UNCHANGED << coverageVars, presenceVars, liveIdentity, liveGeneration,
                  responseVars, durableOpVars, auditVars >>

ClearResponse ==
  /\ responsePending' = FALSE
  /\ responseIncoming' = {}
  /\ responseAccepted' = {}
  /\ responseDeletes' = FALSE

(* Durable history tail append of the pulled updates — its own durable *)
(* write, landing BEFORE the record persist, as the implementation *)
(* orders them: a crash between the two leaves remote-origin tail rows *)
(* whose coverage the persisted marker does not yet carry. *)
StartResponseTailAppend ==
  /\ localPresent
  /\ responsePending
  /\ NoDurableOp
  /\ ResponseIsLive
  /\ ~(responseIncoming \subseteq durableRemoteRows)
  /\ durableSnapshot' = durableSnapshot \cup responseIncoming
  /\ durableRemoteRows' = durableRemoteRows \cup responseIncoming
  /\ remote' = remote \cup responseIncoming
  /\ durableOp' = "tail"
  /\ UNCHANGED << snapshot, durableBase, workingBase, queued, lane,
                  captureVars, presenceVars, liveIdentity, liveGeneration,
                  responseVars, auditVars >>

CompleteResponseTailAppend ==
  /\ durableOp = "tail"
  /\ durableOp' = "none"
  /\ UNCHANGED << coverageVars, lane, captureVars, presenceVars,
                  liveIdentity, liveGeneration, responseVars, auditVars >>

StartResponseDurableOp ==
  /\ localPresent
  /\ responsePending
  /\ NoDurableOp
  /\ ResponseIsLive
  /\ responseIncoming \subseteq durableRemoteRows
  /\ durableBase' = durableBase \cup responseIncoming
  /\ queued' = queued \ responseAccepted
  /\ remote' = remote \cup responseAccepted
  /\ durablePresent' = IF responseDeletes THEN FALSE ELSE durablePresent
  /\ durableOp' = IF responseDeletes THEN "delete" ELSE "response"
  /\ UNCHANGED << snapshot, durableSnapshot, durableRemoteRows, workingBase,
                  lane, captureVars, localPresent,
                  authoritativelyDeleted, liveIdentity, liveGeneration,
                  responseVars, auditVars >>

CompleteLiveResponsePersist ==
  /\ durableOp = "response"
  /\ ResponseIsLive
  /\ snapshot' = snapshot \cup responseIncoming
  /\ workingBase' = workingBase \cup responseIncoming
  /\ ClearResponse
  /\ durableOp' = "none"
  /\ RecordPublication(ResponseIsLive)
  /\ UNCHANGED << durableSnapshot, durableBase, queued, remote,
                  durableRemoteRows, lane,
                  captureVars, presenceVars, liveIdentity,
                  liveGeneration, responseIdentity, responseGeneration >>

CompleteLiveDeletion ==
  /\ durableOp = "delete"
  /\ ResponseIsLive
  /\ localPresent' = FALSE
  /\ authoritativelyDeleted' = TRUE
  /\ ClearResponse
  /\ durableOp' = "none"
  /\ RecordPublication(ResponseIsLive)
  /\ UNCHANGED << coverageVars, lane, captureVars, liveIdentity,
                  liveGeneration, responseIdentity, responseGeneration,
                  durablePresent >>

CompleteStaleResponseDurableOp ==
  /\ durableOp \in {"response", "delete"}
  /\ ~ResponseIsLive
  /\ ClearResponse
  /\ durableOp' = "none"
  /\ UNCHANGED << coverageVars, lane, captureVars, presenceVars,
                  liveIdentity, liveGeneration, responseIdentity,
                  responseGeneration, auditVars >>

CancelOrIgnoreResponse ==
  /\ responsePending
  /\ NoDurableOp
  /\ ClearResponse
  /\ UNCHANGED << coverageVars, lane, captureVars, presenceVars,
                  liveIdentity, liveGeneration, responseIdentity,
                  responseGeneration, durableOpVars, auditVars >>

CompleteCapturedPass ==
  /\ localPresent
  /\ lane = "prepared"
  /\ CaptureIsLive
  /\ ~responsePending
  /\ capturedFrontier \cap queued = {}
  /\ capturedFrontier \subseteq durableBase
  /\ lane' = IF rerunRequested THEN "running" ELSE "complete"
  /\ UNCHANGED << coverageVars, capturedFrontier, capturedCoverage,
                  capturedGeneration, capturedIdentity, rerunRequested,
                  presenceVars, liveIdentity, liveGeneration, responseVars,
                  durableOpVars, auditVars >>

(* Restart restores content from the durable store and the marker from *)
(* the persisted base EXTENDED across remote-origin tail rows: their *)
(* provenance proves the server holds them, so a crash between the tail *)
(* append and the record persist (CancelOrIgnoreResponse then Restart) *)
(* never re-enters them into the outgoing delta. Local-origin rows keep *)
(* only persisted coverage — an accepted-but-unmarked local op is *)
(* re-derived and re-sent, the safe idempotent direction. *)
Restart ==
  /\ localPresent
  /\ NoDurableOp
  /\ ~responsePending
  /\ snapshot' = durableSnapshot
  /\ workingBase' = durableBase \cup durableRemoteRows
  /\ ResetCapturedPass
  /\ UNCHANGED << durableSnapshot, durableBase, queued, remote,
                  durableRemoteRows, presenceVars,
                  liveIdentity, liveGeneration, responseVars, durableOpVars,
                  auditVars >>

DiscardSettledLocal ==
  /\ localPresent
  /\ NoDurableOp
  /\ lane = "complete"
  /\ ~responsePending
  /\ ~HasDurableWork
  /\ localPresent' = FALSE
  /\ durablePresent' = FALSE
  /\ UNCHANGED << coverageVars, lane, captureVars, liveIdentity,
                  liveGeneration, responseVars, durableOpVars, auditVars,
                  authoritativelyDeleted >>

Next ==
  \/ \E op \in Ops : QueueEdit(op)
  \/ \E op \in Ops : DeferEdit(op)
  \/ Prime
  \/ CapturePreparation
  \/ MaterializeCapturedTail
  \/ PlanMarkerPersist
  \/ StartMarkerPersist
  \/ CompleteLiveMarkerPersist
  \/ CompleteStaleMarkerPersist
  \/ \E incoming \in SUBSET Ops :
       \E accepted \in SUBSET queued :
         \E deletes \in BOOLEAN :
           BeginSyncResponse(incoming, accepted, deletes)
  \/ \E nextIdentity \in Identities : Relink(nextIdentity)
  \/ \E nextIdentity \in Identities : ResetReinitialize(nextIdentity)
  \/ AbortStalePreparation
  \/ StartResponseTailAppend
  \/ CompleteResponseTailAppend
  \/ StartResponseDurableOp
  \/ CompleteLiveResponsePersist
  \/ CompleteLiveDeletion
  \/ CompleteStaleResponseDurableOp
  \/ CancelOrIgnoreResponse
  \/ CompleteCapturedPass
  \/ Restart
  \/ DiscardSettledLocal
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars
DurableAccountingSound == durableBase \subseteq (remote \cup queued)
WorkingAccountingSound == workingBase \subseteq (remote \cup queued)

SnapshotCoverageRetained ==
  snapshot \subseteq (remote \cup queued \cup RetainedTail)

PreparedCaptureHasNoTail ==
  lane \notin {"prepared", "complete"}
    \/ capturedFrontier \subseteq durableBase

CleanCaptureIsMaterialized ==
  lane # "complete" \/ capturedFrontier \subseteq remote

AllPublicationsMatchContext == allPublicationsMatchedContext

AuthoritativeDeletionIsTerminal ==
  ~authoritativelyDeleted \/ ~localPresent

StaleResponsePreservesCoverage ==
  (responsePending /\ ~ResponseIsLive /\ ~responsePending')
    => UNCHANGED << coverageVars, presenceVars >>

StaleResponseCannotAdvance == [][StaleResponsePreservesCoverage]_vars

StaleDeletionPreservesLiveDocument ==
  ( /\ localPresent
    /\ responsePending
    /\ responseDeletes
    /\ ~ResponseIsLive )
    => localPresent'

StaleDeletionCannotRemoveLiveDocument ==
  [][StaleDeletionPreservesLiveDocument]_vars

DurableStartIsGuarded ==
  /\ (durableOp = "none" /\ durableOp' = "marker") => CaptureIsLive
  /\ (durableOp = "none" /\ durableOp' \in {"response", "delete"})
       => ResponseIsLive

DurableStartRequiresLiveContext == [][DurableStartIsGuarded]_vars

StaleDurableCompletionPreservesLive ==
  (durableOp # "none" /\ ~DurableOpIsLive /\ durableOp' = "none")
    => UNCHANGED livePublicationVars

StaleDurableCompletionCannotPublish ==
  [][StaleDurableCompletionPreservesLive]_vars

StartedDurableOpSerializesRelink ==
  [][(durableOp # "none" /\ liveGeneration' = liveGeneration)
       => liveIdentity' = liveIdentity]_vars

StalePreparationContinuation ==
  /\ StaleCapture
  /\ \/ /\ lane = "captured"
         /\ lane' = "materialized"
     \/ /\ lane \in {"captured", "materialized", "planned", "persisting",
                       "prepared"}
         /\ lane' \in {"idle", "running"}
         /\ capturedFrontier' = {}

(* A stale pass continuation must never mint coverage or content: it may   *)
(* only step the lane machinery and enqueue. Restart is exempt — it is a   *)
(* crash-reload, not a pass continuation: it republishes durable content   *)
(* (snapshot' = durableSnapshot) and restores the marker from durably      *)
(* justified coverage only (RestartCoversRemoteRows binds it separately).  *)
StalePreparationIsQueueOnly ==
  (StalePreparationContinuation /\ ~Restart)
    => /\ UNCHANGED << snapshot, durableBase, remote, durableRemoteRows >>
       /\ workingBase' \subseteq workingBase
       /\ queued \subseteq queued'

StalePreparationCannotAdvance == [][StalePreparationIsQueueOnly]_vars

(* The provenance extension itself: no restart may leave a durably-held   *)
(* remote-origin row above the restored marker.                            *)
RestartCoversRemoteRows == [][Restart => durableRemoteRows \subseteq workingBase']_vars

NoDataLoss ==
  localPresent \/ authoritativelyDeleted \/ snapshot \subseteq remote

====================================================================
