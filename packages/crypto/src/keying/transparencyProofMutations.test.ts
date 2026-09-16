import { expect, test } from "bun:test";
import {
  computeTransparencyMerkleRoot,
  type TransparencyConsistencyProof,
  type TransparencyInclusionProof,
  verifyTransparencyConsistencyProof,
  verifyTransparencyInclusionProof,
} from "./index";
import {
  checkpoint,
  expectCode,
  foreignNodeHash,
  honestConsistency,
  honestInclusion,
  leafHashes,
  MUTATION_TREE_SIZE,
  replaced,
  swapped,
  withAuditPath,
  withNodes,
} from "./transparencyProofs.testFixtures";

/**
 * Mutation negatives for every prefix and every leaf through size 32: each
 * honest proof is accepted here before deleting or replacing each node,
 * swapping each adjacent pair, or appending a foreign node. These mutations
 * and decoy checkpoints must be refused with the documented error code.
 */

test("consistency mutations at every node position through size 32 are refused", async () => {
  const leaves = await leafHashes();
  const foreign = await foreignNodeHash();
  let cases = 0;
  for (let treeSize = 2; treeSize <= MUTATION_TREE_SIZE; treeSize += 1) {
    for (let previous = 1; previous < treeSize; previous += 1) {
      const honest = await honestConsistency(previous, treeSize);
      const nodes = honest.proof.nodeHashes;
      const label = `${previous} → ${treeSize}`;
      const verify = (proof: TransparencyConsistencyProof) =>
        verifyTransparencyConsistencyProof({ ...honest, proof });

      expect((await verify(honest.proof)).ok).toBe(true);
      expectCode(
        `${label} appended node`,
        await verify(withNodes(honest.proof, [...nodes, foreign])),
        "invalid_shape",
      );
      cases += 1;
      for (let index = 0; index < nodes.length; index += 1) {
        expectCode(
          `${label} dropped node ${index}`,
          await verify(
            withNodes(
              honest.proof,
              nodes.filter((_, at) => at !== index),
            ),
          ),
          "missing_dependency",
        );
        expectCode(
          `${label} replaced node ${index}`,
          await verify(
            withNodes(honest.proof, replaced(nodes, index, foreign)),
          ),
          "hash_mismatch",
        );
        cases += 2;
      }
      for (let index = 0; index + 1 < nodes.length; index += 1) {
        expectCode(
          `${label} swapped nodes ${index},${index + 1}`,
          await verify(withNodes(honest.proof, swapped(nodes, index))),
          "hash_mismatch",
        );
        cases += 1;
      }

      // A decoy tree that differs at the last leaf of the prefix: neither
      // its prefix root nor its full root fits the honest proof.
      const decoyLeaves = replaced(
        leaves.slice(0, treeSize),
        previous - 1,
        foreign,
      );
      const decoyPrevious = await computeTransparencyMerkleRoot(
        decoyLeaves.slice(0, previous),
      );
      const decoyCurrent = await computeTransparencyMerkleRoot(decoyLeaves);
      expectCode(
        `${label} decoy previous checkpoint`,
        await verifyTransparencyConsistencyProof({
          ...honest,
          previousCheckpoint: checkpoint(previous, decoyPrevious),
        }),
        "hash_mismatch",
      );
      expectCode(
        `${label} decoy current checkpoint`,
        await verifyTransparencyConsistencyProof({
          ...honest,
          checkpoint: checkpoint(treeSize, decoyCurrent),
        }),
        "hash_mismatch",
      );
      cases += 2;
    }
  }
  expect(cases).toBeGreaterThanOrEqual(496 * 5);
});

test("inclusion mutations at every node position through size 32 are refused", async () => {
  const foreign = await foreignNodeHash();
  let cases = 0;
  for (let treeSize = 1; treeSize <= MUTATION_TREE_SIZE; treeSize += 1) {
    for (let leafIndex = 0; leafIndex < treeSize; leafIndex += 1) {
      const honest = await honestInclusion(treeSize, leafIndex);
      const path = honest.proof.auditPath;
      const label = `leaf ${leafIndex} of ${treeSize}`;
      const verify = (proof: TransparencyInclusionProof) =>
        verifyTransparencyInclusionProof({ ...honest, proof });

      expect((await verify(honest.proof)).ok).toBe(true);
      expectCode(
        `${label} foreign leaf`,
        await verifyTransparencyInclusionProof({
          ...honest,
          leafHash: foreign,
        }),
        "hash_mismatch",
      );
      expectCode(
        `${label} appended node`,
        await verify(withAuditPath(honest.proof, [...path, foreign])),
        "invalid_shape",
      );
      expectCode(
        `${label} index out of range`,
        await verify({ ...honest.proof, leafIndex: treeSize }),
        "invalid_shape",
      );
      expectCode(
        `${label} tree size mismatch`,
        await verifyTransparencyInclusionProof({
          ...honest,
          checkpoint: checkpoint(treeSize + 1, honest.checkpoint.rootHash),
        }),
        "object_mismatch",
      );
      cases += 4;
      for (let index = 0; index < path.length; index += 1) {
        expectCode(
          `${label} dropped node ${index}`,
          await verify(
            withAuditPath(
              honest.proof,
              path.filter((_, at) => at !== index),
            ),
          ),
          "missing_dependency",
        );
        expectCode(
          `${label} replaced node ${index}`,
          await verify(
            withAuditPath(honest.proof, replaced(path, index, foreign)),
          ),
          "hash_mismatch",
        );
        cases += 2;
      }
      for (let index = 0; index + 1 < path.length; index += 1) {
        expectCode(
          `${label} swapped nodes ${index},${index + 1}`,
          await verify(withAuditPath(honest.proof, swapped(path, index))),
          "hash_mismatch",
        );
        cases += 1;
      }
      if (treeSize > 1) {
        // The path belongs to one leaf position; another position either
        // needs a different path length or folds it in the wrong order.
        const misattributed = await verify({
          ...honest.proof,
          leafIndex: (leafIndex + 1) % treeSize,
        });
        expect(misattributed.ok).toBe(false);
        cases += 1;
      }
    }
  }
  expect(cases).toBeGreaterThanOrEqual(528 * 4);
});
