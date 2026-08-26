--------------------- MODULE RawHistoryRecovery ---------------------
EXTENDS Naturals

(* Recovery proves ordinary history, settles proven pending rows, then pulls  *)
(* again to include races. Every served update is authenticated; checkpoints *)
(* are excluded only from reconstruction. Publication requires exact history, *)
(* current ownership, and winning record/checkpoint comparisons.              *)
(* updateValid abstracts operation identity, dependency closure, encrypted    *)
(* record/header bindings, isolation priority, and unresolved dependencies.   *)
(* hasUnverifiedLocalGap includes malformed or forked uncompacted tail rows.  *)
(* blockedWriterFence is captured before a writer waits; publication advances *)
(* it so the older writer cannot append or save its stale record.             *)
(* Production mapping and checked bounds: RawHistoryRecovery.md.              *)

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
          initialLocalPending,
          localPending,
          queuedCheckpoints,
          initialQueuedCheckpoints,
          hasUnverifiedLocalGap,
          generationCurrent,
          installSuperseded,
          scratchHistory,
          preliminaryProven,
          initialDurableHistory,
          durableHistory,
          durablePublished,
          reportedUnavailableEpoch,
          blockedWriterFence

vars == << phase, nextPage, pageOf, updateEpoch, updateValid,
           epochAvailable, ordinaryUpdates, initialLocalPending, localPending,
           queuedCheckpoints, initialQueuedCheckpoints,
           hasUnverifiedLocalGap, generationCurrent, installSuperseded,
           scratchHistory, preliminaryProven,
           initialDurableHistory, durableHistory, durablePublished,
           reportedUnavailableEpoch, blockedWriterFence >>

fixedModel == << pageOf, updateEpoch, updateValid, epochAvailable,
                 ordinaryUpdates, initialLocalPending, initialQueuedCheckpoints,
                 installSuperseded, initialDurableHistory >>
(* Preliminary proof is retained with commit state after verification. *)
durableState == << durableHistory, durablePublished, preliminaryProven >>
PageUpdates(page) == {id \in UpdateIds : pageOf[id] = page}
(* MaxUpdate is the bounded representative for a retained ordinary update    *)
(* that commits after preliminary validation but before the definitive pull. *)
LateRemoteUpdates == ordinaryUpdates \cap {MaxUpdate}
PreliminaryOrdinaryUpdates == ordinaryUpdates \ LateRemoteUpdates
(* Local pending operations are absent from the preliminary server history.  *)
(* Successful settlement makes them part of the definitive raw pull.         *)
DefinitiveOrdinaryUpdates == ordinaryUpdates \cup initialLocalPending
RotationCheckpoints ==
  UpdateIds \ (ordinaryUpdates \cup initialLocalPending)
PreliminaryPageUpdates(page) ==
  PageUpdates(page) \cap
    (PreliminaryOrdinaryUpdates \cup RotationCheckpoints)
DefinitivePageUpdates(page) ==
  PageUpdates(page) \cap
    (DefinitiveOrdinaryUpdates \cup RotationCheckpoints)
LocalPendingProvenanceValid ==
  \A id \in initialLocalPending : updateValid[id]
UnavailableEpochs(page) ==
  {updateEpoch[id] :
    id \in {candidate \in DefinitivePageUpdates(page) :
      ~epochAvailable[updateEpoch[candidate]]}}

PageHasInvalidUpdate(page) ==
  \E id \in DefinitivePageUpdates(page) : ~updateValid[id]
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
  /\ initialLocalPending \in SUBSET (UpdateIds \ ordinaryUpdates)
  /\ localPending \in SUBSET initialLocalPending
  /\ queuedCheckpoints \in SUBSET (UpdateIds \ DefinitiveOrdinaryUpdates)
  /\ initialQueuedCheckpoints \in
       SUBSET (UpdateIds \ DefinitiveOrdinaryUpdates)
  /\ hasUnverifiedLocalGap \in BOOLEAN
  /\ generationCurrent \in BOOLEAN
  /\ installSuperseded \in BOOLEAN
  /\ scratchHistory \subseteq DefinitiveOrdinaryUpdates
  /\ preliminaryProven \subseteq initialLocalPending
  /\ initialDurableHistory \in SUBSET UpdateIds
  /\ durableHistory \in SUBSET UpdateIds
  /\ durablePublished \in BOOLEAN
  /\ reportedUnavailableEpoch \in 0..MaxEpoch
  /\ blockedWriterFence \in {"idle", "current", "stale", "rejected",
                               "committed"}
