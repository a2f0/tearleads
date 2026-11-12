----------------------- MODULE MemberIdentityChain -----------------------
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS MaxDepth, MaxScan, CheckPins, CheckAuthority, CheckInterval,
          CheckHistoricalTime, CheckVisited, CheckSelfAdmission, CheckDepth,
          CheckScan, RequireSignerCurrent, RefuseAll
ASSUME /\ MaxDepth \in 0..4 /\ MaxScan \in 1..5
       /\ {CheckPins, CheckAuthority, CheckInterval, CheckHistoricalTime,
           CheckVisited, CheckSelfAdmission, CheckDepth, CheckScan,
           RequireSignerCurrent, RefuseAll} \subseteq BOOLEAN

Users == {"a", "b", "c", "d"}
None == 2
Roster(us) == [u \in Users |-> IF u \in us THEN 0 ELSE None]
Event(us, signer, authority) ==
  [members |-> Roster(us), signer |-> signer, key |-> 0, authority |-> authority]
A == Event({"a"}, "a", {"a"})
AB == Event({"a", "b"}, "a", {"a"})
ABC == Event({"a", "b", "c"}, "b", {"b"})
ABCD == Event(Users, "c", {"c"})
Chain == <<A, AB, ABC, ABCD>>
Base(h, target) == [history |-> h, target |-> target,
  pins |-> [u \in Users |-> 0], roots |-> {"a"}, available |-> 1..Len(h)]

