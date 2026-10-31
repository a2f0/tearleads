-------------------- MODULE RestartProbeConvergence --------------------
EXTENDS Naturals

(* Recovery for one opened, already-persisted remote document.             *)
(* A queued bit plus an in-flight token model coalesced HTTP pull requests. *)

CONSTANTS MaxVersion, MaxDisconnects,
          KeepQueuedRequestAcrossFlight, \* a finished probe keeps a request queued meanwhile
          DeclareFromReadyTree,          \* the declaration waits for the local container tree
          ArmProbeOnAck,                 \* the matching acknowledgement queues a probe
          ReleaseDeferredProbeOnAbandon  \* an attempt ending without an ack arms the deferred startup probe

ASSUME MaxVersion \in Nat \ {0}
ASSUME MaxDisconnects \in Nat \ {0}
ASSUME {KeepQueuedRequestAcrossFlight, DeclareFromReadyTree, ArmProbeOnAck,
        ReleaseDeferredProbeOnAbandon} \subseteq BOOLEAN

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
          startupProbeDeferred, abandonUsed,
          restartUsed, disconnectsUsed

versionVars == << remoteBodyVersion, remoteSlotVersion,
                  localBodyVersion, localSlotVersion >>
probeVars == << probeRequested, probeInFlight, newerRequestDuringFlight,
                startupProbeDeferred,
                capturedBodyVersion, capturedSlotVersion,
                requestObligationPending,
                requestTargetBodyVersion, requestTargetSlotVersion >>
recoveryVars == << recoveryPending, recoveryTargetValid,
                   recoveryTargetBodyVersion, recoveryTargetSlotVersion >>
vars == << versionVars, process, interestState,
          containerTreeReady, declarationCoversDocument,
          serverCoversDocument,
          probeVars, recoveryVars, abandonUsed, restartUsed,
          disconnectsUsed >>

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
       {"ready", "awaitingSocket", "socketOpen", "awaitingAck", "unavailable"}
  /\ containerTreeReady \in BOOLEAN
  /\ declarationCoversDocument \in BOOLEAN
  /\ serverCoversDocument \in BOOLEAN
  /\ probeRequested \in BOOLEAN
  /\ probeInFlight \in BOOLEAN
  /\ newerRequestDuringFlight \in BOOLEAN
  /\ requestObligationPending \in BOOLEAN
  /\ recoveryPending \in BOOLEAN
  /\ recoveryTargetValid \in BOOLEAN
  /\ startupProbeDeferred \in BOOLEAN
  /\ abandonUsed \in BOOLEAN
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
  /\ startupProbeDeferred = FALSE
  /\ abandonUsed = FALSE
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
                    capturedBodyVersion, capturedSlotVersion, startupProbeDeferred,
                    recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

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
                    capturedBodyVersion, capturedSlotVersion, startupProbeDeferred,
                    recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

(* A retained disconnect preserves accepted local work. Only hints emitted *)
(* while authoritative server interest is not ready can be absent from it. *)
DisconnectEvents ==
  /\ process = "running"
  /\ interestState = "ready"
  /\ disconnectsUsed < MaxDisconnects
  /\ interestState' = "awaitingSocket"
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = FALSE
  /\ recoveryPending' = TRUE
  /\ recoveryTargetValid' = FALSE
  /\ disconnectsUsed' = disconnectsUsed + 1
  /\ UNCHANGED << versionVars, process, containerTreeReady, probeVars,
                  recoveryTargetBodyVersion, recoveryTargetSlotVersion,
                  abandonUsed, restartUsed >>

(* A socket opens with no server interest, so opening is not readiness.     *)
(* The client must first obtain its authoritative local container tree.      *)
OpenEventsSocket ==
  /\ process = "running"
  /\ interestState = "awaitingSocket"
  /\ recoveryPending
  /\ interestState' = "socketOpen"
  /\ serverCoversDocument' = FALSE
  /\ UNCHANGED << versionVars, process, containerTreeReady,
                  declarationCoversDocument, probeVars,
                  recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

(* SQLite/container reconciliation may become ready before or after open.    *)
MarkContainerTreeReady ==
  /\ process = "running"
  /\ ~containerTreeReady
  /\ containerTreeReady' = TRUE
  /\ UNCHANGED << versionVars, process, interestState,
                  declarationCoversDocument, serverCoversDocument,
                  probeVars, recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

(* The authoritative known-containers declaration is sent only from a ready *)
(* local tree. Its declaration identity is represented by awaitingAck: an    *)
(* acknowledgement from an older connection cannot cross another state.     *)
DeclareKnownContainers ==
  /\ process = "running"
  /\ interestState = "socketOpen"
  /\ DeclareFromReadyTree => containerTreeReady
  /\ interestState' = "awaitingAck"
  /\ declarationCoversDocument' = containerTreeReady
  /\ UNCHANGED << versionVars, process,
                  containerTreeReady, serverCoversDocument,
                  probeVars, recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