Init ==
  /\ phase = "verifying"
  /\ nextPage = 1
  /\ pageOf \in [UpdateIds -> Pages]
  /\ updateEpoch \in [UpdateIds -> Epochs]
  /\ updateValid \in [UpdateIds -> BOOLEAN]
  /\ epochAvailable \in [Epochs -> BOOLEAN]
  /\ ordinaryUpdates \in SUBSET UpdateIds
  /\ initialLocalPending \in SUBSET (UpdateIds \ ordinaryUpdates)
  /\ localPending = initialLocalPending
  /\ initialQueuedCheckpoints \in
       SUBSET (UpdateIds \ DefinitiveOrdinaryUpdates)
  /\ queuedCheckpoints = initialQueuedCheckpoints
  /\ hasUnverifiedLocalGap \in BOOLEAN
  /\ generationCurrent = TRUE
  /\ installSuperseded \in BOOLEAN
  /\ scratchHistory = {}
  /\ preliminaryProven = {}
  (* One maximal representative detects any pre-completion clear/overwrite.  *)
  /\ initialDurableHistory = UpdateIds
  /\ durableHistory = initialDurableHistory
  /\ durablePublished = FALSE
  /\ reportedUnavailableEpoch = 0
  /\ blockedWriterFence = "idle"

VerifyOrdinaryProvenance ==
  /\ phase = "verifying"
  /\ generationCurrent
  /\ nextPage = MaxPage + 1
  /\ scratchHistory = PreliminaryOrdinaryUpdates
  /\ ~hasUnverifiedLocalGap
  /\ LocalPendingProvenanceValid
  /\ phase' = "settling"
  /\ nextPage' = 1
  /\ preliminaryProven' = initialLocalPending
  /\ scratchHistory' = {}
  /\ UNCHANGED << fixedModel, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent,
                  durableHistory, durablePublished,
                  reportedUnavailableEpoch, blockedWriterFence >>

