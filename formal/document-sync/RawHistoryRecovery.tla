--------------------- MODULE RawHistoryRecovery ---------------------
EXTENDS Naturals

(* Every served update is authenticated: updateValid abstracts identity, *)
(* dependency closure, encrypted bindings, isolation priority and unresolved *)
(* dependencies. Recovery verifies history, settles proven rows, and pulls *)
(* again for races. The rebuild holds exactly what sync applied: every     *)
(* ordinary update and every served checkpoint the judge accepted, never a *)
(* void, an unsettled verdict, or a checkpoint only this device holds      *)
(* (#3135). hasUnverifiedLocalGap includes malformed/forked tail rows.     *)
(* Publication checks exact history, generation and CAS, then fences       *)
(* waiting writers. See RawHistoryRecovery.md for mapping and bounds. *)

CONSTANTS MaxUpdate, MaxEpoch, MaxPage, RequireCurrentGeneration,
          RequireWinningInstall, RetireCheckpoints, FenceBlockedWriters,
          FinishVerifiedRecovery, ExcludeVoids, RebuildServedCheckpoints,
          RebuildOnlyServedCheckpoints, RequireSettledVerdicts

ASSUME /\ MaxUpdate \in Nat \ {0}
       /\ MaxEpoch \in Nat \ {0}
       /\ MaxPage \in Nat \ {0}
       /\ {RequireCurrentGeneration, RequireWinningInstall,
           RetireCheckpoints, FenceBlockedWriters,
           FinishVerifiedRecovery, ExcludeVoids, RebuildServedCheckpoints,
           RebuildOnlyServedCheckpoints, RequireSettledVerdicts}
         \subseteq BOOLEAN

UpdateIds == 1..MaxUpdate
Epochs == 1..MaxEpoch
Pages == 1..MaxPage
VARIABLES phase, nextPage, pageOf, updateEpoch, updateValid, updateVoid,
          updateSettled, epochAvailable,
          ordinaryUpdates, initialLocalPending, localPending,
          queuedCheckpoints, initialQueuedCheckpoints, hasUnverifiedLocalGap,
          generationCurrent, installSuperseded, scratchHistory, preliminaryProven,
          initialDurableHistory, durableHistory, durablePublished,
          reportedUnavailableEpoch, blockedWriterFence

vars == << phase, nextPage, pageOf, updateEpoch, updateValid, updateVoid,
           updateSettled, epochAvailable, ordinaryUpdates,
           initialLocalPending, localPending,
           queuedCheckpoints, initialQueuedCheckpoints,
           hasUnverifiedLocalGap, generationCurrent, installSuperseded,
           scratchHistory, preliminaryProven,
           initialDurableHistory, durableHistory, durablePublished,
           reportedUnavailableEpoch, blockedWriterFence >>

fixedModel == << pageOf, updateEpoch, updateValid, updateVoid, updateSettled,
                 epochAvailable,
                 ordinaryUpdates, initialLocalPending, initialQueuedCheckpoints,
                 installSuperseded, initialDurableHistory >>
(* Preliminary proof is retained with commit state after verification. *)
durableState == << durableHistory, durablePublished, preliminaryProven >>
PageUpdates(page) == {id \in UpdateIds : pageOf[id] = page}
(* MaxUpdate represents a remote update racing the two pulls. *)
LateRemoteUpdates == ordinaryUpdates \cap {MaxUpdate}
PreliminaryOrdinaryUpdates == ordinaryUpdates \ LateRemoteUpdates
(* Pending rows reach the definitive server frontier after settlement. *)
DefinitiveOrdinaryUpdates == ordinaryUpdates \cup initialLocalPending
RotationCheckpoints ==
  UpdateIds \ (ordinaryUpdates \cup initialLocalPending)
(* A checkpoint queued or installed on this device has not been served. *)
ServedCheckpoints == RotationCheckpoints \ initialQueuedCheckpoints
PreliminaryPageUpdates(page) ==
  PageUpdates(page) \cap
    (PreliminaryOrdinaryUpdates \cup ServedCheckpoints)
DefinitivePageUpdates(page) ==
  PageUpdates(page) \cap
    (DefinitiveOrdinaryUpdates \cup ServedCheckpoints)
VoidUpdates == {id \in UpdateIds : updateVoid[id]}
UnsettledUpdates == {id \in UpdateIds : ~updateSettled[id]}
(* A checkpoint sync applied: served, authenticated, settled, not void. *)
AcceptedServedCheckpoints ==
  {id \in ServedCheckpoints : updateValid[id]} \
    (VoidUpdates \cup UnsettledUpdates)
(* What sync applied, and so what the rebuilt history must equal. *)
AppliedUpdates ==
  (DefinitiveOrdinaryUpdates \ VoidUpdates) \cup AcceptedServedCheckpoints
PreliminaryAppliedUpdates ==
  (PreliminaryOrdinaryUpdates \ VoidUpdates) \cup AcceptedServedCheckpoints
(* The checkpoints the rebuild imports. The pre-#3135 rotation rebuilt      *)
(* ordinary updates alone; the other faults import a local checkpoint or   *)
(* one still unsettled (negative controls only).                           *)
RebuildCheckpoints ==
  IF ~RebuildServedCheckpoints THEN {}
  ELSE IF RebuildOnlyServedCheckpoints THEN ServedCheckpoints
  ELSE RotationCheckpoints
PageRebuild(page, ordinary) ==
  (PageUpdates(page) \cap (ordinary \cup RebuildCheckpoints)) \ VoidUpdates
PageHasUnsettledUpdate(page) ==
  RequireSettledVerdicts /\
    \E id \in DefinitivePageUpdates(page) : ~updateSettled[id]
PreliminaryPageHasUnsettledUpdate(page) ==
  RequireSettledVerdicts /\
    \E id \in PreliminaryPageUpdates(page) : ~updateSettled[id]
PageHasVoid(page) == \E id \in DefinitivePageUpdates(page) : updateVoid[id]
PreliminaryPageHasVoid(page) ==
  \E id \in PreliminaryPageUpdates(page) : updateVoid[id]
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
  /\ updateVoid \in [UpdateIds -> BOOLEAN]
  /\ updateSettled \in [UpdateIds -> BOOLEAN]
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
  /\ scratchHistory \subseteq UpdateIds
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
  (* A served update another device wrote can be void; voids are judged    *)
  (* only after authentication, so an invalid update is never one.         *)
  /\ updateVoid \in {void \in [UpdateIds -> BOOLEAN] :
                       \A id \in UpdateIds :
                         void[id] =>
                           /\ id \in ordinaryUpdates \cup ServedCheckpoints
                           /\ updateValid[id]}
  (* A judged checkpoint can wait on its verdict (held, runtime-pending). *)
  /\ updateSettled \in {settled \in [UpdateIds -> BOOLEAN] :
                          \A id \in UpdateIds :
                            ~settled[id] =>
                              /\ id \in ServedCheckpoints
                              /\ updateValid[id] /\ ~updateVoid[id]
                              /\ epochAvailable[updateEpoch[id]]}
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
  /\ scratchHistory = PreliminaryAppliedUpdates
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
  /\ ExcludeVoids \/ ~PreliminaryPageHasVoid(nextPage)
  /\ ~PreliminaryPageHasUnsettledUpdate(nextPage)
  /\ scratchHistory' = scratchHistory \cup
       PageRebuild(nextPage, PreliminaryOrdinaryUpdates)
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
  /\ ExcludeVoids \/ ~PageHasVoid(nextPage)
  /\ ~PageHasUnsettledUpdate(nextPage)
  /\ scratchHistory' = scratchHistory \cup
       PageRebuild(nextPage, DefinitiveOrdinaryUpdates)
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

(* Before #3135 a void was poison too (ExcludeVoids = FALSE). A verdict the *)
(* judge has not settled fails the pass too; a later rotation retries.      *)
RejectPreliminaryInvalidPage ==
  /\ phase = "verifying"
  /\ nextPage \in Pages
  /\ \/ PreliminaryPageHasInvalidUpdate(nextPage)
     \/ (~ExcludeVoids /\ PreliminaryPageHasVoid(nextPage))
     \/ PreliminaryPageHasUnsettledUpdate(nextPage)
  /\ phase' = "preliminary_failed"
  /\ UNCHANGED << fixedModel, nextPage, localPending, queuedCheckpoints,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  durableState, reportedUnavailableEpoch,
                  blockedWriterFence >>

(* The exact-history proof fails when the rebuild differs from what sync    *)
(* applied; with every accepted served update rebuilt, it never does.       *)
RejectInexactHistory ==
  /\ phase \in {"verifying", "collecting"}
  /\ nextPage = MaxPage + 1
  /\ scratchHistory #
       IF phase = "verifying" THEN PreliminaryAppliedUpdates
       ELSE AppliedUpdates
  /\ phase' = IF phase = "verifying" THEN "preliminary_failed" ELSE "failed"
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
  /\ \/ PageHasInvalidUpdate(nextPage)
     \/ (~ExcludeVoids /\ PageHasVoid(nextPage))
     \/ PageHasUnsettledUpdate(nextPage)
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
  /\ scratchHistory = AppliedUpdates
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
  /\ FinishVerifiedRecovery
  /\ nextPage = MaxPage + 1
  /\ ~hasUnverifiedLocalGap
  /\ ~RequireCurrentGeneration \/ generationCurrent
  /\ ~RequireWinningInstall \/ ~installSuperseded
  /\ phase' = "complete"
  /\ durableHistory' = scratchHistory
  /\ durablePublished' = TRUE
  /\ queuedCheckpoints' = IF RetireCheckpoints THEN {} ELSE queuedCheckpoints
  /\ blockedWriterFence' =
       IF blockedWriterFence = "current" THEN "stale"
       ELSE blockedWriterFence
  /\ UNCHANGED << fixedModel, nextPage, localPending,
                  hasUnverifiedLocalGap, generationCurrent, scratchHistory,
                  preliminaryProven, reportedUnavailableEpoch >>

FinishBlockedWriterAfterRecovery ==
  /\ phase = "complete"
  /\ blockedWriterFence = "stale"
  /\ blockedWriterFence' =
       IF FenceBlockedWriters THEN "rejected" ELSE "committed"
  /\ durableHistory' =
       IF FenceBlockedWriters THEN durableHistory ELSE initialDurableHistory
  /\ UNCHANGED << phase, fixedModel, nextPage, localPending,
                  queuedCheckpoints, hasUnverifiedLocalGap,
                  generationCurrent, scratchHistory, durablePublished,
                  preliminaryProven, reportedUnavailableEpoch >>

RemainTerminal ==
  /\ phase \in {"preliminary_failed", "failed", "complete"}
  /\ UNCHANGED vars

(* Only recovery's own worker is fair; racing writers and resets are not. *)
RecoveryStep ==
  \/ ValidatePreliminaryPage
  \/ VerifyOrdinaryProvenance
  \/ RejectPreliminaryUnavailablePage
  \/ RejectPreliminaryInvalidPage
  \/ RejectInvalidLocalPendingProvenance
  \/ StartRawCollection
  \/ CommitPendingOrdinary
  \/ RejectPendingSettlement
  \/ ValidatePage
  \/ RejectUnavailablePage
  \/ RejectInvalidPage
  \/ RejectInexactHistory
  \/ RejectUnverifiedLocalGap
  \/ RejectChangedGeneration
  \/ RejectSupersededInstall
  \/ RejectUnprovenLocalArtifactBeforeInstall
  \/ VerifyExactLocalHistoryBeforeInstall
  \/ PublishRecovery

Next == RecoveryStep
  \/ RejectUnprovenPendingAppend
  \/ ChangeGeneration
  \/ AppendUnprovenLocalArtifactBeforeInstall
  \/ AppendCheckpointArtifact
  \/ BeginBlockedWriter
  \/ CommitBlockedWriterBeforeRecovery
  \/ FinishBlockedWriterAfterRecovery
  \/ RemainTerminal

Spec == Init /\ [][Next]_vars
FairSpec == Spec /\ WF_vars(RecoveryStep)
RecoveryEventuallyTerminates ==
  <> (phase \in {"preliminary_failed", "failed", "complete"})
NoDurableMutationBeforeComplete ==
  phase = "complete" \/
    (~durablePublished /\ durableHistory = initialDurableHistory /\
      initialQueuedCheckpoints \subseteq queuedCheckpoints)

FailedRecoveryPreservesDurableHistory ==
  phase \notin {"preliminary_failed", "failed"} \/
    (~durablePublished /\ durableHistory = initialDurableHistory /\
      initialQueuedCheckpoints \subseteq queuedCheckpoints)

CompleteRecoveryContainsAppliedHistory ==
  phase # "complete" \/ durableHistory = AppliedUpdates
CompleteRecoveryRetiresQueuedCheckpoints ==
  phase # "complete" \/ queuedCheckpoints = {}
(* No laundering: a checkpoint enters the rebuild only once sync would apply *)
(* it, never one queued or installed locally, voided, or unsettled.          *)
ScratchNeverLaundersCheckpoints ==
  scratchHistory \subseteq
    DefinitiveOrdinaryUpdates \cup AcceptedServedCheckpoints
ScratchNeverHoldsVoids == scratchHistory \cap VoidUpdates = {}
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
    (~hasUnverifiedLocalGap /\ scratchHistory = AppliedUpdates)

(* Every failure has a cause in its inputs, never history sync applied or   *)
(* left out: neither a void nor a served checkpoint stops every rotation,   *)
(* and with it every unlink, of its document (#3135).                        *)
RecoveryFailsOnlyForCause ==
  phase \notin {"preliminary_failed", "failed"} \/
    hasUnverifiedLocalGap \/ ~generationCurrent \/ installSuperseded \/
    ~LocalPendingProvenanceValid \/ localPending # {} \/
    \E page \in Pages :
      \/ PreliminaryPageHasInvalidUpdate(page)
      \/ PreliminaryUnavailableEpochs(page) # {}
      \/ PreliminaryPageHasUnsettledUpdate(page)
      \/ PageHasInvalidUpdate(page)
      \/ UnavailableEpochs(page) # {}
      \/ PageHasUnsettledUpdate(page)

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
