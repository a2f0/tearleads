--------------------------- MODULE ContainerDepth ---------------------------
EXTENDS Integers, FiniteSets

CONSTANTS Nodes, Root, MaxPathLength, GuardCreateDepth,
          GuardMoveDepth, GuardSubtreeDepth
ASSUME /\ Root \in Nodes
       /\ MaxPathLength > 0
       /\ {GuardCreateDepth, GuardMoveDepth, GuardSubtreeDepth} \subseteq BOOLEAN

VARIABLES live, parent, depth
vars == <<live, parent, depth>>

RECURSIVE Ancestors(_, _)
Ancestors(parents, node) ==
  IF node = Root THEN {} ELSE {parents[node]} \cup Ancestors(parents, parents[node])

Subtree(node) == {child \in live : child = node \/ node \in Ancestors(parent, child)}

Init ==
  /\ live = {Root}
  /\ parent = [node \in Nodes |-> Root]
  /\ depth = [node \in Nodes |-> 0]

Create(node, destination) ==
  /\ node \in Nodes \ live
  /\ destination \in live
  /\ ~GuardCreateDepth \/ depth[destination] + 1 < MaxPathLength
  /\ live' = live \cup {node}
  /\ parent' = [parent EXCEPT ![node] = destination]
  /\ depth' = [depth EXCEPT ![node] = depth[destination] + 1]

Move(node, destination) ==
  /\ node \in live \ {Root}
  /\ destination \in live \ Subtree(node)
  /\ LET delta == depth[destination] + 1 - depth[node]
         moved == Subtree(node)
     IN /\ ~GuardMoveDepth \/ depth[destination] + 1 < MaxPathLength
        /\ ~GuardSubtreeDepth \/
             \A child \in moved \ {node} : depth[child] + delta < MaxPathLength
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
HonestReadsAvailable == \A node \in live : depth[node] < MaxPathLength
=============================================================================