ValidatePreliminaryPage ==
  /\ phase = "verifying"
  /\ generationCurrent
  /\ nextPage \in Pages
  /\ PreliminaryUnavailableEpochs(nextPage) = {}
  /\ ~PreliminaryPageHasInvalidUpdate(nextPage)
  /\ scratchHistory' = scratchHistory \cup
       (PageUpdates(nextPage) \cap PreliminaryOrdinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, fixedModel, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, durableState,
                  reportedUnavailableEpoch, blockedWriterFence >>

RejectUnprovenPendingAppend ==
  /\ phase = "settling"
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ hasUnverifiedLocalGap' = TRUE
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  generationCurrent, scratchHistory, durableState,
                  reportedUnavailableEpoch, blockedWriterFence >>

RejectInvalidLocalPendingProvenance ==
  /\ phase = "verifying"
  /\ nextPage = MaxPage + 1
  /\ ~LocalPendingProvenanceValid
  /\ phase' = "preliminary_failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

StartRawCollection ==
  /\ phase = "settling"
  /\ generationCurrent
  /\ localPending = {}
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "collecting"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

CommitPendingOrdinary ==
  /\ phase = "settling"
  /\ generationCurrent
  /\ localPending # {}
  /\ localPending \subseteq preliminaryProven
  /\ ~hasUnverifiedLocalGap
  /\ phase' = "collecting"
  /\ localPending' = {}
  /\ UNCHANGED << fixedModel, nextPage, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

RejectPendingSettlement ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

ValidatePage ==
  /\ phase = "collecting"
  /\ generationCurrent
  /\ nextPage \in Pages
  /\ UnavailableEpochs(nextPage) = {}
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ scratchHistory' = scratchHistory \cup
       (PageUpdates(nextPage) \cap DefinitiveOrdinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, fixedModel, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, durableState,
                  reportedUnavailableEpoch, blockedWriterFence >>

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
                  durableState, blockedWriterFence >>

RejectPreliminaryInvalidPage ==
  /\ phase = "verifying"
  /\ nextPage \in Pages
  /\ PreliminaryPageHasInvalidUpdate(nextPage)
  /\ phase' = "preliminary_failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

RejectUnavailablePage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ UnavailableEpochs(nextPage) # {}
  /\ phase' = "failed"
  /\ reportedUnavailableEpoch' = MinEpoch(UnavailableEpochs(nextPage))
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, blockedWriterFence >>

RejectInvalidPage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ PageHasInvalidUpdate(nextPage)
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

RejectUnverifiedLocalGap ==
  /\ phase = "verifying"
  /\ hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

ChangeGeneration ==
  /\ phase \in {"verifying", "settling", "collecting", "ready"}
  /\ generationCurrent
  /\ generationCurrent' = FALSE
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, hasUnverifiedLocalGap, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

RejectChangedGeneration ==
  /\ phase \in {"verifying", "settling", "collecting", "ready"}
  /\ ~generationCurrent
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

RejectSupersededInstall ==
  /\ phase = "ready"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ installSuperseded
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

AppendUnprovenLocalArtifactBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ hasUnverifiedLocalGap' = TRUE
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

RejectUnprovenLocalArtifactBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ hasUnverifiedLocalGap
  /\ phase' = "failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

VerifyExactLocalHistoryBeforeInstall ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ scratchHistory = DefinitiveOrdinaryUpdates
  /\ phase' = "ready"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

AppendCheckpointArtifact ==
  /\ phase \in {"collecting", "ready"}
  /\ \E id \in (UpdateIds \ DefinitiveOrdinaryUpdates) :
       /\ id \notin queuedCheckpoints
       /\ queuedCheckpoints' = queuedCheckpoints \cup {id}
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

BeginBlockedWriter ==
  /\ phase = "ready"
  /\ blockedWriterFence = "idle"
  /\ blockedWriterFence' = "current"
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, scratchHistory, durableState,
                  reportedUnavailableEpoch >>

CommitBlockedWriterBeforeRecovery ==
  /\ phase = "ready"
  /\ ~durablePublished
  /\ blockedWriterFence = "current"
  /\ phase' = "failed"
  /\ hasUnverifiedLocalGap' = TRUE
  /\ blockedWriterFence' = "committed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  generationCurrent, scratchHistory, durableState,
                  reportedUnavailableEpoch >>

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
  /\ blockedWriterFence' =
       IF blockedWriterFence = "current" THEN "stale"
       ELSE blockedWriterFence
  /\ UNCHANGED << fixedModel, nextPage, localPending,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  preliminaryProven, reportedUnavailableEpoch >>

RejectBlockedWriterAfterRecovery ==
  /\ phase = "complete"
  /\ blockedWriterFence = "stale"
  /\ blockedWriterFence' = "rejected"
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, scratchHistory, durableState,
                  reportedUnavailableEpoch >>

RemainTerminal ==
  /\ phase \in {"preliminary_failed", "failed", "complete"}
  /\ UNCHANGED vars

Next ==
  \/ ValidatePreliminaryPage
  \/ VerifyOrdinaryProvenance
  \/ RejectPreliminaryUnavailablePage
  \/ RejectPreliminaryInvalidPage
  \/ RejectInvalidLocalPendingProvenance
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
  \/ BeginBlockedWriter
  \/ CommitBlockedWriterBeforeRecovery
  \/ PublishRecovery
  \/ RejectBlockedWriterAfterRecovery
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
  phase # "complete" \/ durableHistory = DefinitiveOrdinaryUpdates
CompleteRecoveryRetiresQueuedCheckpoints ==
  phase # "complete" \/ queuedCheckpoints = {}
ScratchNeverTrustsRotationCheckpoints ==
  scratchHistory \subseteq DefinitiveOrdinaryUpdates
RawCollectionStartsAfterLocalSettlement ==
  phase \notin {"collecting", "ready", "complete"} \/ localPending = {}

SettlementUsesVerifiedOrdinaryProvenance ==
  phase \notin {"collecting", "ready", "complete"} \/
    initialLocalPending \subseteq preliminaryProven

PreliminaryValidationPrecedesSettlement ==
  phase \notin {"settling", "collecting", "ready", "complete"} \/
    /\ \A page \in Pages : ~PreliminaryPageHasInvalidUpdate(page)
    /\ \A page \in Pages : PreliminaryUnavailableEpochs(page) = {}
    /\ LocalPendingProvenanceValid

PublicationRequiresExactHistoryProvenance ==
  phase \notin {"ready", "complete"} \/
    (~hasUnverifiedLocalGap /\
      scratchHistory = DefinitiveOrdinaryUpdates)

UnverifiedLocalHistoryNeverPublishes ==
  ~hasUnverifiedLocalGap \/ phase # "complete"

SupersededInstallNeverPublishes ==
  ~installSuperseded \/ phase # "complete"

ChangedGenerationNeverPublishes ==
  generationCurrent \/ phase # "complete"

BlockedWriterCannotCrossRecoveryFence ==
  ~durablePublished \/ blockedWriterFence \in {"idle", "stale", "rejected"}

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
