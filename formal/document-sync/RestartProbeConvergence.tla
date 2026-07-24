-------------------- MODULE RestartProbeConvergence --------------------
EXTENDS Naturals

(* Recovery for one opened, already-persisted remote document.             *)
(* A queued bit plus an in-flight token model coalesced HTTP pull requests. *)

CONSTANTS MaxVersion, MaxDisconnects

ASSUME MaxVersion \in Nat \ {0}
ASSUME MaxDisconnects \in Nat \ {0}

VARIABLES remoteBodyVersion, remoteSlotVersion,
          localBodyVersion, localSlotVersion,
          process, interestState, containerTreeReady,
          declarationCoversDocument, serverCoversDocument,
          probeRequested, probeInFlight, newerRequestDuringFlight,
          capturedBodyVersion, capturedSlotVersion,
          requestObligationPending,
          requestTargetBodyVersion, requestTargetSlotVersion,
          recoveryPending, recoveryTargetValid,
          recoveryTargetBodyVersion, recoveryTargetSlotVersion,
          restartUsed, disconnectsUsed

versionVars == << remoteBodyVersion, remoteSlotVersion,
                  localBodyVersion, localSlotVersion >>
probeVars == << probeRequested, probeInFlight, newerRequestDuringFlight,
                capturedBodyVersion, capturedSlotVersion,
                requestObligationPending,
                requestTargetBodyVersion, requestTargetSlotVersion >>
recoveryVars == << recoveryPending, recoveryTargetValid,
                   recoveryTargetBodyVersion, recoveryTargetSlotVersion >>
vars == << versionVars, process, interestState,
          containerTreeReady, declarationCoversDocument,
          serverCoversDocument,
          probeVars, recoveryVars, restartUsed, disconnectsUsed >>

RequestTargetCovered ==
  /\ localBodyVersion >= requestTargetBodyVersion
  /\ localSlotVersion >= requestTargetSlotVersion

RecoveryTargetCovered ==
  /\ recoveryTargetValid
  /\ localBodyVersion >= recoveryTargetBodyVersion
  /\ localSlotVersion >= recoveryTargetSlotVersion

TypeOK ==
  /\ remoteBodyVersion \in 0..MaxVersion
  /\ remoteSlotVersion \in 0..MaxVersion
  /\ localBodyVersion \in 0..MaxVersion
  /\ localSlotVersion \in 0..MaxVersion
  /\ capturedBodyVersion \in 0..MaxVersion
  /\ capturedSlotVersion \in 0..MaxVersion
  /\ requestTargetBodyVersion \in 0..MaxVersion
  /\ requestTargetSlotVersion \in 0..MaxVersion
  /\ recoveryTargetBodyVersion \in 0..MaxVersion
  /\ recoveryTargetSlotVersion \in 0..MaxVersion
  /\ process \in {"running", "stopped"}
  /\ interestState \in
       {"ready", "awaitingBaseline", "baselineReceived", "awaitingAck"}
  /\ containerTreeReady \in BOOLEAN
  /\ declarationCoversDocument \in BOOLEAN
  /\ serverCoversDocument \in BOOLEAN
  /\ probeRequested \in BOOLEAN
  /\ probeInFlight \in BOOLEAN
  /\ newerRequestDuringFlight \in BOOLEAN
  /\ requestObligationPending \in BOOLEAN
  /\ recoveryPending \in BOOLEAN
  /\ recoveryTargetValid \in BOOLEAN
  /\ restartUsed \in BOOLEAN
  /\ disconnectsUsed \in 0..MaxDisconnects

