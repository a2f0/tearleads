--------------------- MODULE RawHistoryRecovery ---------------------
EXTENDS Naturals

(* A rotation preflight first reconstructs raw history to prove that every   *)
(* local ordinary update descends from the genuine ordinary frontier. It then *)
(* commits those proven updates before a definitive raw recovery drains the   *)
(* retained pages into scratch.                                               *)
(* hasUnverifiedLocalGap represents state found only in the installed local   *)
(* document, without ordinary pending-row provenance. Authenticated rotation  *)
(* checkpoints are validated but the ordinary update stream is the source of  *)
(* truth. Durable history changes only after settlement succeeds, every page  *)
(* validates, the captured runtime generation survives, no unverified local   *)
(* gap remains, and no newer record/checkpoint install wins.                  *)
(* queuedCheckpoints abstracts queued checkpoint artifacts and their matching *)
(* tail rows. They can arrive while pages are collected; successful install  *)
(* selects and retires the then-current set atomically without replaying it.  *)
(* An installed gap carried only by a checkpoint is rejected during the      *)
(* preliminary provenance pass, before a dependent local edit can be sent.   *)
(* installSuperseded abstracts record-CAS loss and exact checkpoint-history  *)
(* gate rejection: either aborts the entire guarded install transaction.     *)
(* The verifying phase drains and validates every preliminary raw page before *)
(* provenance settlement can begin. The ready phase records that the final   *)
(* scratch history exactly covers every local artifact; publication is only  *)
(* reachable from that phase, in the same atomic identity-write section.      *)
(* LateRemoteUpdates designates one bounded ordinary update visible only to   *)
(* the definitive pull, representing remote work that races settlement.       *)
(* CommitPendingOrdinary is identity-write serialized with sync finalization, *)
(* so a shared-document import durably appends its history before settlement  *)
(* can persist that document. PublishRecovery is one atomic action because    *)
(* production holds the identity-write chain across final verification and    *)
(* the guarded install, whose pre-commit generation guard and COMMIT dispatch *)
(* share one synchronous slice after the final asynchronous projection write. *)
(* updateValid also covers encoding-neutral, type-preserving operation       *)
(* identity for update and full-snapshot tail artifacts, every               *)
(* encrypted-record/header and bundle/header binding (including unavailable  *)
(* epochs), integrity-prioritized shared-path failure aggregation, and        *)
(* unresolved dependencies in decryptable siblings: unavailable ciphertext   *)
(* authenticates ranges, not an exact dependency set.                        *)
(* A ValidatePage transition also carries that page's verified projection    *)
(* state into the next frozen-cursor request; it is abstracted here.          *)
(* RejectUnprovenPendingAppend models a sibling pane adding an ordinary row  *)
(* after the preliminary provenance snapshot; settlement aborts atomically.  *)
(* Append/RejectUnprovenLocalArtifactBeforeInstall model an ordinary row or  *)
(* tail whose exact operation range is absent from the rebuild, even when its *)
(* version-vector frontier is covered; guarded install aborts.                *)

CONSTANTS MaxUpdate, MaxEpoch, MaxPage

ASSUME /\ MaxUpdate \in Nat \ {0}
       /\ MaxEpoch \in Nat \ {0}
       /\ MaxPage \in Nat \ {0}

UpdateIds == 1..MaxUpdate
Epochs == 1..MaxEpoch
Pages == 1..MaxPage

VARIABLES phase,
          nextPage,
          pageOf,
          updateEpoch,
          updateValid,
          epochAvailable,
          ordinaryUpdates,
          localPending,
          queuedCheckpoints,
          initialQueuedCheckpoints,
          hasUnverifiedLocalGap,
          generationCurrent,
          installSuperseded,
          scratchHistory,
          initialDurableHistory,
          durableHistory,
          durablePublished,
          reportedUnavailableEpoch

vars == << phase, nextPage, pageOf, updateEpoch, updateValid,
           epochAvailable, ordinaryUpdates, localPending,
           queuedCheckpoints, initialQueuedCheckpoints,
           hasUnverifiedLocalGap, generationCurrent, installSuperseded,
           scratchHistory,
           initialDurableHistory, durableHistory, durablePublished,
           reportedUnavailableEpoch >>

fixedModel == << pageOf, updateEpoch, updateValid, epochAvailable,
                 ordinaryUpdates, initialQueuedCheckpoints,
                 installSuperseded, initialDurableHistory >>

durableState == << durableHistory, durablePublished >>

PageUpdates(page) == {id \in UpdateIds : pageOf[id] = page}

(* MaxUpdate is the bounded representative for a retained ordinary update    *)
(* that commits after preliminary validation but before the definitive pull. *)
LateRemoteUpdates == ordinaryUpdates \cap {MaxUpdate}

PreliminaryOrdinaryUpdates == ordinaryUpdates \ LateRemoteUpdates

PreliminaryPageUpdates(page) == PageUpdates(page) \ LateRemoteUpdates

UnavailableEpochs(page) ==
  {updateEpoch[id] :
    id \in {candidate \in PageUpdates(page) :
      ~epochAvailable[updateEpoch[candidate]]}}

PageHasInvalidUpdate(page) ==
  \E id \in PageUpdates(page) : ~updateValid[id]

PreliminaryUnavailableEpochs(page) ==
  {updateEpoch[id] :
    id \in {candidate \in PreliminaryPageUpdates(page) :
      ~epochAvailable[updateEpoch[candidate]]}}

PreliminaryPageHasInvalidUpdate(page) ==
  \E id \in PreliminaryPageUpdates(page) : ~updateValid[id]

MinEpoch(epochs) ==
  CHOOSE epoch \in epochs : \A other \in epochs : epoch <= other

TypeOK ==
  /\ phase \in {"verifying", "settling", "collecting", "ready",
                  "preliminary_failed", "failed", "complete"}
  /\ nextPage \in 1..(MaxPage + 1)
  /\ pageOf \in [UpdateIds -> Pages]
  /\ updateEpoch \in [UpdateIds -> Epochs]
  /\ updateValid \in [UpdateIds -> BOOLEAN]
  /\ epochAvailable \in [Epochs -> BOOLEAN]
  /\ ordinaryUpdates \in SUBSET UpdateIds
  /\ localPending \in SUBSET ordinaryUpdates
  /\ queuedCheckpoints \in SUBSET (UpdateIds \ ordinaryUpdates)
  /\ initialQueuedCheckpoints \in SUBSET (UpdateIds \ ordinaryUpdates)
  /\ hasUnverifiedLocalGap \in BOOLEAN
  /\ generationCurrent \in BOOLEAN
  /\ installSuperseded \in BOOLEAN
  /\ scratchHistory \subseteq ordinaryUpdates
  /\ initialDurableHistory \in SUBSET UpdateIds
  /\ durableHistory \in SUBSET UpdateIds
  /\ durablePublished \in BOOLEAN
  /\ reportedUnavailableEpoch \in 0..MaxEpoch

Init ==
  /\ phase = "verifying"
  /\ nextPage = 1
  /\ pageOf \in [UpdateIds -> Pages]
  /\ updateEpoch \in [UpdateIds -> Epochs]
  /\ updateValid \in [UpdateIds -> BOOLEAN]
  /\ epochAvailable \in [Epochs -> BOOLEAN]
  /\ ordinaryUpdates \in SUBSET UpdateIds
  /\ localPending \in SUBSET ordinaryUpdates
  /\ initialQueuedCheckpoints \in SUBSET (UpdateIds \ ordinaryUpdates)
  /\ queuedCheckpoints = initialQueuedCheckpoints
  /\ hasUnverifiedLocalGap \in BOOLEAN
  /\ generationCurrent = TRUE
  /\ installSuperseded \in BOOLEAN
  /\ scratchHistory = {}
  /\ initialDurableHistory \in SUBSET UpdateIds
  /\ durableHistory = initialDurableHistory
  /\ durablePublished = FALSE
  /\ reportedUnavailableEpoch = 0

VerifyOrdinaryProvenance ==
  /\ phase = "verifying"
  /\ nextPage = MaxPage + 1
  /\ scratchHistory = PreliminaryOrdinaryUpdates
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "settling"
  /\ nextPage' = 1
  /\ scratchHistory' = {}
  /\ UNCHANGED << fixedModel, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, durableState,
                  reportedUnavailableEpoch >>

ValidatePreliminaryPage ==
  /\ phase = "verifying"
  /\ generationCurrent
  /\ nextPage \in Pages
  /\ PreliminaryUnavailableEpochs(nextPage) = {}
  /\ ~PreliminaryPageHasInvalidUpdate(nextPage)
  /\ scratchHistory' =
       scratchHistory
         \cup (PreliminaryPageUpdates(nextPage) \cap ordinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, fixedModel, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, durableState,
                  reportedUnavailableEpoch >>

RejectUnprovenPendingAppend ==
  /\ phase = "settling"
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ hasUnverifiedLocalGap' = TRUE
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  generationCurrent, scratchHistory, durableState,
                  reportedUnavailableEpoch >>

StartRawCollection ==
  /\ phase = "settling"
  /\ localPending = {}
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "collecting"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

CommitPendingOrdinary ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "collecting"
  /\ localPending' = {}
  /\ UNCHANGED << fixedModel, nextPage, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

RejectPendingSettlement ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

ValidatePage ==
  /\ phase = "collecting"
  /\ generationCurrent
  /\ nextPage \in Pages
  /\ UnavailableEpochs(nextPage) = {}
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ scratchHistory' =
       scratchHistory \cup (PageUpdates(nextPage) \cap ordinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, fixedModel, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, durableState,
                  reportedUnavailableEpoch >>

RejectPreliminaryUnavailablePage ==
  /\ phase = "verifying"
  /\ nextPage \in Pages
  /\ ~PreliminaryPageHasInvalidUpdate(nextPage)
  /\ PreliminaryUnavailableEpochs(nextPage) # {}
  /\ phase' = "preliminary_failed"
  /\ reportedUnavailableEpoch' =
       MinEpoch(PreliminaryUnavailableEpochs(nextPage))
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState >>

RejectPreliminaryInvalidPage ==
  /\ phase = "verifying"
  /\ nextPage \in Pages
  /\ PreliminaryPageHasInvalidUpdate(nextPage)
  /\ phase' = "preliminary_failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

RejectUnavailablePage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ UnavailableEpochs(nextPage) # {}
  /\ phase' = "failed"
  /\ reportedUnavailableEpoch' = MinEpoch(UnavailableEpochs(nextPage))
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState >>

RejectInvalidPage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ PageHasInvalidUpdate(nextPage)
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

RejectUnverifiedLocalGap ==
  /\ phase = "verifying"
  /\ hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

ChangeGeneration ==
  /\ phase \in {"collecting", "ready"}
  /\ generationCurrent
  /\ generationCurrent' = FALSE
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, hasUnverifiedLocalGap, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

RejectChangedGeneration ==
  /\ phase \in {"collecting", "ready"}
  /\ ~generationCurrent
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

RejectSupersededInstall ==
  /\ phase = "ready"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ installSuperseded
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

AppendUnprovenLocalArtifactBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ hasUnverifiedLocalGap' = TRUE
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

RejectUnprovenLocalArtifactBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

VerifyExactLocalHistoryBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ scratchHistory = ordinaryUpdates
  /\ phase' = "ready"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

AppendCheckpointArtifact ==
  /\ phase = "collecting"
  /\ \E id \in (UpdateIds \ ordinaryUpdates) :
       /\ id \notin queuedCheckpoints
       /\ queuedCheckpoints' = queuedCheckpoints \cup {id}
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch >>

PublishRecovery ==
  /\ phase = "ready"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ generationCurrent
  /\ ~installSuperseded
  /\ phase' = "complete"
  /\ durableHistory' = scratchHistory
  /\ durablePublished' = TRUE
  /\ queuedCheckpoints' = {}
  /\ UNCHANGED << fixedModel, nextPage, localPending,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  reportedUnavailableEpoch >>

RemainTerminal ==
  /\ phase \in {"preliminary_failed", "failed", "complete"}
  /\ UNCHANGED vars

Next ==
  \/ ValidatePreliminaryPage
  \/ VerifyOrdinaryProvenance
  \/ RejectPreliminaryUnavailablePage
  \/ RejectPreliminaryInvalidPage
  \/ RejectUnprovenPendingAppend
  \/ StartRawCollection
  \/ CommitPendingOrdinary
  \/ RejectPendingSettlement
  \/ ValidatePage
  \/ RejectUnavailablePage
  \/ RejectInvalidPage
  \/ RejectUnverifiedLocalGap
  \/ ChangeGeneration
  \/ RejectChangedGeneration
  \/ RejectSupersededInstall
  \/ AppendUnprovenLocalArtifactBeforeInstall
  \/ RejectUnprovenLocalArtifactBeforeInstall
  \/ VerifyExactLocalHistoryBeforeInstall
  \/ AppendCheckpointArtifact
  \/ PublishRecovery
  \/ RemainTerminal

Spec == Init /\ [][Next]_vars

NoDurableMutationBeforeComplete ==
  phase = "complete" \/
    (~durablePublished /\ durableHistory = initialDurableHistory /\
      initialQueuedCheckpoints \subseteq queuedCheckpoints)

FailedRecoveryPreservesDurableHistory ==
  phase \notin {"preliminary_failed", "failed"} \/
    (~durablePublished /\ durableHistory = initialDurableHistory /\
      initialQueuedCheckpoints \subseteq queuedCheckpoints)

CompleteRecoveryContainsAllOrdinaryHistory ==
  phase # "complete" \/ durableHistory = ordinaryUpdates

CompleteRecoveryRetiresQueuedCheckpoints ==
  phase # "complete" \/ queuedCheckpoints = {}

ScratchNeverTrustsRotationCheckpoints ==
  scratchHistory \subseteq ordinaryUpdates

RawCollectionStartsAfterLocalSettlement ==
  phase \notin {"collecting", "ready", "complete"} \/ localPending = {}

SettlementUsesVerifiedOrdinaryProvenance ==
  phase # "settling" \/ ~hasUnverifiedLocalGap

PreliminaryValidationPrecedesSettlement ==
  phase \notin {"settling", "collecting", "ready", "complete"} \/
    /\ \A page \in Pages : ~PreliminaryPageHasInvalidUpdate(page)
    /\ \A page \in Pages : PreliminaryUnavailableEpochs(page) = {}

PublicationRequiresExactHistoryProvenance ==
  phase \notin {"ready", "complete"} \/
    (~hasUnverifiedLocalGap /\ scratchHistory = ordinaryUpdates)

UnverifiedLocalHistoryNeverPublishes ==
  ~hasUnverifiedLocalGap \/ phase # "complete"

SupersededInstallNeverPublishes ==
  ~installSuperseded \/ phase # "complete"

ChangedGenerationNeverPublishes ==
  generationCurrent \/ phase # "complete"

UnavailableEpochReportIsDeterministic ==
  phase \notin {"preliminary_failed", "failed"} \/
    reportedUnavailableEpoch = 0 \/
    (phase = "preliminary_failed" /\
      reportedUnavailableEpoch =
        MinEpoch(PreliminaryUnavailableEpochs(nextPage))) \/
    (phase = "failed" /\
      reportedUnavailableEpoch = MinEpoch(UnavailableEpochs(nextPage)))

InvalidPageNeverReportsAvailabilityFailure ==
  phase \notin {"preliminary_failed", "failed"} \/
    reportedUnavailableEpoch = 0 \/
    (phase = "preliminary_failed" /\
      ~PreliminaryPageHasInvalidUpdate(nextPage)) \/
    (phase = "failed" /\ ~PageHasInvalidUpdate(nextPage))

====================================================================
