------------------------- MODULE QueuedDocumentCreate -------------------------
EXTENDS Naturals

CONSTANTS CheckDurableRow, CheckCurrentGeneration,
          RequireSeedAcknowledgement, KeepSeedOnAdoption,
          KeepPlannedIdHints, ClearOnlyConsumedSignal
ASSUME {CheckDurableRow, CheckCurrentGeneration,
        RequireSeedAcknowledgement, KeepSeedOnAdoption,
        KeepPlannedIdHints, ClearOnlyConsumedSignal} \subseteq BOOLEAN

VARIABLES durable, storePresent, generation, observedGeneration, observedExists,
          phase, startedFromMissingRow, clearedReplacement,
          seedQueued, serverDocument, serverSeed, attempt, response,
          peerEdit, signal
vars == <<durable, storePresent, generation, observedGeneration, observedExists,
          phase, startedFromMissingRow, clearedReplacement,
          seedQueued, serverDocument, serverSeed, attempt, response,
          peerEdit, signal>>
hintVars == <<peerEdit, signal>>
seedVars == <<seedQueued, serverDocument, serverSeed, attempt, response,
              peerEdit, signal>>
queueVars == <<durable, storePresent, generation, observedGeneration,
               observedExists, phase, startedFromMissingRow, clearedReplacement>>

Init ==
  /\ durable = TRUE /\ storePresent = TRUE
  /\ generation = 0 /\ observedGeneration = 0 /\ observedExists = TRUE
  /\ phase = "queued"
  /\ startedFromMissingRow = FALSE /\ clearedReplacement = FALSE
  (* The document's whole content is one queued row: the create's seed. *)
  /\ seedQueued = TRUE /\ serverDocument = FALSE /\ serverSeed = FALSE
  /\ attempt = "none" /\ response = "none"
  (* No peer can edit before the document exists, so the only signal the *)
  (* store holds at submission is one the creating pass consumed.        *)
  /\ peerEdit = "none" /\ signal = FALSE

(* Purging local storage does not synchronously retire every queued store. *)
Purge ==
  /\ durable /\ durable' = FALSE
  /\ UNCHANGED <<storePresent, generation, observedGeneration, observedExists,
                  phase, startedFromMissingRow, clearedReplacement>>
  /\ UNCHANGED seedVars

ReadDurableRow ==
  /\ phase = "queued" /\ phase' = "checking"
  /\ observedExists' = durable /\ observedGeneration' = generation
  /\ UNCHANGED <<durable, storePresent, generation,
                  startedFromMissingRow, clearedReplacement>>
  /\ UNCHANGED seedVars

(* Another store generation may win while the durable read is pending. *)
ReplaceGeneration ==
  /\ phase = "checking" /\ generation = 0
  /\ generation' = 1 /\ storePresent' = TRUE
  /\ UNCHANGED <<durable, observedGeneration, observedExists, phase,
                  startedFromMissingRow, clearedReplacement>>
  /\ UNCHANGED seedVars

Current == ~CheckCurrentGeneration \/ generation = observedGeneration
Discard == Current /\ CheckDurableRow /\ ~observedExists
Start == Current /\ (~CheckDurableRow \/ observedExists)
FinishRead ==
  /\ phase = "checking"
  /\ phase' = IF ~Current THEN "cancelled"
              ELSE IF Discard THEN "discarded" ELSE "started"
  /\ storePresent' = IF Discard THEN FALSE ELSE storePresent
  /\ startedFromMissingRow' = (Start /\ ~observedExists)
  /\ clearedReplacement' = (Discard /\ generation # observedGeneration)
  /\ UNCHANGED <<durable, generation, observedGeneration, observedExists>>
  /\ UNCHANGED seedVars

(* The create carries the queued row as its seed. The server commits the  *)
(* document and the seed in one transaction or neither, and its response  *)
(* may be lost.                                                           *)
SubmitSeeded ==
  /\ phase = "started" /\ attempt = "none"
  /\ attempt' = "seeded"
  /\ \/ /\ serverDocument' = TRUE /\ serverSeed' = TRUE
        /\ response' \in {"seedAcknowledged", "lost"}
     \/ /\ response' = "refused"
        /\ UNCHANGED <<serverDocument, serverSeed>>
  /\ UNCHANGED seedQueued
  /\ UNCHANGED hintVars
  /\ UNCHANGED queueVars

(* A refused seed falls back to the plain create once. *)
SubmitPlain ==
  /\ attempt = "seeded" /\ response = "refused"
  /\ attempt' = "plain" /\ serverDocument' = TRUE
  /\ response' \in {"plainAcknowledged", "lost"}
  /\ UNCHANGED <<seedQueued, serverSeed>>
  /\ UNCHANGED hintVars
  /\ UNCHANGED queueVars