Init ==
  /\ remoteBodyVersion = 0
  /\ remoteSlotVersion = 0
  /\ localBodyVersion = 0
  /\ localSlotVersion = 0
  /\ process = "running"
  /\ interestState = "ready"
  /\ containerTreeReady = TRUE
  /\ declarationCoversDocument = FALSE
  /\ serverCoversDocument = TRUE
  /\ probeRequested = FALSE
  /\ probeInFlight = FALSE
  /\ newerRequestDuringFlight = FALSE
  /\ capturedBodyVersion = 0
  /\ capturedSlotVersion = 0
  /\ requestObligationPending = FALSE
  /\ requestTargetBodyVersion = 0
  /\ requestTargetSlotVersion = 0
  /\ recoveryPending = FALSE
  /\ recoveryTargetValid = FALSE
  /\ recoveryTargetBodyVersion = 0
  /\ recoveryTargetSlotVersion = 0
  /\ restartUsed = FALSE
  /\ disconnectsUsed = 0

(* Peer body updates may occur while stopped, disconnected, or in flight. *)
(* A delivered hint queues another probe; a gap or dropped hint does not.  *)
RemoteBodyAdvance(delivered) ==
  LET hintDelivered ==
        delivered /\ process = "running" /\ interestState = "ready"
          /\ serverCoversDocument
  IN
    /\ remoteBodyVersion < MaxVersion
    /\ delivered \in BOOLEAN
    /\ remoteBodyVersion' = remoteBodyVersion + 1
    /\ probeRequested' = IF hintDelivered THEN TRUE ELSE probeRequested
    /\ newerRequestDuringFlight' =
         IF hintDelivered /\ probeInFlight
           THEN TRUE
           ELSE newerRequestDuringFlight
    /\ requestObligationPending' =
         IF hintDelivered THEN TRUE ELSE requestObligationPending
    /\ requestTargetBodyVersion' =
         IF hintDelivered
           THEN remoteBodyVersion + 1
           ELSE requestTargetBodyVersion
    /\ requestTargetSlotVersion' =
         IF hintDelivered THEN remoteSlotVersion ELSE requestTargetSlotVersion
    /\ UNCHANGED << remoteSlotVersion, localBodyVersion, localSlotVersion,
                    process, interestState,
                    containerTreeReady, declarationCoversDocument,
                    serverCoversDocument, probeInFlight,
                    capturedBodyVersion, capturedSlotVersion,
                    recoveryVars, restartUsed, disconnectsUsed >>

(* Attachment-slot metadata is part of the same encrypted CRDT response. *)
RemoteSlotAdvance(delivered) ==
  LET hintDelivered ==
        delivered /\ process = "running" /\ interestState = "ready"
          /\ serverCoversDocument
  IN
    /\ remoteSlotVersion < MaxVersion
    /\ delivered \in BOOLEAN
    /\ remoteSlotVersion' = remoteSlotVersion + 1
    /\ probeRequested' = IF hintDelivered THEN TRUE ELSE probeRequested
    /\ newerRequestDuringFlight' =
         IF hintDelivered /\ probeInFlight
           THEN TRUE
           ELSE newerRequestDuringFlight
    /\ requestObligationPending' =
         IF hintDelivered THEN TRUE ELSE requestObligationPending
    /\ requestTargetBodyVersion' =
         IF hintDelivered THEN remoteBodyVersion ELSE requestTargetBodyVersion
    /\ requestTargetSlotVersion' =
         IF hintDelivered
           THEN remoteSlotVersion + 1
           ELSE requestTargetSlotVersion
    /\ UNCHANGED << remoteBodyVersion, localBodyVersion, localSlotVersion,
                    process, interestState,
                    containerTreeReady, declarationCoversDocument,
                    serverCoversDocument, probeInFlight,
                    capturedBodyVersion, capturedSlotVersion,
                    recoveryVars, restartUsed, disconnectsUsed >>

(* A retained disconnect preserves accepted local work. Only hints emitted *)
(* while authoritative server interest is not ready can be absent from it. *)
DisconnectEvents ==
  /\ process = "running"
  /\ interestState = "ready"
  /\ disconnectsUsed < MaxDisconnects
  /\ interestState' = "awaitingBaseline"
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = FALSE
  /\ recoveryPending' = TRUE
  /\ recoveryTargetValid' = FALSE
  /\ disconnectsUsed' = disconnectsUsed + 1
  /\ UNCHANGED << versionVars, process, containerTreeReady, probeVars,
                  recoveryTargetBodyVersion, recoveryTargetSlotVersion,
                  restartUsed >>

