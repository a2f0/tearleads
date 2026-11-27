---- MODULE DocumentListingConvergence ----
(***************************************************************************)
(* A client holding an ordinary document catches up with peer edits and   *)
(* access-head moves without probing on every restart and reconnect.      *)
(* DocumentListingConvergence.md maps actions, guards, and assumptions.   *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxEdits,
  MaxTouches,
  MaxHeadMoves,
  MaxRestarts,
  MaxDisconnects,
  MaxLaggingReads,
  MaxListFailures,
  MaxWithholds,
  OweBeforeWatermark,
  OweBeforeApply,
  SettleOnlyIfCovered,
  SettleOnlyIfHeadRead,
  SettleOnlyIfUnchanged,
  KeepHigherDebt,
  RememberClosedStoreHint,
  HintListsLane,
  RestoreOnOpen,
  ProbeWithoutBundle,
  ProbeWithheldCursor,
  RelistOnAcknowledge,
  AdvanceOnFailedListing,
  StartWithoutBundle,
  LaunchProbe,
  ProbeAsksOpenStore

ASSUME /\ {MaxEdits, MaxTouches, MaxHeadMoves, MaxRestarts, MaxDisconnects,
           MaxLaggingReads, MaxListFailures, MaxWithholds} \subseteq Nat
       /\ {OweBeforeWatermark, OweBeforeApply, SettleOnlyIfCovered,
           SettleOnlyIfHeadRead, SettleOnlyIfUnchanged, KeepHigherDebt,
           RememberClosedStoreHint, HintListsLane, RestoreOnOpen,
           ProbeWithoutBundle, ProbeWithheldCursor, RelistOnAcknowledge,
           AdvanceOnFailedListing, StartWithoutBundle, LaunchProbe,
           ProbeAsksOpenStore} \subseteq BOOLEAN

VARIABLES
  remoteVer, headMoves, watermark, listedOrder,
  edits, touches, restarts, disconnects, laggingReads, listFailures, withholds,
  up, connected, open, missedHint, relistDue,
  listing, listedVer, listedHead, listBehind, listOwed, listApplied, listPassed,
  probeDue, owedDurable, owedVer, owedHead, seq,
  localVer, cursorWithheld, heldHead, bundleHeld,
  reading, readVer, readSeq, readHead, probed

vars == <<remoteVer, headMoves, watermark, listedOrder, edits, touches,
          restarts, disconnects, laggingReads, listFailures, withholds, up,
          connected, open, missedHint, relistDue, listing, listedVer,
          listedHead, listBehind, listOwed, listApplied, listPassed, probeDue,
          owedDurable, owedVer, owedHead, seq, localVer, cursorWithheld,
          heldHead, bundleHeld, reading, readVer, readSeq, readHead, probed>>

listingVars == <<listing, listedOrder, listedVer, listedHead, listBehind,
                 listOwed, listApplied, listPassed>>
readVars == <<reading, readVer, readSeq, readHead>>
boundVars == <<edits, touches, restarts, disconnects, laggingReads,
               listFailures, withholds>>
storeVars == <<open, missedHint, probeDue, seq>>
headVars == <<headMoves, heldHead, bundleHeld>>
debtVars == <<owedDurable, owedVer, owedHead>>
cursorVars == <<localVer, cursorWithheld>>
connVars == <<up, connected>>

Max(a, b) == IF a >= b THEN a ELSE b
MaxOrder == MaxEdits + MaxTouches + MaxHeadMoves
MaxSeq == MaxEdits * 2 + MaxTouches + MaxHeadMoves * 2 + MaxRestarts * 3
            + MaxDisconnects + MaxListFailures + MaxWithholds + 4

\* Row publication position; every touching write advances it.
Order == remoteVer + touches + headMoves

\* Count covered by the sendable processed cursor.
SendableCursor == IF cursorWithheld THEN 0 ELSE localVer

\* Listed row shows more updates than the cursor covers or another head than the bundle's.
ListedBehind == listBehind \/ (bundleHeld /\ heldHead # listedHead)

TypeOK ==
  /\ {remoteVer, localVer, owedVer, readVer, listedVer} \subseteq 0..MaxEdits
  /\ {seq, readSeq} \subseteq 0..MaxSeq
  /\ {watermark, listedOrder} \subseteq 0..MaxOrder
  /\ {headMoves, heldHead, owedHead, listedHead, readHead} \subseteq 0..MaxHeadMoves
  /\ listFailures \in 0..MaxListFailures /\ withholds \in 0..MaxWithholds
  /\ {up, connected, open, missedHint, relistDue, listing, listBehind,
      listOwed, listApplied, listPassed, probeDue, owedDurable, cursorWithheld,
      bundleHeld, reading, probed} \subseteq BOOLEAN

Init ==
  /\ remoteVer = 0 /\ localVer = 0 /\ watermark = 0 /\ listedOrder = 0
  /\ edits = 0 /\ touches = 0 /\ restarts = 0 /\ disconnects = 0
  /\ laggingReads = 0 /\ listFailures = 0 /\ withholds = 0
  /\ up = TRUE /\ connected = FALSE /\ missedHint = FALSE /\ relistDue = FALSE
  /\ listing = FALSE /\ listedVer = 0 /\ listedHead = 0
  /\ listBehind = FALSE /\ listOwed = FALSE /\ listApplied = FALSE /\ listPassed = FALSE
  /\ probeDue = FALSE /\ owedDurable = FALSE /\ owedVer = 0 /\ owedHead = 0
  /\ seq = 0 /\ cursorWithheld = FALSE /\ headMoves = 0 /\ heldHead = 0
  /\ \/ (open = TRUE /\ bundleHeld = TRUE)
     \/ (StartWithoutBundle /\ open = FALSE /\ bundleHeld = FALSE)
  /\ reading = FALSE /\ readVer = 0 /\ readSeq = 0 /\ readHead = 0 /\ probed = FALSE

PeerEdit ==
  /\ edits < MaxEdits
  /\ edits' = edits + 1 /\ remoteVer' = remoteVer + 1
  /\ relistDue' = (relistDue \/ (up /\ connected /\ HintListsLane))
  /\ IF up /\ connected /\ open
       THEN probeDue' = TRUE /\ seq' = seq + 1 /\ UNCHANGED missedHint
       ELSE UNCHANGED <<probeDue, seq>>
            /\ missedHint' = (missedHint \/ (up /\ connected /\ RememberClosedStoreHint))
  /\ UNCHANGED <<probed, watermark, touches, restarts, disconnects,
                 laggingReads, listFailures, withholds, connVars, open,
                 listingVars, debtVars, cursorVars, headVars, readVars>>

OtherTouch ==
  /\ touches < MaxTouches /\ touches' = touches + 1
  /\ UNCHANGED <<probed, remoteVer, watermark, edits, restarts, disconnects,
                 laggingReads, listFailures, withholds, connVars, storeVars,
                 relistDue, listingVars, debtVars, cursorVars, headVars, readVars>>

HeadMove ==
  /\ headMoves < MaxHeadMoves /\ headMoves' = headMoves + 1
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connVars, storeVars,
                 relistDue, listingVars, debtVars, cursorVars, heldHead,
                 bundleHeld, readVars>>

\* Between sessions (store closed), a judge change or restore withholds the cursor.
WithholdCursor ==
  /\ ~open /\ localVer > 0 /\ ~cursorWithheld /\ withholds < MaxWithholds
  /\ cursorWithheld' = TRUE /\ withholds' = withholds + 1
  /\ UNCHANGED <<probed, remoteVer, watermark, edits, touches, restarts,
                 disconnects, laggingReads, listFailures, connVars, storeVars,
                 relistDue, listingVars, debtVars, localVer, headVars, readVars>>

Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ relistDue' = (relistDue \/ RelistOnAcknowledge)
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, up, storeVars,
                 listingVars, debtVars, cursorVars, headVars, readVars>>

Disconnect ==
  /\ connected /\ disconnects < MaxDisconnects
  /\ connected' = FALSE /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<probed, remoteVer, watermark, edits, touches, restarts,
                 laggingReads, listFailures, withholds, up, storeVars,
                 relistDue, listingVars, debtVars, cursorVars, headVars, readVars>>

\* Delta listing from watermark.
BeginListing ==
  /\ up /\ relistDue /\ ~listing /\ relistDue' = FALSE
  /\ IF Order > watermark
       THEN /\ listing' = TRUE /\ listedOrder' = Order
            /\ listedVer' = remoteVer /\ listedHead' = headMoves
            /\ listBehind' = (remoteVer > SendableCursor)
            /\ listOwed' = FALSE /\ listApplied' = FALSE /\ listPassed' = FALSE
       ELSE UNCHANGED listingVars
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connVars, storeVars,
                 debtVars, cursorVars, headVars, readVars>>

OweListedRead ==
  /\ up /\ listing /\ ListedBehind /\ ~listOwed
  /\ OweBeforeWatermark \/ listPassed
  /\ owedDurable' = TRUE
  /\ owedVer' = IF KeepHigherDebt THEN Max(owedVer, listedVer) ELSE listedVer
  /\ owedHead' = IF KeepHigherDebt THEN Max(owedHead, listedHead) ELSE listedHead
  /\ listOwed' = TRUE
  /\ IF open THEN probeDue' = TRUE /\ seq' = seq + 1 ELSE UNCHANGED <<probeDue, seq>>
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connVars, open,
                 missedHint, relistDue, listing, listedOrder, listedVer,
                 listedHead, listBehind, listApplied, listPassed, cursorVars,
                 headVars, readVars>>

ApplyListedRow ==
  /\ up /\ listing /\ ~listApplied
  /\ ~OweBeforeApply \/ listOwed \/ ~ListedBehind
  /\ listApplied' = TRUE
  /\ bundleHeld' = (bundleHeld /\ ~(heldHead < listedHead))
  /\ UNCHANGED <<probed, remoteVer, headMoves, watermark, boundVars, connVars,
                 storeVars, relistDue, listing, listedOrder, listedVer,
                 listedHead, listBehind, listOwed, listPassed, debtVars,
                 cursorVars, heldHead, readVars>>

\* Advancing the watermark assumes discovery verified the listed head; for an
\* unpulled record (`~bundleHeld`), that pins the checkpoint floor in `heldHead`.
AdvanceWatermark ==
  /\ up /\ listing /\ ~listPassed
  /\ ~OweBeforeWatermark \/ listOwed \/ ~ListedBehind
  /\ watermark' = listedOrder /\ listPassed' = TRUE
  /\ heldHead' = IF ~bundleHeld THEN Max(heldHead, listedHead) ELSE heldHead
  /\ UNCHANGED <<probed, remoteVer, headMoves, boundVars, connVars, storeVars,
                 relistDue, listing, listedOrder, listedVer, listedHead,
                 listBehind, listOwed, listApplied, debtVars, cursorVars,
                 bundleHeld, readVars>>

\* Listing fails or is stopped by a pause/supersession before saving its watermark.
FailListing ==
  /\ up /\ listing /\ ~listPassed /\ listFailures < MaxListFailures
  /\ listFailures' = listFailures + 1
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listApplied' = FALSE /\ listPassed' = FALSE
  /\ IF AdvanceOnFailedListing
       THEN watermark' = listedOrder /\ UNCHANGED relistDue
       ELSE relistDue' = TRUE /\ UNCHANGED watermark
  /\ UNCHANGED <<probed, remoteVer, edits, touches, restarts, disconnects,
                 laggingReads, withholds, connVars, storeVars, listedOrder,
                 listedVer, listedHead, listBehind, debtVars, cursorVars,
                 headVars, readVars>>

FinishListing ==
  /\ listing /\ listApplied /\ listPassed /\ (listOwed \/ ~ListedBehind)
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listApplied' = FALSE /\ listPassed' = FALSE
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connVars, storeVars,
                 relistDue, listedOrder, listedVer, listedHead, listBehind,
                 debtVars, cursorVars, headVars, readVars>>

OpenStore ==
  /\ up /\ ~open /\ open' = TRUE /\ missedHint' = FALSE
  /\ IF \/ missedHint
        \/ (RestoreOnOpen /\ owedDurable)
        \/ (ProbeWithoutBundle /\ ~bundleHeld)
        \/ (ProbeWithheldCursor /\ cursorWithheld)
       THEN probeDue' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<probeDue, seq>>
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connVars, relistDue,
                 listingVars, debtVars, cursorVars, headVars, readVars>>

BeginRead ==
  /\ up /\ open /\ probeDue /\ ~reading
  /\ reading' = TRUE /\ readVer' = remoteVer /\ readSeq' = seq /\ readHead' = headMoves
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connVars, storeVars,
                 relistDue, listingVars, debtVars, cursorVars, headVars>>

BeginLaggingRead ==
  /\ up /\ open /\ probeDue /\ ~reading /\ laggingReads < MaxLaggingReads
  /\ laggingReads' = laggingReads + 1 /\ reading' = TRUE /\ readSeq' = seq
  /\ readHead' \in 0..headMoves /\ readVer' \in localVer..remoteVer
  /\ UNCHANGED <<probed, remoteVer, watermark, edits, touches, restarts,
                 disconnects, listFailures, withholds, connVars, storeVars,
                 relistDue, listingVars, debtVars, cursorVars, headVars>>

FinishRead ==
  /\ up /\ reading /\ reading' = FALSE
  /\ IF ~bundleHeld /\ readHead < heldHead
       \* KeyingCheckpointRepository refuses rollback below the verified discovery floor.
       THEN UNCHANGED <<cursorVars, heldHead, bundleHeld, probeDue, debtVars>>
       ELSE /\ localVer' = Max(localVer, readVer)
            /\ cursorWithheld' = FALSE
            /\ heldHead' = IF bundleHeld THEN Max(heldHead, readHead) ELSE readHead
            /\ bundleHeld' = TRUE
            /\ LET covered == Max(localVer, readVer)
                   saved == IF bundleHeld THEN Max(heldHead, readHead) ELSE readHead
                   unchanged == ~SettleOnlyIfUnchanged \/ seq = readSeq
                   paid == \/ ~owedDurable
                           \/ /\ ~SettleOnlyIfCovered \/ covered >= owedVer
                              /\ ~SettleOnlyIfHeadRead \/ saved >= owedHead
               IN IF unchanged /\ paid
                    THEN probeDue' = FALSE /\ owedDurable' = FALSE /\ owedVer' = 0 /\ owedHead' = 0
                    ELSE UNCHANGED <<probeDue, debtVars>>
  /\ UNCHANGED <<probed, remoteVer, headMoves, watermark, boundVars, connVars,
                 open, missedHint, seq, relistDue, listingVars, readVer, readSeq, readHead>>

\* Launch probe lists from no watermark (possibly lagging) without lowering a debt.
ProbeListing ==
  /\ LaunchProbe /\ up /\ ~probed /\ probed' = TRUE
  /\ \E lVer \in 0..remoteVer, lHead \in 0..headMoves :
       IF lVer > SendableCursor \/ (bundleHeld /\ heldHead # lHead)
         THEN /\ owedDurable' = TRUE
              /\ owedVer' = IF KeepHigherDebt THEN Max(owedVer, lVer) ELSE lVer
              /\ owedHead' = IF KeepHigherDebt THEN Max(owedHead, lHead) ELSE lHead
              /\ IF open /\ ProbeAsksOpenStore
                   THEN probeDue' = TRUE /\ seq' = seq + 1
                   ELSE UNCHANGED <<probeDue, seq>>
         ELSE UNCHANGED <<debtVars, probeDue, seq>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, connVars, open, missedHint,
                 relistDue, listingVars, cursorVars, headVars, readVars>>

Crash ==
  /\ up /\ restarts < MaxRestarts /\ restarts' = restarts + 1
  /\ up' = FALSE /\ connected' = FALSE /\ relistDue' = FALSE
  /\ open' = FALSE /\ missedHint' = FALSE /\ probeDue' = FALSE
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listApplied' = FALSE /\ listPassed' = FALSE
  /\ reading' = FALSE /\ probed' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, disconnects,
                 laggingReads, listFailures, withholds, listedOrder, listedVer,
                 listedHead, listBehind, debtVars, seq, cursorVars, headVars,
                 readVer, readSeq, readHead>>

Start ==
  /\ ~up /\ up' = TRUE
  /\ UNCHANGED <<probed, remoteVer, watermark, boundVars, connected, storeVars,
                 relistDue, listingVars, debtVars, cursorVars, headVars, readVars>>

Next ==
  \/ PeerEdit \/ OtherTouch \/ HeadMove \/ WithholdCursor
  \/ Acknowledge \/ Disconnect
  \/ BeginListing \/ OweListedRead \/ ApplyListedRow \/ AdvanceWatermark
  \/ FailListing \/ FinishListing
  \/ OpenStore \/ BeginRead \/ BeginLaggingRead \/ FinishRead
  \/ ProbeListing \/ Crash \/ Start
  \/ UNCHANGED vars

Fairness ==
  /\ WF_vars(Acknowledge) /\ WF_vars(Start) /\ WF_vars(OpenStore)
  /\ WF_vars(BeginListing) /\ WF_vars(OweListedRead)
  /\ WF_vars(ApplyListedRow) /\ WF_vars(AdvanceWatermark)
  /\ WF_vars(FinishListing) /\ WF_vars(BeginRead) /\ WF_vars(FinishRead)

Spec == Init /\ [][Next]_vars /\ Fairness

EvidenceRetained ==
  localVer < remoteVer =>
    \/ owedDurable
    \/ Order > watermark
    \/ up /\ open /\ probeDue
    \/ up /\ missedHint
    \/ up /\ reading /\ readVer = remoteVer
    \/ up /\ listing /\ listBehind /\ ~listOwed

AccessHeadEvidenceRetained ==
  (~bundleHeld \/ heldHead # headMoves) =>
    \/ owedDurable
    \/ bundleHeld /\ Order > watermark
    \/ ~bundleHeld /\ ~open
    \/ up /\ open /\ probeDue
    \/ up /\ reading /\ readHead = headMoves
    \/ up /\ listing /\ ListedBehind /\ ~listOwed

StoreWorkIsWellFormed ==
  /\ (probeDue \/ reading) => up /\ open
  /\ missedHint => up /\ ~open

Converges == <>[](localVer = remoteVer)
DebtsSettle == <>[](~owedDurable)
WithheldCursorSettles == <>[](~cursorWithheld)

====
