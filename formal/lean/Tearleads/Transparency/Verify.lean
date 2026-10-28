import Tearleads.Transparency.Tree

/-!
# Proof verification

`assertTransparencyInclusion` and `assertTransparencyConsistency` from
`transparencyProofs.ts`, check for check and in the same order, so each
refusal carries the `KeyingVerificationCode` production throws. Input
normalization (exact keys, integer and hash shapes) and the log-id and
proof-size equality checks are outside the model: a proof's sizes are the
checkpoint sizes here.
-/

namespace Tearleads.Transparency

/-- The `KeyingVerificationCode` values the transparency verifiers throw. -/
inductive Code where
  | equivocation
  | hashMismatch
  | invalidShape
  | missingDependency
  | rollback
  deriving DecidableEq, Repr

def Code.name : Code → String
  | .equivocation => "equivocation"
  | .hashMismatch => "hash_mismatch"
  | .invalidShape => "invalid_shape"
  | .missingDependency => "missing_dependency"
  | .rollback => "rollback"

/-- A verifier's result: accepted, or refused with the code production
reports. -/
inductive Outcome where
  | accepted
  | refused (code : Code)
  deriving DecidableEq, Repr

def Outcome.name : Outcome → String
  | .accepted => "ok"
  | .refused code => code.name

/-- `computeRoot` in `computeTransparencyInclusionRoot`. The audit path
arrives reversed, so the outermost sibling is consumed first; the
unconsumed rest is returned for the extra-node check. -/
def inclusionRootAux (leafDigest : Digest) :
    Nat → Nat → Nat → List Digest → Except Code (Digest × List Digest)
  | _, _, 1, rest => .ok (leafDigest, rest)
  | 0, _, _, _ => .error .missingDependency
  | _ + 1, _, _, [] => .error .missingDependency
  | fuel + 1, index, size, sibling :: rest =>
    let split := splitPoint size
    if index < split then do
      let (computed, rest) ← inclusionRootAux leafDigest fuel index split rest
      pure (.node computed sibling, rest)
    else do
      let (computed, rest) ←
        inclusionRootAux leafDigest fuel (index - split) (size - split) rest
      pure (.node sibling computed, rest)

/-- `assertTransparencyInclusion` against a checkpoint of `treeSize` and
`rootDigest`. A zero `treeSize` models `readPositiveInteger` refusing it. -/
def verifyInclusion (leafDigest : Digest) (leafIndex treeSize : Nat)
    (rootDigest : Digest) (auditPath : List Digest) : Outcome :=
  if treeSize = 0 ∨ treeSize ≤ leafIndex then .refused .invalidShape
  else
    match inclusionRootAux leafDigest treeSize leafIndex treeSize auditPath.reverse with
    | .error code => .refused code
    | .ok (_, _ :: _) => .refused .invalidShape
    | .ok (computed, []) =>
      if computed = rootDigest then .accepted else .refused .hashMismatch

/-- Halves both walk indices while `continue?` holds of the first. -/
def halveWhile (continue? : Nat → Bool) : Nat → Nat → Nat → Nat × Nat
  | 0, first, second => (first, second)
  | fuel + 1, first, second =>
    if continue? first then halveWhile continue? fuel (first / 2) (second / 2)
    else (first, second)

/-- The state of the RFC 9162 §2.1.4.2 walk: the RFC's `fn` and `sn`, and the
two roots folded from the node stream. -/
structure Walk where
  first : Nat
  second : Nat
  previousRoot : Digest
  currentRoot : Digest

/-- One iteration of the node loop in
`computeTransparencyConsistencyProofRoots`. -/
def walkStep (walk : Walk) (node : Digest) : Except Code Walk :=
  if walk.second = 0 then .error .invalidShape
  else if walk.first % 2 = 1 ∨ walk.first = walk.second then
    let (first, second) :=
      halveWhile (fun index => index % 2 == 0 && index != 0) (walk.first + 1)
        walk.first walk.second
    .ok {
      first := first / 2
      second := second / 2
      previousRoot := .node node walk.previousRoot
      currentRoot := .node node walk.currentRoot
    }
  else
    .ok { walk with
      first := walk.first / 2
      second := walk.second / 2
      currentRoot := .node walk.currentRoot node }

/-- `computeTransparencyConsistencyProofRoots` for
`0 < previousSize < size`. -/
def consistencyRoots (previousSize size : Nat) (previousRoot : Digest)
    (nodes : List Digest) : Except Code (Digest × Digest) := do
  let (first, second) :=
    halveWhile (fun index => index % 2 == 1) previousSize (previousSize - 1) (size - 1)
  -- A power-of-two previous tree is a complete subtree of the current one,
  -- so its own root seeds the walk.
  match (if first = 0 then previousRoot :: nodes else nodes) with
  | [] => .error .missingDependency
  | seed :: rest =>
    let walk ← rest.foldlM walkStep
      { first, second, previousRoot := seed, currentRoot := seed }
    if walk.second ≠ 0 then .error .missingDependency
    else pure (walk.previousRoot, walk.currentRoot)

/-- `assertTransparencyConsistency` between a previous checkpoint
(`previousSize`, `previousRoot`) and a current one (`size`, `currentRoot`). -/
def verifyConsistency (previousSize : Nat) (previousRoot : Digest) (size : Nat)
    (currentRoot : Digest) (nodes : List Digest) : Outcome :=
  if size < previousSize then .refused .rollback
  else if (previousSize = 0 ∧ previousRoot ≠ .empty) ∨
      (size = 0 ∧ currentRoot ≠ .empty) then .refused .hashMismatch
  else if previousSize = 0 then
    if nodes.isEmpty then .accepted else .refused .invalidShape
  else if previousSize = size then
    if !nodes.isEmpty then .refused .invalidShape
    else if previousRoot ≠ currentRoot then .refused .equivocation
    else .accepted
  else
    match consistencyRoots previousSize size previousRoot nodes with
    | .error code => .refused code
    | .ok (computedPrevious, computedCurrent) =>
      if computedPrevious ≠ previousRoot then .refused .hashMismatch
      else if computedCurrent ≠ currentRoot then .refused .hashMismatch
      else .accepted

end Tearleads.Transparency