(* A raw interest baseline restores protocol context but is not readiness.   *)
(* The client must first obtain its authoritative local container tree.      *)
ReceiveInterestBaseline ==
  /\ process = "running"
  /\ interestState = "awaitingBaseline"
  /\ recoveryPending
  /\ interestState' = "baselineReceived"
  /\ serverCoversDocument' = FALSE
  /\ UNCHANGED << versionVars, process, containerTreeReady,
                  declarationCoversDocument, probeVars,
                  recoveryVars, restartUsed, disconnectsUsed >>

(* SQLite/container reconciliation may become ready before or after baseline. *)
MarkContainerTreeReady ==
  /\ process = "running"
  /\ ~containerTreeReady
  /\ containerTreeReady' = TRUE
  /\ UNCHANGED << versionVars, process, interestState,
                  declarationCoversDocument, serverCoversDocument,
                  probeVars, recoveryVars, restartUsed, disconnectsUsed >>

(* The authoritative known-containers declaration is sent only from a ready *)
(* local tree. Its declaration identity is represented by awaitingAck: an    *)
(* acknowledgement from an older connection cannot cross another state.     *)
DeclareKnownContainers ==
  /\ process = "running"
  /\ interestState = "baselineReceived"
  /\ containerTreeReady
  /\ interestState' = "awaitingAck"
  /\ declarationCoversDocument' = TRUE
  /\ UNCHANGED << versionVars, process,
                  containerTreeReady, serverCoversDocument,
                  probeVars, recoveryVars, restartUsed, disconnectsUsed >>

(* The matching ack proves that the server applied interest covering this  *)
(* document. Only this barrier records the gap target and queues its probe. *)
AcknowledgeKnownContainers ==
  /\ process = "running"
  /\ interestState = "awaitingAck"
  /\ declarationCoversDocument
  /\ interestState' = "ready"
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = TRUE
  /\ probeRequested' = TRUE
  /\ newerRequestDuringFlight' =
       IF probeInFlight THEN TRUE ELSE newerRequestDuringFlight
  /\ requestObligationPending' = TRUE
  /\ requestTargetBodyVersion' = remoteBodyVersion
  /\ requestTargetSlotVersion' = remoteSlotVersion
  /\ recoveryTargetValid' = TRUE
  /\ recoveryTargetBodyVersion' = remoteBodyVersion
  /\ recoveryTargetSlotVersion' = remoteSlotVersion
  /\ UNCHANGED << versionVars, process, containerTreeReady, probeInFlight,
                  capturedBodyVersion, capturedSlotVersion,
                  recoveryPending, restartUsed, disconnectsUsed >>

(* Restart destroys only process-local requests and an in-flight response. *)
Restart ==
  /\ process = "running"
  /\ ~restartUsed
  /\ process' = "stopped"
  /\ interestState' = "awaitingBaseline"
  /\ containerTreeReady' = FALSE
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = FALSE
  /\ probeRequested' = FALSE
  /\ probeInFlight' = FALSE
  /\ newerRequestDuringFlight' = FALSE
  /\ requestObligationPending' = FALSE
  /\ recoveryPending' = TRUE
  /\ recoveryTargetValid' = FALSE
  /\ restartUsed' = TRUE
  /\ UNCHANGED << versionVars, capturedBodyVersion, capturedSlotVersion,
                  requestTargetBodyVersion, requestTargetSlotVersion,
                  recoveryTargetBodyVersion, recoveryTargetSlotVersion,
                  disconnectsUsed >>

