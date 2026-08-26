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
(* PublishRecovery is one atomic action because production holds the identity *)
(* write chain across final history/generation verification and the guarded  *)
(* install.                                                                  *)
(* updateValid also covers type-preserving operation identity, every         *)
(* encrypted-record/header and bundle/header binding (including unavailable  *)
(* epochs), and unresolved dependencies in decryptable siblings: unavailable *)
(* ciphertext authenticates ranges, not an exact dependency set.             *)
(* A ValidatePage transition also carries that page's verified projection    *)
(* state into the next frozen-cursor request; it is abstracted here.          *)
(* RejectUnprovenPendingAppend models a sibling pane adding an ordinary row  *)
(* after the preliminary provenance snapshot; settlement aborts atomically.  *)
(* RejectUnprovenLocalArtifactBeforeInstall models an ordinary row or a tail *)
(* whose exact operation range is absent from the rebuild, even when its     *)
(* version-vector frontier is covered; guarded install aborts.               *)

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

PageUpdates(page) == {id \in UpdateIds : pageOf[id] = page}

UnavailableEpochs(page) ==
  {updateEpoch[id] :
    id \in {candidate \in PageUpdates(page) :
      ~epochAvailable[updateEpoch[candidate]]}}

PageHasInvalidUpdate(page) ==
  \E id \in PageUpdates(page) : ~updateValid[id]

MinEpoch(epochs) ==
  CHOOSE epoch \in epochs : \A other \in epochs : epoch <= other

TypeOK ==
  /\ phase \in {"verifying", "settling", "collecting", "failed", "complete"}
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
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "settling"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectUnprovenPendingAppend ==
  /\ phase = "settling"
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ hasUnverifiedLocalGap' = TRUE
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  generationCurrent, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

StartRawCollection ==
  /\ phase = "settling"
  /\ localPending = {}
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "collecting"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

CommitPendingOrdinary ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "collecting"
  /\ localPending' = {}
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, queuedCheckpoints,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectPendingSettlement ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

ValidatePage ==
  /\ phase = "collecting"
  /\ generationCurrent
  /\ nextPage \in Pages
  /\ UnavailableEpochs(nextPage) = {}
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ scratchHistory' =
       scratchHistory \cup (PageUpdates(nextPage) \cap ordinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, pageOf, updateEpoch, updateValid, epochAvailable,
                  ordinaryUpdates, localPending, queuedCheckpoints,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, installSuperseded,
                  initialDurableHistory, durableHistory,
                  durablePublished, reportedUnavailableEpoch >>

RejectUnavailablePage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ UnavailableEpochs(nextPage) # {}
  /\ phase' = "failed"
  /\ reportedUnavailableEpoch' = MinEpoch(UnavailableEpochs(nextPage))
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished >>

RejectInvalidPage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ PageHasInvalidUpdate(nextPage)
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectUnverifiedLocalGap ==
  /\ phase = "verifying"
  /\ hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

ChangeGeneration ==
  /\ phase = "collecting"
  /\ generationCurrent
  /\ generationCurrent' = FALSE
  /\ UNCHANGED << phase, nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectChangedGeneration ==
  /\ phase = "collecting"
  /\ ~generationCurrent
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectSupersededInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ installSuperseded
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectUnprovenLocalArtifactBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ hasUnverifiedLocalGap' = TRUE
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  generationCurrent, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

AppendCheckpointArtifact ==
  /\ phase = "collecting"
  /\ \E id \in (UpdateIds \ ordinaryUpdates) :
       /\ id \notin queuedCheckpoints
       /\ queuedCheckpoints' = queuedCheckpoints \cup {id}
  /\ UNCHANGED << phase, nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, installSuperseded, scratchHistory,
                  initialDurableHistory,
                  durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

PublishRecovery ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ generationCurrent
  /\ ~installSuperseded
  /\ phase' = "complete"
  /\ durableHistory' = scratchHistory
  /\ durablePublished' = TRUE
  /\ queuedCheckpoints' = {}
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, installSuperseded, scratchHistory,
                  initialDurableHistory,
                  reportedUnavailableEpoch >>

RemainTerminal ==
  /\ phase \in {"failed", "complete"}
  /\ UNCHANGED vars

Next ==
  \/ VerifyOrdinaryProvenance
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
  \/ RejectUnprovenLocalArtifactBeforeInstall
  \/ AppendCheckpointArtifact
  \/ PublishRecovery
  \/ RemainTerminal

Spec == Init /\ [][Next]_vars

NoDurableMutationBeforeComplete ==
  phase = "complete" \/
    (~durablePublished /\ durableHistory = initialDurableHistory /\
      initialQueuedCheckpoints \subseteq queuedCheckpoints)

FailedRecoveryPreservesDurableHistory ==
  phase # "failed" \/
    (~durablePublished /\ durableHistory = initialDurableHistory /\
      initialQueuedCheckpoints \subseteq queuedCheckpoints)

CompleteRecoveryContainsAllOrdinaryHistory ==
  phase # "complete" \/ durableHistory = ordinaryUpdates

CompleteRecoveryRetiresQueuedCheckpoints ==
  phase # "complete" \/ queuedCheckpoints = {}

ScratchNeverTrustsRotationCheckpoints ==
  scratchHistory \subseteq ordinaryUpdates

RawCollectionStartsAfterLocalSettlement ==
  phase \notin {"collecting", "complete"} \/ localPending = {}

SettlementUsesVerifiedOrdinaryProvenance ==
  phase \notin {"settling", "collecting", "complete"} \/
    ~hasUnverifiedLocalGap

UnverifiedLocalHistoryNeverPublishes ==
  ~hasUnverifiedLocalGap \/ phase # "complete"

SupersededInstallNeverPublishes ==
  ~installSuperseded \/ phase # "complete"

ChangedGenerationNeverPublishes ==
  generationCurrent \/ phase # "complete"

UnavailableEpochReportIsDeterministic ==
  phase # "failed" \/ reportedUnavailableEpoch = 0 \/
    reportedUnavailableEpoch = MinEpoch(UnavailableEpochs(nextPage))

InvalidPageNeverReportsAvailabilityFailure ==
  phase # "failed" \/ ~PageHasInvalidUpdate(nextPage) \/
    reportedUnavailableEpoch = 0

====================================================================
