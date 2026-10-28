import Tearleads.Transparency.Generate
import Tearleads.Transparency.Theorems

/-!
# Vector export

Cases for `formal/lean/vectors/transparency.json`, which
`packages/crypto/src/keying/transparencyLeanVectors.test.ts` replays through
the production generator and verifiers. Every digest is named by the leaf
range it is the root of, so the replay hashes the same ranges with the real
domain hashes and must reach the outcome the model records here.

Honest proofs cover every size pair through `maxHonestSize`; mutations of
them cover every pair through `maxMutationSize`.
-/

namespace Tearleads.Transparency.Vectors

def leafCount : Nat := 64
def maxHonestSize : Nat := 32
def maxMutationSize : Nat := 16

/-- A leaf no tree in the fixture contains. -/
def foreign : Range := ⟨leafCount - 1, 1⟩

/-- The same-sized range one leaf to the right: a different digest. -/
def shifted (range : Range) : Range := ⟨range.lo + 1, range.size⟩

structure ConsistencyCase where
  label : String
  previousTreeSize : Nat
  previousRoot : Range
  treeSize : Nat
  root : Range
  nodes : List Range

def ConsistencyCase.outcome (c : ConsistencyCase) : Outcome :=
  verifyConsistency c.previousTreeSize (c.previousRoot.digest vectorLeaf)
    c.treeSize (c.root.digest vectorLeaf) (c.nodes.map (Range.digest vectorLeaf))

structure InclusionCase where
  label : String
  leaf : Nat
  leafIndex : Nat
  treeSize : Nat
  root : Range
  auditPath : List Range

def InclusionCase.outcome (c : InclusionCase) : Outcome :=
  verifyInclusion (.leaf (vectorLeaf c.leaf)) c.leafIndex c.treeSize
    (c.root.digest vectorLeaf) (c.auditPath.map (Range.digest vectorLeaf))

def replaceAt (ranges : List Range) (index : Nat) : List Range :=
  ranges.modify index shifted

def swapFirstPair : List Range → List Range
  | first :: second :: rest => second :: first :: rest
  | ranges => ranges

def consistencyMutations (honest : ConsistencyCase) : List ConsistencyCase :=
  let nodes := honest.nodes
  let replaced := (List.range nodes.length).map fun index =>
    { honest with label := s!"replaced-node-{index}", nodes := replaceAt nodes index }
  [{ honest with label := "appended-node", nodes := nodes ++ [foreign] }] ++
  (if nodes.isEmpty then []
   else [{ honest with label := "dropped-first-node", nodes := nodes.tail },
         { honest with label := "dropped-last-node", nodes := nodes.dropLast }]) ++
  replaced ++
  (if nodes.length < 2 then []
   else [{ honest with label := "swapped-first-pair", nodes := swapFirstPair nodes }]) ++
  (if honest.previousTreeSize = 0 then []
   else [{ honest with label := "shifted-previous-root",
                       previousRoot := shifted honest.previousRoot }]) ++
  -- The empty tree is a prefix of every tree, so from size 0 any current
  -- root is accepted; the case pins that rule rather than a refusal.
  (if honest.treeSize = 0 then []
   else [{ honest with
           label := if honest.previousTreeSize = 0 then "empty-prefix-any-root"
             else "shifted-root"
           root := shifted honest.root }]) ++
  (if honest.previousTreeSize = honest.treeSize then []
   else [{ honest with
           label := "rollback"
           previousTreeSize := honest.treeSize
           previousRoot := honest.root
           treeSize := honest.previousTreeSize
           root := honest.previousRoot }])

def consistencyCases : List ConsistencyCase :=
  (List.range (maxHonestSize + 1)).flatMap fun size =>
    (List.range (size + 1)).flatMap fun previous =>
      let honest : ConsistencyCase := {
        label := "honest"
        previousTreeSize := previous
        previousRoot := ⟨0, previous⟩
        treeSize := size
        root := ⟨0, size⟩
        nodes := consistencyPath previous size
      }
      honest :: (if size ≤ maxMutationSize then consistencyMutations honest else [])

def inclusionMutations (honest : InclusionCase) : List InclusionCase :=
  let path := honest.auditPath
  let size := honest.treeSize
  let replaced := (List.range path.length).map fun index =>
    { honest with label := s!"replaced-node-{index}", auditPath := replaceAt path index }
  [{ honest with label := "foreign-leaf", leaf := foreign.lo },
   { honest with label := "appended-node", auditPath := path ++ [foreign] },
   { honest with label := "index-out-of-bounds", leafIndex := size }] ++
  (if size < 2 then []
   else [{ honest with label := "neighbor-leaf", leaf := (honest.leaf + 1) % size },
         { honest with label := "neighbor-index", leafIndex := (honest.leafIndex + 1) % size }]) ++
  (if path.isEmpty then []
   else [{ honest with label := "dropped-last-node", auditPath := path.dropLast }]) ++
  replaced

def inclusionCases : List InclusionCase :=
  (List.range (maxHonestSize + 1)).flatMap fun size =>
    (List.range size).flatMap fun index =>
      let honest : InclusionCase := {
        label := "honest"
        leaf := index
        leafIndex := index
        treeSize := size
        root := ⟨0, size⟩
        auditPath := inclusionPath size index
      }
      honest :: (if size ≤ maxMutationSize then inclusionMutations honest else [])

def rangeJson (range : Range) : String := s!"[{range.lo},{range.size}]"

def rangesJson (ranges : List Range) : String :=
  "[" ++ ",".intercalate (ranges.map rangeJson) ++ "]"

def ConsistencyCase.json (c : ConsistencyCase) : String :=
  s!"\{\"label\":\"{c.label}\",\"previousTreeSize\":{c.previousTreeSize}," ++
  s!"\"previousRoot\":{rangeJson c.previousRoot},\"treeSize\":{c.treeSize}," ++
  s!"\"root\":{rangeJson c.root},\"nodes\":{rangesJson c.nodes}," ++
  s!"\"expect\":\"{c.outcome.name}\"}"

def InclusionCase.json (c : InclusionCase) : String :=
  s!"\{\"label\":\"{c.label}\",\"leaf\":{c.leaf},\"leafIndex\":{c.leafIndex}," ++
  s!"\"treeSize\":{c.treeSize},\"root\":{rangeJson c.root}," ++
  s!"\"auditPath\":{rangesJson c.auditPath},\"expect\":\"{c.outcome.name}\"}"

def rowsJson (rows : List String) : String :=
  "[\n    " ++ ",\n    ".intercalate rows ++ "\n  ]"

def fixture : String :=
  "{\n" ++
  "  \"$generated\": \"Generated by scripts/protocol/generateTransparencyVectors.ts " ++
  "from formal/lean (lake exe transparency-vectors); do not edit.\",\n" ++
  s!"  \"lean\": \"{Lean.versionString}\",\n" ++
  s!"  \"bounds\": \{\"leafCount\": {leafCount}, \"maxHonestSize\": {maxHonestSize}, " ++
  s!"\"maxMutationSize\": {maxMutationSize}},\n" ++
  s!"  \"consistency\": {rowsJson (consistencyCases.map ConsistencyCase.json)},\n" ++
  s!"  \"inclusion\": {rowsJson (inclusionCases.map InclusionCase.json)}\n" ++
  "}\n"

end Tearleads.Transparency.Vectors