(* The store holds the document's id once its response settles. Before    *)
(* that, a peer's hint names only the id the create was submitted under.  *)
IdInstalled == response = "settled"

(* A peer edits the committed document and its hint reaches the store. A  *)
(* hint arriving later is the same step taken after IdInstalled.          *)
PeerEdit ==
  /\ serverDocument /\ peerEdit = "none"
  /\ peerEdit' = "unseen"
  /\ signal' = (signal \/ IdInstalled \/ KeepPlannedIdHints)
  /\ UNCHANGED <<seedQueued, serverDocument, serverSeed, attempt, response>>
  /\ UNCHANGED queueVars

(* Only an acknowledgement naming the seed settles its row. Settling the  *)
(* seed answers the signal the pass consumed and so skips its pull; a     *)
(* signal raised after submission survives.                               *)
Settle ==
  /\ response \in {"seedAcknowledged", "plainAcknowledged"}
  /\ seedQueued' = (seedQueued /\ RequireSeedAcknowledgement
                    /\ response # "seedAcknowledged")
  /\ response' = "settled"
  /\ signal' = (signal /\ (ClearOnlyConsumedSignal
                            \/ response # "seedAcknowledged"))
  /\ UNCHANGED <<serverDocument, serverSeed, attempt, peerEdit>>
  /\ UNCHANGED queueVars

(* A lost response is adopted from the committed manifest, which does not *)
(* say whether the seed committed with it, so the row stays queued.       *)
Adopt ==
  /\ response = "lost"
  /\ seedQueued' = (seedQueued /\ KeepSeedOnAdoption)
  /\ response' = "settled"
  /\ UNCHANGED <<serverDocument, serverSeed, attempt>>
  /\ UNCHANGED hintVars
  /\ UNCHANGED queueVars

Seen == IF peerEdit = "unseen" THEN "seen" ELSE peerEdit

(* A row still queued syncs as an ordinary update. A seed already stored  *)
(* under its id comes back encrypted again, so the server reports an      *)
(* update-id conflict and recovery settles or re-keys the row; this step  *)
(* abstracts that exchange to its outcome, the ops stored and the row     *)
(* settled. Its pull sees any peer edit and answers the signal.           *)
SyncQueuedRow ==
  /\ response = "settled" /\ seedQueued /\ serverDocument
  /\ seedQueued' = FALSE /\ serverSeed' = TRUE
  /\ peerEdit' = Seen /\ signal' = FALSE
  /\ UNCHANGED <<serverDocument, attempt, response>>
  /\ UNCHANGED queueVars

(* A signalled store with nothing queued runs a pull-only pass. *)
Pull ==
  /\ IdInstalled /\ signal
  /\ peerEdit' = Seen /\ signal' = FALSE
  /\ UNCHANGED <<seedQueued, serverDocument, serverSeed, attempt, response>>
  /\ UNCHANGED queueVars

TypeOK ==
  /\ {durable, storePresent, observedExists,
       startedFromMissingRow, clearedReplacement} \subseteq BOOLEAN
  /\ generation \in 0..1 /\ observedGeneration \in 0..1
  /\ phase \in {"queued", "checking", "cancelled", "discarded", "started"}
  /\ {seedQueued, serverDocument, serverSeed} \subseteq BOOLEAN
  /\ attempt \in {"none", "seeded", "plain"}
  /\ response \in {"none", "seedAcknowledged", "plainAcknowledged", "refused",
                   "lost", "settled"}
  /\ peerEdit \in {"none", "unseen", "seen"} /\ signal \in BOOLEAN
PurgedQueueDoesNotStart == ~startedFromMissingRow
ReplacementStoreSurvives == ~clearedReplacement
(* A row leaves the queue only once the server holds its content. *)
SettledSeedIsCommitted == ~seedQueued => serverSeed
(* The server never holds a seed without its document. *)
SeedCommitsWithDocument == serverSeed => serverDocument
(* A peer edit the creator has not seen is still owed a pull: by the      *)
(* creating pass, the queued row's sync, or a surviving signal.           *)
PeerEditIsPulled ==
  peerEdit = "unseen" => (~IdInstalled \/ seedQueued \/ signal)

Next == Purge \/ ReadDurableRow \/ ReplaceGeneration \/ FinishRead
        \/ SubmitSeeded \/ SubmitPlain \/ PeerEdit \/ Settle \/ Adopt
        \/ SyncQueuedRow \/ Pull
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
=============================================================================
