------------------------ MODULE ContainerMoveReplay ------------------------
(* One folder's queued move and its replay (#2556). The server can accept  *)
(* the move while this device loses the result: a stale pass, a failed     *)
(* acknowledgement, or a persistence or settlement failure. The intent     *)
(* then stays queued, and a purge of its subtree waits on it. Another      *)
(* writer may move the folder too.                                         *)
EXTENDS Naturals

CONSTANTS Parents, InitialParent, NoMove, MaxLocalMoves, MaxRemoteMoves,
          AdoptAppliedMove, RearmLostResult, SettleOnLocalClaim
ASSUME /\ InitialParent \in Parents /\ NoMove \notin Parents
       /\ MaxLocalMoves \in Nat /\ MaxRemoteMoves \in Nat
       /\ {AdoptAppliedMove, RearmLostResult, SettleOnLocalClaim}
            \subseteq BOOLEAN

None == [to |-> NoMove, revision |-> 0]

VARIABLES remoteParent, queued, revision, inFlight, armed, localMoves,
          remoteMoves, redundant, unproven
vars == <<remoteParent, queued, revision, inFlight, armed, localMoves,
          remoteMoves, redundant, unproven>>

Init ==
  /\ remoteParent = InitialParent /\ queued = NoMove /\ revision = 0
  /\ inFlight = None /\ armed = FALSE /\ localMoves = 0 /\ remoteMoves = 0
  /\ redundant = FALSE /\ unproven = FALSE

LocalParent == IF queued = NoMove THEN remoteParent ELSE queued

(* The user moves the folder: the intent takes the new destination as a    *)
(* new revision, and the move schedules a pass.                            *)
LocalMove(p) ==
  /\ localMoves < MaxLocalMoves /\ p # LocalParent
  /\ queued' = p /\ revision' = revision + 1 /\ armed' = TRUE
  /\ localMoves' = localMoves + 1
  /\ UNCHANGED <<remoteParent, inFlight, remoteMoves, redundant, unproven>>

RemoteMove(p) ==
  /\ remoteMoves < MaxRemoteMoves /\ p # remoteParent
  /\ remoteParent' = p /\ remoteMoves' = remoteMoves + 1
  /\ UNCHANGED <<queued, revision, inFlight, armed, localMoves, redundant,
                  unproven>>

(* Any pass the device runs for another reason: a write, an event, or a    *)
(* reload. Nothing guarantees one.                                         *)
UnrelatedPass ==
  /\ queued # NoMove /\ ~armed /\ armed' = TRUE
  /\ UNCHANGED <<remoteParent, queued, revision, inFlight, localMoves,
                  remoteMoves, redundant, unproven>>

(* A pass replays the intent from the verified current head. Already       *)
(* under the destination, it settles from that head and posts nothing.     *)
(* Otherwise it signs a move, which the server applies. The fault settles  *)
(* on the device's own claim without asking the server.                    *)
Replay ==
  /\ armed /\ queued # NoMove /\ inFlight = None
  /\ armed' = FALSE
  /\ IF SettleOnLocalClaim
       THEN /\ queued' = NoMove /\ unproven' = (unproven \/ remoteParent # queued)
            /\ UNCHANGED <<remoteParent, inFlight, redundant>>
     ELSE IF AdoptAppliedMove /\ remoteParent = queued
       THEN /\ queued' = NoMove
            /\ UNCHANGED <<remoteParent, inFlight, redundant, unproven>>
     ELSE /\ redundant' = (redundant \/ remoteParent = queued)
          /\ remoteParent' = queued
          /\ inFlight' = [to |-> queued, revision |-> revision]
          /\ UNCHANGED <<queued, unproven>>
  /\ UNCHANGED <<revision, localMoves, remoteMoves>>

(* The accepted result settles only the revision it answers; a newer local *)
(* move has its own pass.                                                  *)
Settle ==
  /\ inFlight # None /\ inFlight' = None
  /\ queued' = IF inFlight.revision = revision THEN NoMove ELSE queued
  /\ UNCHANGED <<remoteParent, revision, armed, localMoves, remoteMoves,
                  redundant, unproven>>

(* The result is lost. Re-armed, a later pass replays the intent.          *)
LoseResult ==
  /\ inFlight # None /\ inFlight' = None
  /\ armed' = (armed \/ RearmLostResult)
  /\ UNCHANGED <<remoteParent, queued, revision, localMoves, remoteMoves,
                  redundant, unproven>>

Next == \/ \E p \in Parents : LocalMove(p) \/ RemoteMove(p)
        \/ UnrelatedPass \/ Replay \/ Settle \/ LoseResult
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
          /\ WF_vars(Replay) /\ WF_vars(Settle \/ LoseResult)

TypeOK ==
  /\ remoteParent \in Parents /\ queued \in Parents \cup {NoMove}
  /\ revision \in Nat /\ localMoves \in Nat /\ remoteMoves \in Nat
  /\ inFlight \in [to : Parents \cup {NoMove}, revision : Nat]
  /\ {armed, redundant, unproven} \subseteq BOOLEAN
(* Each server rotation moves the folder somewhere new. *)
NoRedundantRotation == ~redundant
(* An intent settles only on the server's acceptance or a verified head    *)
(* under its destination.                                                  *)
SettleHasEvidence == ~unproven
(* No reload or unrelated write is needed for a queued move to settle. *)
QueuedMovesSettle == <>[](queued = NoMove)
=============================================================================
