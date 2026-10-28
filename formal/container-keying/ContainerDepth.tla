--------------------------- MODULE ContainerDepth ---------------------------
EXTENDS Integers, FiniteSets

(* Writers commit paths up to CommitMax containers; each reader walks a   *)
(* path up to its own bound. Production shares one constant between them; *)
(* the model keeps them apart so a reader bound below the commit bound is  *)
(* an expressible fault (#2365 H1).                                        *)
CONSTANTS Nodes, Root, CommitMax, ApiReadMax, ClientReadMax,
          GuardCreateDepth, GuardMoveDepth, GuardSubtreeDepth, GuardMoveCycle
ASSUME /\ Root \in Nodes
       /\ {CommitMax, ApiReadMax, ClientReadMax} \subseteq Nat \ {0}
       /\ {GuardCreateDepth, GuardMoveDepth, GuardSubtreeDepth, GuardMoveCycle}
            \subseteq BOOLEAN

VARIABLES live, parent, depth
vars == <<live, parent, depth>>

(* Bounded by the node count, so a parent cycle terminates the walk. *)
RECURSIVE AncestorsWithin(_, _, _)
AncestorsWithin(parents, node, steps) ==
  IF node = Root \/ steps = 0 THEN {}
  ELSE {parents[node]} \cup AncestorsWithin(parents, parents[node], steps - 1)
Ancestors(parents, node) == AncestorsWithin(parents, node, Cardinality(Nodes))

Subtree(node) == {child \in live : child = node \/ node \in Ancestors(parent, child)}

Init ==
  /\ live = {Root}
  /\ parent = [node \in Nodes |-> Root]
  /\ depth = [node \in Nodes |-> 0]

Create(node, destination) ==
  /\ node \in Nodes \ live
  /\ destination \in live
  /\ ~GuardCreateDepth \/ depth[destination] + 1 < CommitMax
  /\ live' = live \cup {node}
  /\ parent' = [parent EXCEPT ![node] = destination]
  /\ depth' = [depth EXCEPT ![node] = depth[destination] + 1]

Move(node, destination) ==
  /\ node \in live \ {Root}
  /\ destination \in live
  /\ GuardMoveCycle => destination \notin Subtree(node)
  /\ LET delta == depth[destination] + 1 - depth[node]
         moved == Subtree(node)
     IN /\ ~GuardMoveDepth \/ depth[destination] + 1 < CommitMax
        /\ ~GuardSubtreeDepth \/
             \A child \in moved \ {node} : depth[child] + delta < CommitMax
        /\ depth' = [child \in Nodes |->
             IF child \in moved THEN depth[child] + delta ELSE depth[child]]
  /\ parent' = [parent EXCEPT ![node] = destination]
  /\ UNCHANGED live

Next == (\E node, destination \in Nodes : Create(node, destination) \/ Move(node, destination))
Spec == Init /\ [][Next]_vars

TypeOK == /\ live \subseteq Nodes /\ Root \in live
          /\ parent \in [Nodes -> Nodes]
          /\ depth \in [Nodes -> Nat]
DepthMatchesParents == \A node \in live : depth[node] = Cardinality(Ancestors(parent, node))
(* Every container a writer committed stays readable by every reader. *)
HonestReadsAvailable ==
  \A node \in live : depth[node] < CommitMax /\ depth[node] < ApiReadMax /\ depth[node] < ClientReadMax
(* Every live container reaches the root. *)
PathsReachRoot == \A node \in live \ {Root} : node \notin Ancestors(parent, node)
=============================================================================
