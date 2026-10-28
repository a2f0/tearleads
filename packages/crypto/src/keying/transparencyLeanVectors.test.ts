import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  computeTransparencyMerkleRoot,
  createTransparencyConsistencyProof,
  createTransparencyInclusionProof,
  type KeyingVerificationResult,
  verifyTransparencyConsistencyProof,
  verifyTransparencyInclusionProof,
} from "./index";
import { checkpoint, leafHashes } from "./transparencyProofs.testFixtures";

/**
 * Replays the Lean model's transparency vectors (#2192 Gate F3) through the
 * production generator and verifiers. The fixture names every digest by the
 * leaf range it is the root of; this suite hashes the same ranges with the
 * real domain hashes, must reproduce every honest proof the model generates,
 * and must reach every outcome the model records, refusal code included.
 * Regenerate the fixture with `bun run generate:protocol-proof-vectors`.
 */

const FIXTURE_PATH = join(
  import.meta.dir,
  "../../../../formal/lean/vectors/transparency.json",
);

type LeafRange = readonly [lo: number, size: number];

interface ConsistencyVector {
  readonly label: string;
  readonly previousTreeSize: number;
  readonly previousRoot: LeafRange;
  readonly treeSize: number;
  readonly root: LeafRange;
  readonly nodes: readonly LeafRange[];
  readonly expect: string;
}

interface InclusionVector {
  readonly label: string;
  readonly leaf: number;
  readonly leafIndex: number;
  readonly treeSize: number;
  readonly root: LeafRange;
  readonly auditPath: readonly LeafRange[];
  readonly expect: string;
}

interface VectorFixture {
  readonly bounds: {
    readonly leafCount: number;
    readonly maxHonestSize: number;
  };
  readonly consistency: readonly ConsistencyVector[];
  readonly inclusion: readonly InclusionVector[];
}

let fixturePromise: Promise<VectorFixture> | undefined;
function fixture(): Promise<VectorFixture> {
  fixturePromise ??= Bun.file(FIXTURE_PATH).json();
  return fixturePromise;
}

async function rangeHasher(): Promise<(range: LeafRange) => Promise<string>> {
  const [leaves, { bounds }] = await Promise.all([leafHashes(), fixture()]);
  if (bounds.leafCount > leaves.length) {
    throw new Error(
      `fixture needs ${bounds.leafCount} leaves, test fixtures have ${leaves.length}`,
    );
  }
  const roots = new Map<string, Promise<string>>();
  return (range) => {
    const [lo, size] = range;
    const key = `${lo}:${size}`;
    let rootHash = roots.get(key);
    if (rootHash === undefined) {
      rootHash = computeTransparencyMerkleRoot(leaves.slice(lo, lo + size));
      roots.set(key, rootHash);
    }
    return rootHash;
  };
}

function outcome(result: KeyingVerificationResult<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

test("the Lean vectors cover every bounded size pair and every outcome", async () => {
  const { bounds, consistency, inclusion } = await fixture();
  const size = bounds.maxHonestSize;
  const honest = (vectors: readonly { label: string }[]) =>
    vectors.filter((vector) => vector.label === "honest").length;

  expect(honest(consistency)).toBe(((size + 1) * (size + 2)) / 2);
  expect(honest(inclusion)).toBe((size * (size + 1)) / 2);
  expect(new Set(consistency.map((vector) => vector.expect))).toEqual(
    new Set([
      "ok",
      "equivocation",
      "hash_mismatch",
      "invalid_shape",
      "missing_dependency",
      "rollback",
    ]),
  );
  expect(new Set(inclusion.map((vector) => vector.expect))).toEqual(
    new Set(["ok", "hash_mismatch", "invalid_shape", "missing_dependency"]),
  );
});

test("production consistency proofs reach the Lean model's outcomes", async () => {
  const [{ consistency }, hash, leaves] = await Promise.all([
    fixture(),
    rangeHasher(),
    leafHashes(),
  ]);
  const mismatches: string[] = [];
  for (const vector of consistency) {
    const label = `${vector.label} ${vector.previousTreeSize} → ${vector.treeSize}`;
    const nodeHashes = await Promise.all(vector.nodes.map(hash));
    if (vector.label === "honest") {
      const generated = await createTransparencyConsistencyProof(
        leaves.slice(0, vector.treeSize),
        vector.previousTreeSize,
      );
      if (!Bun.deepEquals(generated.nodeHashes, nodeHashes)) {
        mismatches.push(`${label}: generated proof differs from the model`);
      }
    }
    const actual = outcome(
      await verifyTransparencyConsistencyProof({
        previousCheckpoint: checkpoint(
          vector.previousTreeSize,
          await hash(vector.previousRoot),
        ),
        checkpoint: checkpoint(vector.treeSize, await hash(vector.root)),
        proof: {
          version: 1,
          previousTreeSize: vector.previousTreeSize,
          treeSize: vector.treeSize,
          nodeHashes,
        },
      }),
    );
    if (actual !== vector.expect) {
      mismatches.push(`${label}: expected ${vector.expect}, got ${actual}`);
    }
  }
  expect(mismatches).toEqual([]);
}, 30_000);

test("production inclusion proofs reach the Lean model's outcomes", async () => {
  const [{ inclusion }, hash, leaves] = await Promise.all([
    fixture(),
    rangeHasher(),
    leafHashes(),
  ]);
  const mismatches: string[] = [];
  for (const vector of inclusion) {
    const label = `${vector.label} leaf ${vector.leafIndex} of ${vector.treeSize}`;
    const auditPath = await Promise.all(vector.auditPath.map(hash));
    if (vector.label === "honest") {
      const generated = await createTransparencyInclusionProof(
        leaves.slice(0, vector.treeSize),
        vector.leafIndex,
      );
      if (!Bun.deepEquals(generated.auditPath, auditPath)) {
        mismatches.push(`${label}: generated proof differs from the model`);
      }
    }
    const actual = outcome(
      await verifyTransparencyInclusionProof({
        leafHash: leaves[vector.leaf] ?? "",
        checkpoint: checkpoint(vector.treeSize, await hash(vector.root)),
        proof: {
          version: 1,
          treeSize: vector.treeSize,
          leafIndex: vector.leafIndex,
          auditPath,
        },
      }),
    );
    if (actual !== vector.expect) {
      mismatches.push(`${label}: expected ${vector.expect}, got ${actual}`);
    }
  }
  expect(mismatches).toEqual([]);
}, 30_000);
