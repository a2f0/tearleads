--------------------- MODULE SyncLaneConcurrency ---------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Workers, EnforceBound, EnforceBarrier, EnforceExclusivity,
          PreserveTrailing, IsolateBackoff
ASSUME Workers \in Nat \ {0}
ASSUME {EnforceBound, EnforceBarrier, EnforceExclusivity,
        PreserveTrailing, IsolateBackoff} \subseteq BOOLEAN

Documents == {"a", "b", "c"}
Lanes == Documents \cup {"structure"}
VARIABLES requested, running, occupied, cooldown, completed,
          rearmed, failed, timedOut, overlap, badStart
vars == <<requested, running, occupied, cooldown, completed,
          rearmed, failed, timedOut, overlap, badStart>>

Init ==
  /\ requested = Lanes
  /\ running = {}
  /\ occupied = {}
  /\ cooldown = {}
  /\ completed = {}
  /\ rearmed = {}
  /\ failed = FALSE
  /\ timedOut = {}
  /\ overlap = FALSE
  /\ badStart = FALSE

BarrierAllows(lane) ==
  IF lane = "structure" THEN running = {}
  ELSE "structure" \notin running
       /\ ~("structure" \in requested /\ "structure" \notin occupied)

CanStart(lane) ==
  /\ lane \in requested \ cooldown
  /\ ~EnforceExclusivity \/ lane \notin occupied
  /\ ~EnforceBound \/ Cardinality(running) < Workers
  /\ ~EnforceBarrier \/ BarrierAllows(lane)
  /\ IsolateBackoff \/ cooldown = {}

Start(lane) ==
  /\ CanStart(lane)
  /\ requested' = requested \ {lane}
  /\ running' = running \cup {lane}
  /\ occupied' = occupied \cup {lane}
  /\ overlap' = (overlap \/ lane \in occupied)
  /\ badStart' = (badStart \/ ~BarrierAllows(lane))
  /\ UNCHANGED <<cooldown, completed, rearmed, failed, timedOut>>

(* A hint, structural mutation, or self-follow-up can arrive during a run. *)
RequestOnce(lane) ==
  /\ lane \notin rearmed
  /\ requested' = requested \cup {lane}
  /\ rearmed' = rearmed \cup {lane}
  /\ UNCHANGED <<running, occupied, cooldown, completed, failed,
                  timedOut, overlap, badStart>>

Finish(lane) ==
  /\ lane \in occupied
  /\ running' = running \ {lane}
  /\ occupied' = occupied \ {lane}
  /\ completed' = completed \cup {lane}
  /\ requested' = IF PreserveTrailing THEN requested ELSE requested \ {lane}
  /\ UNCHANGED <<cooldown, rearmed, failed, timedOut, overlap, badStart>>

(* The watchdog returns a worker but the callback retains its lane token. *)
Watchdog(lane) ==
  /\ lane \in running \ timedOut
  /\ running' = running \ {lane}
  /\ timedOut' = timedOut \cup {lane}
  /\ UNCHANGED <<requested, occupied, cooldown, completed, rearmed,
                  failed, overlap, badStart>>

Fail ==
  /\ "a" \in running
  /\ ~failed
  /\ running' = running \ {"a"}
  /\ occupied' = occupied \ {"a"}
  /\ requested' = requested \cup {"a"}
  /\ cooldown' = {"a"}
  /\ failed' = TRUE
  /\ UNCHANGED <<completed, rearmed, timedOut, overlap, badStart>>

BackoffExpires ==
  /\ cooldown # {}
  /\ cooldown' = {}
  /\ UNCHANGED <<requested, running, occupied, completed, rearmed,
                  failed, timedOut, overlap, badStart>>

Next == (\E lane \in Lanes : Start(lane) \/ RequestOnce(lane)
                           \/ Finish(lane) \/ Watchdog(lane))
        \/ Fail \/ BackoffExpires \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars /\ WF_vars(BackoffExpires)
        /\ (\A lane \in Lanes : WF_vars(Start(lane)) /\ WF_vars(Finish(lane)))

TypeOK ==
  /\ {requested, running, occupied, cooldown, completed, rearmed, timedOut}
       \subseteq SUBSET Lanes
  /\ {failed, overlap, badStart} \subseteq BOOLEAN
  /\ running \subseteq occupied
BoundedWorkers == Cardinality(running) <= Workers
ExclusiveLane == ~overlap
StructuralBarrier == ~badStart
BackoffIsLocal ==
  \A lane \in Documents :
    (lane \in requested \ (occupied \cup cooldown)
      /\ Cardinality(running) < Workers /\ BarrierAllows(lane)) => CanStart(lane)
TrailingRequestSurvives ==
  [][\A lane \in Lanes :
       (lane \in occupied /\ lane \notin occupied' /\ lane \in requested)
         => lane \in requested']_vars
AllLanesProgress == <> (completed = Lanes)
======================================================================