(* The matching ack proves that the server applied interest covering this  *)
(* document. Only this barrier records the gap target and queues its probe. *)
AcknowledgeKnownContainers ==
  /\ process = "running"
  /\ interestState = "awaitingAck"
  /\ declarationCoversDocument
  /\ interestState' = "ready"
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = TRUE
  \* A startup probe that waited on this attempt is handed to the ack's probe;
  \* the ArmProbeOnAck control isolates the reconnect probe itself.
  /\ probeRequested' =
       (ArmProbeOnAck \/ startupProbeDeferred \/ probeRequested)
  /\ newerRequestDuringFlight' =
       IF probeInFlight /\ (ArmProbeOnAck \/ startupProbeDeferred)
         THEN TRUE
         ELSE newerRequestDuringFlight
  /\ requestObligationPending' = TRUE
  /\ requestTargetBodyVersion' = remoteBodyVersion
  /\ requestTargetSlotVersion' = remoteSlotVersion
  /\ recoveryTargetValid' = TRUE
  /\ recoveryTargetBodyVersion' = remoteBodyVersion
  /\ recoveryTargetSlotVersion' = remoteSlotVersion
  \* The ack's probe covers a startup probe that waited on this attempt.
  /\ startupProbeDeferred' = FALSE
  /\ UNCHANGED << versionVars, process, containerTreeReady, probeInFlight,
                  capturedBodyVersion, capturedSlotVersion,
                  recoveryPending, abandonUsed, restartUsed, disconnectsUsed >>

(* A connect attempt can end without an acknowledgement: no ticket, a     *)
(* failed or stalled socket, a tree not ready at open, or sync turned off. *)
(* Interest is then unavailable, possibly for good. A startup probe that   *)
(* waited on the attempt must run now; no reconnect probe will cover it.   *)
AbandonEventsConnect ==
  /\ process = "running"
  /\ interestState \in {"awaitingSocket", "socketOpen", "awaitingAck"}
  /\ ~abandonUsed
  /\ interestState' = "unavailable"
  /\ declarationCoversDocument' = FALSE
  /\ abandonUsed' = TRUE
  /\ LET release == startupProbeDeferred /\ ReleaseDeferredProbeOnAbandon IN
       /\ probeRequested' = (release \/ probeRequested)
       /\ newerRequestDuringFlight' =
            IF release /\ probeInFlight THEN TRUE ELSE newerRequestDuringFlight
  /\ startupProbeDeferred' = FALSE
  /\ UNCHANGED << versionVars, process, containerTreeReady,
                  serverCoversDocument, probeInFlight,
                  capturedBodyVersion, capturedSlotVersion,
                  requestObligationPending,
                  requestTargetBodyVersion, requestTargetSlotVersion,
                  recoveryVars, restartUsed, disconnectsUsed >>

(* A later attempt may start again; nothing obliges it to. *)
ResumeEventsConnect ==
  /\ process = "running"
  /\ interestState = "unavailable"
  /\ interestState' = "awaitingSocket"
  /\ UNCHANGED << versionVars, process, containerTreeReady,
                  declarationCoversDocument, serverCoversDocument,
                  probeVars, recoveryVars, abandonUsed, restartUsed,
                  disconnectsUsed >>

(* Restart destroys only process-local requests and an in-flight response. *)
Restart ==
  /\ process = "running"
  /\ ~restartUsed
  /\ process' = "stopped"
  /\ interestState' = "awaitingSocket"
  /\ containerTreeReady' = FALSE
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = FALSE
  /\ probeRequested' = FALSE
  /\ probeInFlight' = FALSE
  /\ newerRequestDuringFlight' = FALSE
  /\ requestObligationPending' = FALSE
  /\ startupProbeDeferred' = FALSE
  /\ recoveryPending' = TRUE
  /\ recoveryTargetValid' = FALSE
  /\ restartUsed' = TRUE
  /\ UNCHANGED << versionVars, capturedBodyVersion, capturedSlotVersion,
                  requestTargetBodyVersion, requestTargetSlotVersion,
                  recoveryTargetBodyVersion, recoveryTargetSlotVersion,
                  abandonUsed, disconnectsUsed >>