(* A finite input family, NOT all possible five-event principal histories. *)
(* Authority sets summarize each event's verified historical Admins citation. *)
Scenarios == {
  "direct", "transitive", "departed", "departedBeforeEvent", "external", "tooDeep", "tooLong",
  "removed", "readded", "forward", "unanchored", "self", "repeated",
  "badTarget", "badIntermediate", "badAnchor", "missingPin", "missingPage",
  "unauthorized", "observedAnchor"}
Scenario(name) ==
  CASE name = "direct" -> Base(<<A, AB>>, "b")
    [] name = "transitive" -> Base(Chain, "c")
    [] name = "departed" -> Base(<<A, AB, ABC,
         Event({"c"}, "a", {"a"})>>, "c")
    [] name = "departedBeforeEvent" -> Base(<<A, AB, A,
         Event({"c"}, "b", {"b"})>>, "c")
    [] name = "external" -> Base(<<Event({}, "a", {"a"}),
         Event({"b"}, "a", {"a"})>>, "b")
    [] name = "tooDeep" -> Base(Chain, "d")
    [] name = "tooLong" -> Base(<<AB, AB, AB, AB, AB>>, "b")
    [] name = "removed" -> Base(<<A, AB, A>>, "b")
    [] name = "readded" -> Base(<<Event({"a", "c"}, "a", {"a"}), A,
         Event({"a", "b", "c"}, "b", {"b"})>>, "c")
    [] name = "forward" -> Base(<<A, Event({"a", "b"}, "c", {"c"}),
         Event({"a", "b", "c"}, "a", {"a"})>>, "b")
    [] name = "unanchored" -> Base(<<Event({"b", "c"}, "c", {"c"}),
         Event({"b", "c", "d"}, "b", {"b"})>>, "d")
    [] name = "self" -> Base(<<A, Event({"a", "b"}, "b", {"b"})>>, "b")
    [] name = "repeated" -> Base(<<A, AB,
         Event({"a", "c"}, "b", {"b"}),
         Event({"a", "b", "c"}, "c", {"c"})>>, "b")
    [] name = "badTarget" -> [Base(Chain, "c") EXCEPT !.pins["c"] = 1]
    [] name = "badIntermediate" -> [Base(Chain, "c") EXCEPT !.pins["b"] = 1]
    [] name = "badAnchor" -> [Base(Chain, "c") EXCEPT !.pins["a"] = 1]
    [] name = "missingPin" -> [Base(Chain, "c") EXCEPT !.pins["b"] = None]
    [] name = "missingPage" -> [Base(Chain, "c") EXCEPT !.available = {1, 3, 4}]
    [] name = "unauthorized" -> Base(<<A, AB,
         Event({"a", "b", "c"}, "b", {"a"})>>, "c")
    [] name = "observedAnchor" -> [Base(Chain, "c") EXCEPT !.roots = {}]

Present(s, u, v) == v > 0 /\ s.history[v].members[u] # None
PinMatches(s, u, v) == s.pins[u] # None /\
  (Present(s, u, v) => s.pins[u] = s.history[v].members[u])

(* Mathematical interval oracle, independent of the scanner and fault flags. *)
IntervalStart(s, u, v) ==
  IF ~Present(s, u, v) THEN 0 ELSE
    CHOOSE k \in 1..v : /\ \A j \in k..v : Present(s, u, j)
                         /\ (k = 1 \/ ~Present(s, u, k - 1))
Latest(s, u, v) ==
  LET versions == {k \in 1..v : Present(s, u, k)}
  IN IF versions = {} THEN 0 ELSE CHOOSE k \in versions : \A j \in versions : j <= k
FirstEver(s, u, v) ==
  CHOOSE k \in 1..v : Present(s, u, k) /\
    \A j \in 1..(k - 1) : ~Present(s, u, j)

(* The independent finite signed-graph oracle: roots are ONLY self/link pins. *)
(* An edge must move to the signer's prior membership interval. Its full pin *)
(* must match the commitment, even when it is not independently verified.    *)
RECURSIVE Rooted(_, _, _, _, _)
Rooted(s, u, v, seen, remaining) ==
  IF u \in seen \/ s.pins[u] = None THEN FALSE
  ELSE IF u \in s.roots THEN TRUE
  ELSE IF Latest(s, u, v) = 0 THEN FALSE
  ELSE LET k == IntervalStart(s, u, Latest(s, u, v))
           firstRead == IF k = 1 THEN 1 ELSE k - 1
           e == s.history[k]
       IN /\ remaining > 0
          /\ Len(s.history) - firstRead + 1 <= MaxScan
          /\ firstRead..Len(s.history) \subseteq s.available
          /\ PinMatches(s, u, k)
          /\ PinMatches(s, e.signer, k)
          /\ e.signer # u /\ e.signer \in e.authority
          /\ s.pins[e.signer] = e.key
          /\ Rooted(s, e.signer, k - 1, seen \cup {u}, remaining - 1)
Expected(s) == Present(s, s.target, Len(s.history)) /\
  PinMatches(s, s.target, Len(s.history)) /\ Rooted(s, s.target, Len(s.history), {}, MaxDepth)

VARIABLES scenario, status, user, atVersion, cursor, start, seen, depth, reads,
          followedSelf, loaded
vars == <<scenario, status, user, atVersion, cursor, start, seen, depth, reads,
          followedSelf, loaded>>
Input == Scenario(scenario)
Init == /\ scenario \in Scenarios
        /\ status = "check" /\ user = Input.target
        /\ atVersion = Len(Input.history) /\ cursor = 0 /\ start = 0
        /\ seen = {} /\ depth = 0 /\ reads = 0 /\ followedSelf = FALSE /\ loaded = {}

Refuse == /\ status' = "refused"
          /\ UNCHANGED <<user, atVersion, cursor, start, seen, depth, reads,
                          followedSelf, loaded>>
Accept == /\ status' = "accepted"
          /\ UNCHANGED <<user, atVersion, cursor, start, seen, depth, reads,
                          followedSelf, loaded>>

Check ==
  /\ status = "check"
  /\ IF RefuseAll \/ Input.pins[user] = None \/
          (depth = 0 /\ ~Present(Input, user, atVersion)) \/
          (CheckPins /\ depth = 0 /\ ~PinMatches(Input, user, atVersion)) \/
          (RequireSignerCurrent /\ depth > 0 /\
            ~Present(Input, user, Len(Input.history)))
       THEN Refuse
       ELSE IF user \in Input.roots /\ depth > 0 THEN Accept
       ELSE IF (CheckVisited /\ user \in seen) \/
               (CheckDepth /\ depth >= MaxDepth) THEN Refuse
       ELSE /\ status' = "scan" /\ cursor' = Len(Input.history) /\ start' = 0
            /\ seen' = seen \cup {user}
            /\ UNCHANGED <<user, atVersion, depth, followedSelf, reads, loaded>>
  /\ UNCHANGED scenario

(* Reads are individual abstract history entries, including the predecessor *)
(* proving where the current uninterrupted run began. Missing bytes refuse. *)
Scan ==
  /\ status = "scan"
  /\ IF (CheckScan /\ reads >= MaxScan /\ cursor \notin loaded) \/
          cursor \notin Input.available
       THEN Refuse
       ELSE /\ loaded' = loaded \cup {cursor}
            /\ reads' = Cardinality(loaded \cup {cursor})
            /\ IF cursor > atVersion
                 THEN /\ cursor' = cursor - 1 /\ UNCHANGED <<status, start>>
                 ELSE IF Present(Input, user, cursor)
                   THEN /\ start' = cursor
                        /\ IF cursor = 1
                             THEN /\ status' = "follow" /\ UNCHANGED cursor
                             ELSE /\ cursor' = cursor - 1 /\ UNCHANGED status
                   ELSE IF start > 0
                     THEN /\ status' = "follow" /\ UNCHANGED <<cursor, start>>
                     ELSE IF depth = 0 \/ cursor = 1
                       THEN /\ status' = "refused" /\ UNCHANGED <<cursor, start>>
                       ELSE /\ cursor' = cursor - 1 /\ UNCHANGED <<status, start>>
            /\ UNCHANGED <<user, atVersion, seen, depth, followedSelf>>
  /\ UNCHANGED scenario

Follow ==
  /\ status = "follow"
  /\ LET k == IF CheckInterval THEN start ELSE FirstEver(Input, user, atVersion)
         e == Input.history[k]
         nextVersion == IF CheckHistoricalTime THEN k - 1 ELSE Len(Input.history)
     IN IF (CheckSelfAdmission /\ e.signer = user) \/
           (CheckAuthority /\ e.signer \notin e.authority) \/
           (CheckPins /\ (Input.pins[e.signer] # e.key \/
              ~PinMatches(Input, user, k) \/ ~PinMatches(Input, e.signer, k)))
          THEN Refuse
          ELSE /\ status' = "check" /\ user' = e.signer
               /\ atVersion' = nextVersion /\ depth' = depth + 1
               /\ followedSelf' = (followedSelf \/ e.signer = user)
               /\ UNCHANGED <<cursor, start, seen, reads, loaded>>
  /\ UNCHANGED scenario

Next == Check \/ Scan \/ Follow \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars /\ WF_vars(Check) /\ WF_vars(Scan) /\ WF_vars(Follow)
TypeOK == /\ scenario \in Scenarios /\ user \in Users
          /\ status \in {"check", "scan", "follow", "accepted", "refused"}
          /\ atVersion \in 0..5 /\ cursor \in 0..5 /\ start \in 0..5
          /\ seen \subseteq Users /\ depth \in 0..4 /\ reads \in 0..5
          /\ loaded \subseteq 1..5 /\ reads = Cardinality(loaded)
          /\ followedSelf \in BOOLEAN
(* Pin the expected positive family, so an accidentally empty oracle fails. *)
OracleMatchesExamples == Expected(Input) =
  (scenario \in {"direct", "transitive", "departed", "departedBeforeEvent", "external"} \/
   (scenario = "tooDeep" /\ MaxDepth >= 3))
AdmissionHasRootedIdentity == status = "accepted" => Expected(Input)
NoSelfVouch == ~followedSelf
NoRepeatedSigner == status = "scan" => Cardinality(seen) = depth + 1
WorkBounded == depth <= MaxDepth /\ reads <= MaxScan
HonestEvidenceAdmitted == Expected(Input) => <>(status = "accepted")
AllAttemptsTerminate == <>(status \in {"accepted", "refused"})
===========================================================================
