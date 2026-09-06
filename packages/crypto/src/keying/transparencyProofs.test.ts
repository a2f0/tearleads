import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  type VerifyTransparencyConsistencyProofInput,
  verifyTransparencyConsistencyProof,
  verifyTransparencyInclusionProof,
} from "./index";
import { expectVerificationError } from "./testFixtures";
import {
  checkpoint,
  foreignNodeHash,
  honestConsistency,
  honestInclusion,
  leafHashes,
  MATRIX_TREE_SIZE,
  oracleRoot,
  PROPERTY_RUNS,
  PROPERTY_TREE_SIZE,
  prefixRoots,
  replaced,
  swapped,
  withAuditPath,
  withNodes,
} from "./transparencyProofs.testFixtures";

/**
 * Exhaustive prefix matrices for the transparency proofs (#2192 Gate F2,
 * #2186 Gate C0a). The root oracle is an independent RFC 6962 derivation, so
 * the generator and the verifier are checked against a third computation of
 * the same tree, not only against each other. The audit that found #2186
 * accepted only 517 of 560 prefix consistency proofs through size 32,
 * failing first at 5 → 6. Mutation negatives live in
 * transparencyProofMutations.test.ts.
 */

test("Merkle roots match an independent binary-counter oracle through size 64", async () => {
  const [leaves, roots] = await Promise.all([leafHashes(), prefixRoots()]);
  for (let size = 0; size <= MATRIX_TREE_SIZE; size += 1) {
    expect(roots[size]).toBe(await oracleRoot(leaves.slice(0, size)));
  }
});

test("the 5 → 6 consistency proof has the RFC 6962 shape and verifies", async () => {
  const leaves = await leafHashes();
  const {
    proof,
    previousCheckpoint,
    checkpoint: current,
  } = await honestConsistency(5, 6);
  expect(proof.nodeHashes).toEqual([
    leaves[4] ?? "",
    leaves[5] ?? "",
    await oracleRoot(leaves.slice(0, 4)),
  ]);
  const verified = await verifyTransparencyConsistencyProof({
    previousCheckpoint,
    checkpoint: current,
    proof,
  });
  expect(verified.ok).toBe(true);
  if (verified.ok) {
    expect(verified.value).toEqual(current);
  }
});

test("every prefix consistency proof through size 64 verifies", async () => {
  const refused: string[] = [];
  let cases = 0;
  for (let treeSize = 0; treeSize <= MATRIX_TREE_SIZE; treeSize += 1) {
    for (let previous = 0; previous <= treeSize; previous += 1) {
      cases += 1;
      const result = await verifyTransparencyConsistencyProof(
        await honestConsistency(previous, treeSize),
      );
      if (!result.ok) {
        refused.push(`${previous} → ${treeSize}: ${result.error.code}`);
      }
    }
  }
  expect(cases).toBe(2145);
  expect(refused).toEqual([]);
});

test("every inclusion proof through size 64 verifies", async () => {
  const refused: string[] = [];
  let cases = 0;
  for (let treeSize = 1; treeSize <= MATRIX_TREE_SIZE; treeSize += 1) {
    for (let leafIndex = 0; leafIndex < treeSize; leafIndex += 1) {
      cases += 1;
      const result = await verifyTransparencyInclusionProof(
        await honestInclusion(treeSize, leafIndex),
      );
      if (!result.ok) {
        refused.push(`leaf ${leafIndex} of ${treeSize}: ${result.error.code}`);
      }
    }
  }
  expect(cases).toBe(2080);
  expect(refused).toEqual([]);
});