(* Loading an opened persisted remote row requests a startup probe. The    *)
(* declaration/ack barrier is still outstanding and will request another   *)
(* probe if its acknowledgement arrives while this one is in flight.       *)
InitializeOpenedPersistedDocument ==
  /\ process = "stopped"
  /\ recoveryPending
  /\ process' = "running"
  /\ interestState' = "awaitingBaseline"
  /\ containerTreeReady' = FALSE
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = FALSE
  /\ probeRequested' = TRUE
  /\ probeInFlight' = FALSE
  /\ newerRequestDuringFlight' = FALSE
  /\ requestObligationPending' = TRUE
  /\ requestTargetBodyVersion' = remoteBodyVersion
  /\ requestTargetSlotVersion' = remoteSlotVersion
  /\ UNCHANGED << versionVars, capturedBodyVersion, capturedSlotVersion,
                  recoveryVars, restartUsed, disconnectsUsed >>

(* Starting a request consumes the queued bit and captures its HTTP snapshot. *)
BeginProbe ==
  /\ process = "running"
  /\ probeRequested
  /\ ~probeInFlight
  /\ probeRequested' = FALSE
  /\ probeInFlight' = TRUE
  /\ newerRequestDuringFlight' = FALSE
  /\ capturedBodyVersion' = remoteBodyVersion
  /\ capturedSlotVersion' = remoteSlotVersion
  /\ UNCHANGED << versionVars, process, interestState,
                  containerTreeReady, declarationCoversDocument,
                  serverCoversDocument,
                  requestObligationPending,
                  requestTargetBodyVersion, requestTargetSlotVersion,
                  recoveryVars, restartUsed, disconnectsUsed >>

(* Finishing applies only the captured response. An ack or delivered hint    *)
(* queued during the request remains queued, exactly like the sequence guard. *)
FinishProbe ==
  /\ process = "running"
  /\ probeInFlight
  /\ localBodyVersion' = capturedBodyVersion
  /\ localSlotVersion' = capturedSlotVersion
  /\ probeInFlight' = FALSE
  /\ probeRequested' = probeRequested
  /\ newerRequestDuringFlight' = FALSE
  /\ requestObligationPending' =
       IF capturedBodyVersion >= requestTargetBodyVersion
          /\ capturedSlotVersion >= requestTargetSlotVersion
         THEN FALSE
         ELSE requestObligationPending
  /\ recoveryPending' =
       IF recoveryTargetValid
          /\ capturedBodyVersion >= recoveryTargetBodyVersion
          /\ capturedSlotVersion >= recoveryTargetSlotVersion
         THEN FALSE
         ELSE recoveryPending
  /\ UNCHANGED << remoteBodyVersion, remoteSlotVersion,
                  process, interestState,
                  containerTreeReady, declarationCoversDocument,
                  serverCoversDocument,
                  capturedBodyVersion, capturedSlotVersion,
                  requestTargetBodyVersion, requestTargetSlotVersion,
                  recoveryTargetValid,
                  recoveryTargetBodyVersion, recoveryTargetSlotVersion,
                  restartUsed, disconnectsUsed >>

Next ==
  \/ \E delivered \in BOOLEAN : RemoteBodyAdvance(delivered)
  \/ \E delivered \in BOOLEAN : RemoteSlotAdvance(delivered)
  \/ DisconnectEvents
  \/ ReceiveInterestBaseline
  \/ MarkContainerTreeReady
  \/ DeclareKnownContainers
  \/ AcknowledgeKnownContainers
  \/ Restart
  \/ InitializeOpenedPersistedDocument
  \/ BeginProbe
  \/ FinishProbe
  \/ UNCHANGED vars

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ WF_vars(InitializeOpenedPersistedDocument)
  /\ WF_vars(ReceiveInterestBaseline)
  /\ WF_vars(MarkContainerTreeReady)
  /\ WF_vars(DeclareKnownContainers)
  /\ WF_vars(AcknowledgeKnownContainers)
  /\ WF_vars(BeginProbe)
  /\ WF_vars(FinishProbe)

LocalVersionsDoNotLead ==
  /\ localBodyVersion <= remoteBodyVersion
  /\ localSlotVersion <= remoteSlotVersion

ProbeWorkIsWellFormed ==
  /\ (probeRequested \/ probeInFlight) => process = "running"
  /\ newerRequestDuringFlight => probeInFlight /\ probeRequested
  /\ requestObligationPending => probeRequested \/ probeInFlight

