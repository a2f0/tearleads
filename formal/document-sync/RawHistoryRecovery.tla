--------------------- MODULE RawHistoryRecovery ---------------------
EXTENDS Naturals

(* A rotation preflight commits every proven local ordinary update before    *)
(* the raw recovery that can publish drains retained pages into scratch.      *)
(* hasUnverifiedLocalGap represents state found only in the installed local   *)
(* document, without ordinary pending-row provenance. Authenticated rotation  *)
(* checkpoints are validated but the ordinary update stream is the source of  *)
(* truth. Durable history changes only after settlement succeeds, every page  *)
(* validates, no unverified local gap remains, and no newer install wins.     *)
(* queuedCheckpoints abstracts BOTH covered queued checkpoints and covered     *)
(* local-history tail rows. Either can arrive while pages are collected; the  *)
(* successful install selects and retires the then-current set atomically.    *)

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
          installSuperseded,
          scratchHistory,
          initialDurableHistory,
          durableHistory,
          durablePublished,
          reportedUnavailableEpoch

vars == << phase, nextPage, pageOf, updateEpoch, updateValid,
           epochAvailable, ordinaryUpdates, localPending,
           queuedCheckpoints, initialQueuedCheckpoints,
           hasUnverifiedLocalGap, installSuperseded, scratchHistory,
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
  /\ phase \in {"settling", "collecting", "failed", "complete"}
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
  /\ installSuperseded \in BOOLEAN
  /\ scratchHistory \subseteq ordinaryUpdates
  /\ initialDurableHistory \in SUBSET UpdateIds
  /\ durableHistory \in SUBSET UpdateIds
  /\ durablePublished \in BOOLEAN
  /\ reportedUnavailableEpoch \in 0..MaxEpoch

Init ==
  /\ phase = "settling"
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
  /\ installSuperseded \in BOOLEAN
  /\ scratchHistory = {}
  /\ initialDurableHistory \in SUBSET UpdateIds
  /\ durableHistory = initialDurableHistory
  /\ durablePublished = FALSE
  /\ reportedUnavailableEpoch = 0

StartRawCollection ==
  /\ phase = "settling"
  /\ localPending = {}
  /\ phase' = "collecting"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

CommitPendingOrdinary ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "collecting"
  /\ localPending' = {}
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, queuedCheckpoints,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectPendingSettlement ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

ValidatePage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ UnavailableEpochs(nextPage) = {}
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ scratchHistory' =
       scratchHistory \cup (PageUpdates(nextPage) \cap ordinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, pageOf, updateEpoch, updateValid, epochAvailable,
                  ordinaryUpdates, localPending, queuedCheckpoints,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  installSuperseded, initialDurableHistory, durableHistory,
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
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished >>

RejectInvalidPage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ PageHasInvalidUpdate(nextPage)
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectUnverifiedLocalGap ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  queuedCheckpoints, initialQueuedCheckpoints,
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
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
                  hasUnverifiedLocalGap, installSuperseded, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

AppendCoveredLocalArtifact ==
  /\ phase = "collecting"
  /\ \E id \in (UpdateIds \ ordinaryUpdates) :
       /\ id \notin queuedCheckpoints
       /\ queuedCheckpoints' = queuedCheckpoints \cup {id}
  /\ UNCHANGED << phase, nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  installSuperseded, scratchHistory, initialDurableHistory,
                  durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

PublishRecovery ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ ~installSuperseded
  /\ phase' = "complete"
  /\ durableHistory' = scratchHistory
  /\ durablePublished' = TRUE
  /\ queuedCheckpoints' = {}
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  initialQueuedCheckpoints, hasUnverifiedLocalGap,
                  installSuperseded, scratchHistory, initialDurableHistory,
                  reportedUnavailableEpoch >>

RemainTerminal ==
  /\ phase \in {"failed", "complete"}
  /\ UNCHANGED vars

Next ==
  \/ StartRawCollection
  \/ CommitPendingOrdinary
  \/ RejectPendingSettlement
  \/ ValidatePage
  \/ RejectUnavailablePage
  \/ RejectInvalidPage
  \/ RejectUnverifiedLocalGap
  \/ RejectSupersededInstall
  \/ AppendCoveredLocalArtifact
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

UnverifiedLocalHistoryNeverPublishes ==
  ~hasUnverifiedLocalGap \/ phase # "complete"

SupersededInstallNeverPublishes ==
  ~installSuperseded \/ phase # "complete"

UnavailableEpochReportIsDeterministic ==
  phase # "failed" \/ reportedUnavailableEpoch = 0 \/
    reportedUnavailableEpoch = MinEpoch(UnavailableEpochs(nextPage))

InvalidPageNeverReportsAvailabilityFailure ==
  phase # "failed" \/ ~PageHasInvalidUpdate(nextPage) \/
    reportedUnavailableEpoch = 0

====================================================================