test("consistency proof shape mismatches are refused before any hashing", async () => {
  const honest = await honestConsistency(3, 7);
  const roots = await prefixRoots();
  const verify = (
    overrides: Partial<VerifyTransparencyConsistencyProofInput>,
  ) => verifyTransparencyConsistencyProof({ ...honest, ...overrides });

  expectVerificationError(
    await verify({ proof: { ...honest.proof, previousTreeSize: 4 } }),
    "object_mismatch",
  );
  expectVerificationError(
    await verify({ proof: { ...honest.proof, treeSize: 8 } }),
    "object_mismatch",
  );
  expectVerificationError(
    await verify({
      previousCheckpoint: { ...honest.previousCheckpoint, logId: "other-log" },
    }),
    "object_mismatch",
  );

  const rollback = await honestConsistency(7, 7);
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...rollback,
      previousCheckpoint: checkpoint(9, roots[9] ?? ""),
      proof: { ...rollback.proof, previousTreeSize: 9 },
    }),
    "rollback",
  );
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...rollback,
      previousCheckpoint: checkpoint(7, roots[6] ?? ""),
    }),
    "equivocation",
  );
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...rollback,
      proof: withNodes(rollback.proof, [roots[1] ?? ""]),
    }),
    "invalid_shape",
  );

  const fromEmpty = await honestConsistency(0, 5);
  expect((await verifyTransparencyConsistencyProof(fromEmpty)).ok).toBe(true);
  const emptyToEmpty = await honestConsistency(0, 0);
  expect((await verifyTransparencyConsistencyProof(emptyToEmpty)).ok).toBe(
    true,
  );
  // An empty tree has one valid root; 0 → 0 must not accept any other.
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...emptyToEmpty,
      checkpoint: checkpoint(0, roots[1] ?? ""),
    }),
    "hash_mismatch",
  );
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...emptyToEmpty,
      previousCheckpoint: checkpoint(0, roots[1] ?? ""),
      checkpoint: checkpoint(0, roots[1] ?? ""),
    }),
    "hash_mismatch",
  );
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...fromEmpty,
      proof: withNodes(fromEmpty.proof, [roots[1] ?? ""]),
    }),
    "invalid_shape",
  );
  expectVerificationError(
    await verifyTransparencyConsistencyProof({
      ...fromEmpty,
      previousCheckpoint: checkpoint(0, roots[1] ?? ""),
    }),
    "hash_mismatch",
  );
});

const treeSizeArb = fc.integer({ min: 1, max: PROPERTY_TREE_SIZE });

test("property: a random prefix proof verifies and any node mutation is refused", async () => {
  const foreign = await foreignNodeHash();
  await fc.assert(
    fc.asyncProperty(
      treeSizeArb.chain((treeSize) =>
        fc.tuple(
          fc.constant(treeSize),
          fc.integer({ min: 0, max: treeSize }),
          fc.constantFrom("drop", "append", "replace", "swap"),
          fc.nat(),
        ),
      ),
      async ([treeSize, previous, mutation, pick]) => {
        const honest = await honestConsistency(previous, treeSize);
        const accepted = await verifyTransparencyConsistencyProof(honest);
        expect(accepted.ok).toBe(true);

        const nodes = honest.proof.nodeHashes;
        if (previous === 0 || previous === treeSize) {
          return;
        }
        const mutated =
          mutation === "drop"
            ? nodes.slice(0, -1)
            : mutation === "append"
              ? [...nodes, foreign]
              : mutation === "replace"
                ? replaced(nodes, pick % nodes.length, foreign)
                : nodes.length >= 2
                  ? swapped(nodes, pick % (nodes.length - 1))
                  : replaced(nodes, 0, foreign);
        const refused = await verifyTransparencyConsistencyProof({
          ...honest,
          proof: withNodes(honest.proof, mutated),
        });
        expect(refused.ok).toBe(false);
      },
    ),
    { numRuns: PROPERTY_RUNS },
  );
});

test("property: a random inclusion proof verifies and a tampered path is refused", async () => {
  const foreign = await foreignNodeHash();
  await fc.assert(
    fc.asyncProperty(
      treeSizeArb.chain((treeSize) =>
        fc.tuple(
          fc.constant(treeSize),
          fc.integer({ min: 0, max: treeSize - 1 }),
          fc.nat(),
        ),
      ),
      async ([treeSize, leafIndex, pick]) => {
        const honest = await honestInclusion(treeSize, leafIndex);
        const accepted = await verifyTransparencyInclusionProof(honest);
        expect(accepted.ok).toBe(true);

        const path = honest.proof.auditPath;
        const tampered =
          path.length === 0
            ? [foreign]
            : replaced(path, pick % path.length, foreign);
        const refused = await verifyTransparencyInclusionProof({
          ...honest,
          proof: withAuditPath(honest.proof, tampered),
        });
        expect(refused.ok).toBe(false);
      },
    ),
    { numRuns: PROPERTY_RUNS },
  );
});