(* Loading an opened persisted remote row requests a startup probe. The    *)
(* declaration/ack barrier is still outstanding and will request another   *)
(* probe if its acknowledgement arrives while this one is in flight. When  *)
(* the document loads while a connect attempt is in flight (`defer`), the  *)
(* startup probe waits on that attempt instead: its acknowledgement arms   *)
(* the covering probe, and its abandonment releases the deferred one.      *)
InitializeOpenedPersistedDocument(defer) ==
  /\ process = "stopped"
  /\ recoveryPending
  /\ defer \in BOOLEAN
  /\ process' = "running"
  /\ interestState' = "awaitingSocket"
  /\ containerTreeReady' = FALSE
  /\ declarationCoversDocument' = FALSE
  /\ serverCoversDocument' = FALSE
  /\ probeRequested' = ~defer
  /\ startupProbeDeferred' = defer
  /\ probeInFlight' = FALSE
  /\ newerRequestDuringFlight' = FALSE
  /\ requestObligationPending' = TRUE
  /\ requestTargetBodyVersion' = remoteBodyVersion
  /\ requestTargetSlotVersion' = remoteSlotVersion
  /\ UNCHANGED << versionVars, capturedBodyVersion, capturedSlotVersion,
                  recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

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
                  serverCoversDocument, startupProbeDeferred,
                  requestObligationPending,
                  requestTargetBodyVersion, requestTargetSlotVersion,
                  recoveryVars, abandonUsed, restartUsed, disconnectsUsed >>

(* Finishing applies only the captured response. An ack or delivered hint    *)
(* queued during the request remains queued, exactly like the sequence guard. *)
FinishProbe ==
  /\ process = "running"
  /\ probeInFlight
  /\ localBodyVersion' = capturedBodyVersion
  /\ localSlotVersion' = capturedSlotVersion
  /\ probeInFlight' = FALSE
  /\ probeRequested' = (KeepQueuedRequestAcrossFlight /\ probeRequested)
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
                  recoveryTargetValid, startupProbeDeferred,
                  recoveryTargetBodyVersion, recoveryTargetSlotVersion,
                  abandonUsed, restartUsed, disconnectsUsed >>

Next ==
  \/ \E delivered \in BOOLEAN : RemoteBodyAdvance(delivered)
  \/ \E delivered \in BOOLEAN : RemoteSlotAdvance(delivered)
  \/ DisconnectEvents
  \/ OpenEventsSocket
  \/ MarkContainerTreeReady
  \/ DeclareKnownContainers
  \/ AcknowledgeKnownContainers
  \/ AbandonEventsConnect
  \/ ResumeEventsConnect
  \/ Restart
  \/ \E defer \in BOOLEAN : InitializeOpenedPersistedDocument(defer)
  \/ BeginProbe
  \/ FinishProbe
  \/ UNCHANGED vars

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ WF_vars(\E defer \in BOOLEAN : InitializeOpenedPersistedDocument(defer))
  /\ WF_vars(OpenEventsSocket)
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
  /\ requestObligationPending =>
       probeRequested \/ probeInFlight \/ startupProbeDeferred

(* A deferred startup probe waits only on a connect attempt in flight, and  *)
(* nothing else can request a probe before that attempt acknowledges.      *)
DeferredStartupProbeAwaitsAttempt ==
  startupProbeDeferred =>
    /\ process = "running"
    /\ interestState \in {"awaitingSocket", "socketOpen", "awaitingAck"}
    /\ ~probeRequested
    /\ ~probeInFlight

StoppedProcessAwaitsSocket ==
  process = "stopped" => interestState = "awaitingSocket"

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
    => /\ probeRequested' \/ startupProbeDeferred'
       /\ interestState' = "awaitingSocket"

OpenedInitializationArmsStartupProbe ==
  [][InitializationArmsStartupProbe]_vars

DisconnectPreservesAcceptedWork ==
  (process = "running" /\ process' = "running"
    /\ interestState = "ready"
    /\ interestState' = "awaitingSocket")
    => /\ probeRequested' = probeRequested
       /\ probeInFlight' = probeInFlight
       /\ newerRequestDuringFlight' = newerRequestDuringFlight

RetainedDisconnectPreservesAcceptedWork ==
  [][DisconnectPreservesAcceptedWork]_vars

SocketOpenWaitsForAuthoritativeDeclaration ==
  (process = "running"
    /\ interestState = "awaitingSocket"
    /\ interestState' = "socketOpen")
    => /\ ~serverCoversDocument'
       /\ probeRequested' = probeRequested
       /\ probeInFlight' = probeInFlight

OpenSocketWaitsForAuthoritativeDeclaration ==
  [][SocketOpenWaitsForAuthoritativeDeclaration]_vars

DeclarationUsesReadyContainerTree ==
  (interestState = "socketOpen" /\ interestState' = "awaitingAck")
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
      => <> ((~recoveryPending /\ RecoveryTargetCovered)
             \/ interestState = "unavailable"))

=======================================================================
