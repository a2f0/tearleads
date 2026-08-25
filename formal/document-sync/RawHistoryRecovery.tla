--------------------- MODULE RawHistoryRecovery ---------------------
EXTENDS Naturals

(* A rotation preflight commits every local ordinary update before the raw   *)
(* recovery that can publish drains retained pages into scratch. The model   *)
(* abstracts checkpoint-only gap discovery into localPending at Init.         *)
(* Authenticated rotation checkpoints are validated but the ordinary update  *)
(* stream is the reconstruction source of truth. Durable history changes     *)
(* only after settlement succeeds and every page validates.                  *)

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
          scratchHistory,
          initialDurableHistory,
          durableHistory,
          durablePublished,
          reportedUnavailableEpoch

vars == << phase, nextPage, pageOf, updateEpoch, updateValid,
           epochAvailable, ordinaryUpdates, localPending, scratchHistory,
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
                  scratchHistory, initialDurableHistory, durableHistory,
                  durablePublished, reportedUnavailableEpoch >>

CommitPendingOrdinary ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "collecting"
  /\ localPending' = {}
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectPendingSettlement ==
  /\ phase = "settling"
  /\ localPending # {}
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending,
                  scratchHistory, initialDurableHistory, durableHistory,
                  durablePublished, reportedUnavailableEpoch >>

ValidatePage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ UnavailableEpochs(nextPage) = {}
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ scratchHistory' =
       scratchHistory \cup (PageUpdates(nextPage) \cap ordinaryUpdates)
  /\ nextPage' = nextPage + 1
  /\ UNCHANGED << phase, pageOf, updateEpoch, updateValid, epochAvailable,
                  ordinaryUpdates, localPending, initialDurableHistory,
                  durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

RejectUnavailablePage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ ~PageHasInvalidUpdate(nextPage)
  /\ UnavailableEpochs(nextPage) # {}
  /\ phase' = "failed"
  /\ reportedUnavailableEpoch' = MinEpoch(UnavailableEpochs(nextPage))
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished >>

RejectInvalidPage ==
  /\ phase = "collecting"
  /\ nextPage \in Pages
  /\ PageHasInvalidUpdate(nextPage)
  /\ phase' = "failed"
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending, scratchHistory,
                  initialDurableHistory, durableHistory, durablePublished,
                  reportedUnavailableEpoch >>

PublishRecovery ==
  /\ phase = "collecting"
  /\ nextPage = MaxPage + 1
  /\ phase' = "complete"
  /\ durableHistory' = scratchHistory
  /\ durablePublished' = TRUE
  /\ UNCHANGED << nextPage, pageOf, updateEpoch, updateValid,
                  epochAvailable, ordinaryUpdates, localPending, scratchHistory,
                  initialDurableHistory,
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
  \/ PublishRecovery
  \/ RemainTerminal

Spec == Init /\ [][Next]_vars

NoDurableMutationBeforeComplete ==
  phase = "complete" \/
    (~durablePublished /\ durableHistory = initialDurableHistory)

FailedRecoveryPreservesDurableHistory ==
  phase # "failed" \/
    (~durablePublished /\ durableHistory = initialDurableHistory)

CompleteRecoveryContainsAllOrdinaryHistory ==
  phase # "complete" \/ durableHistory = ordinaryUpdates

ScratchNeverTrustsRotationCheckpoints ==
  scratchHistory \subseteq ordinaryUpdates

RawCollectionStartsAfterLocalSettlement ==
  phase \notin {"collecting", "complete"} \/ localPending = {}

UnavailableEpochReportIsDeterministic ==
  phase # "failed" \/ reportedUnavailableEpoch = 0 \/
    reportedUnavailableEpoch = MinEpoch(UnavailableEpochs(nextPage))

InvalidPageNeverReportsAvailabilityFailure ==
  phase # "failed" \/ ~PageHasInvalidUpdate(nextPage) \/
    reportedUnavailableEpoch = 0

====================================================================