StoppedProcessAwaitsBaseline ==
  process = "stopped" => interestState = "awaitingBaseline"

ReadyInterestCoversDocument ==
  (interestState = "ready") <=> serverCoversDocument

OutstandingDeclarationCoversDocument ==
  (interestState = "awaitingAck") <=> declarationCoversDocument

RestartClearsVolatile ==
  (process = "running" /\ process' = "stopped")
    => /\ ~probeRequested'
       /\ ~probeInFlight'
       /\ ~newerRequestDuringFlight'

RestartClearsVolatileState == [][RestartClearsVolatile]_vars

InitializationArmsStartupProbe ==
  (process = "stopped" /\ process' = "running")
    => /\ probeRequested'
       /\ interestState' = "awaitingBaseline"

OpenedInitializationArmsStartupProbe ==
  [][InitializationArmsStartupProbe]_vars

DisconnectPreservesAcceptedWork ==
  (process = "running" /\ process' = "running"
    /\ interestState = "ready"
    /\ interestState' = "awaitingBaseline")
    => /\ probeRequested' = probeRequested
       /\ probeInFlight' = probeInFlight
       /\ newerRequestDuringFlight' = newerRequestDuringFlight

RetainedDisconnectPreservesAcceptedWork ==
  [][DisconnectPreservesAcceptedWork]_vars

BaselineWaitsForAuthoritativeDeclaration ==
  (process = "running"
    /\ interestState = "awaitingBaseline"
    /\ interestState' = "baselineReceived")
    => /\ ~serverCoversDocument'
       /\ probeRequested' = probeRequested
       /\ probeInFlight' = probeInFlight

InterestBaselineWaitsForAuthoritativeDeclaration ==
  [][BaselineWaitsForAuthoritativeDeclaration]_vars

DeclarationUsesReadyContainerTree ==
  (interestState = "baselineReceived" /\ interestState' = "awaitingAck")
    => /\ containerTreeReady
       /\ containerTreeReady'
       /\ declarationCoversDocument'
       /\ ~serverCoversDocument'

KnownContainersDeclarationUsesReadyTree ==
  [][DeclarationUsesReadyContainerTree]_vars

AckArmsProbeAndCapturesTarget ==
  (process = "running"
    /\ interestState = "awaitingAck"
    /\ interestState' = "ready")
    => /\ declarationCoversDocument
       /\ serverCoversDocument'
       /\ probeRequested'
       /\ recoveryTargetValid'
       /\ recoveryTargetBodyVersion' = remoteBodyVersion
       /\ recoveryTargetSlotVersion' = remoteSlotVersion

KnownContainersAckArmsProbeAndCapturesTarget ==
  [][AckArmsProbeAndCapturesTarget]_vars

BeginCapturesOneServerSnapshot ==
  (~probeInFlight /\ probeInFlight')
    => /\ capturedBodyVersion' = remoteBodyVersion
       /\ capturedSlotVersion' = remoteSlotVersion
       /\ ~probeRequested'

ProbeBeginCapturesOneServerSnapshot ==
  [][BeginCapturesOneServerSnapshot]_vars

FinishAppliesCapturedSnapshot ==
  (process = "running" /\ process' = "running"
    /\ probeInFlight /\ ~probeInFlight')
    => /\ localBodyVersion' = capturedBodyVersion
       /\ localSlotVersion' = capturedSlotVersion
       /\ probeRequested' = probeRequested
       /\ (newerRequestDuringFlight => probeRequested')

ProbeFinishAppliesSnapshotAndPreservesNewerRequest ==
  [][FinishAppliesCapturedSnapshot]_vars

RequestEventuallyApplied ==
  [](requestObligationPending
      => <> (~requestObligationPending /\ RequestTargetCovered))

InterestRecoveryEventuallyCoversBaseline ==
  [](recoveryPending
      => <> (~recoveryPending /\ RecoveryTargetCovered))

=======================================================================
