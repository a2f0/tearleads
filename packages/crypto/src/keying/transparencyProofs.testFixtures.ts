import {
  computeKeyingDomainHash,
  computeTransparencyMerkleRoot,
  createTransparencyConsistencyProof,
  createTransparencyInclusionProof,
  type KeyingVerificationCode,
  type KeyingVerificationResult,
  type TransparencyConsistencyProof,
  type TransparencyInclusionProof,
  type TransparencyTreeCheckpoint,
  type VerifyTransparencyConsistencyProofInput,
  type VerifyTransparencyInclusionProofInput,
} from "./index";
import { fixtureHash } from "./testFixtures";

/**
 * Shared fixtures for the transparency proof matrices (#2192 Gate F2, #2186
 * Gate C0a): one honest leaf set, its prefix roots, honest proof builders,
 * an independent RFC 6962 root oracle, and the node mutations the negative
 * tests apply.
 */

export const MATRIX_TREE_SIZE = 64;
export const MUTATION_TREE_SIZE = 32;
export const PROPERTY_TREE_SIZE = 192;
export const PROPERTY_RUNS = 40;
const LOG_ID = "keying-transparency-log";

let leafHashesPromise: Promise<string[]> | undefined;
export function leafHashes(): Promise<string[]> {
  leafHashesPromise ??= Promise.all(
    Array.from({ length: PROPERTY_TREE_SIZE }, (_, index) =>
      fixtureHash(`transparency-matrix-leaf-${index}`),
    ),
  );
  return leafHashesPromise;
}

let rootsPromise: Promise<string[]> | undefined;
/** `roots[n]` is the root of the honest prefix of size `n`. */
export function prefixRoots(): Promise<string[]> {
  rootsPromise ??= leafHashes().then((leaves) =>
    Promise.all(
      Array.from({ length: PROPERTY_TREE_SIZE + 1 }, (_, size) =>
        computeTransparencyMerkleRoot(leaves.slice(0, size)),
      ),
    ),
  );
  return rootsPromise;
}

export function checkpoint(
  treeSize: number,
  rootHash: string,
): TransparencyTreeCheckpoint {
  return { logId: LOG_ID, treeSize, rootHash };
}

async function oracleNodeHash(left: string, right: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-node", {
    leftHash: left,
    rightHash: right,
    version: 1,
  });
}

/**
 * Independent RFC 6962 root: a binary-counter fold over complete subtrees,
 * with no slicing and no recursion, then a right-to-left merge of the
 * remaining spine. Equal to the largest-power-of-two split by construction.
 */
export async function oracleRoot(leaves: readonly string[]): Promise<string> {
  if (leaves.length === 0) {
    return computeKeyingDomainHash("tearleads.keying.transparency-empty-tree", {
      version: 1,
    });
  }
  const stack: { hash: string; height: number }[] = [];
  for (const leaf of leaves) {
    let node = { hash: leaf, height: 0 };
    for (
      let top = stack.at(-1);
      top !== undefined && top.height === node.height;
      top = stack.at(-1)
    ) {
      stack.pop();
      node = {
        hash: await oracleNodeHash(top.hash, node.hash),
        height: node.height + 1,
      };
    }
    stack.push(node);
  }
  let root = "";
  for (const node of stack.reverse()) {
    root = root === "" ? node.hash : await oracleNodeHash(node.hash, root);
  }
  return root;
}

export async function honestConsistency(
  previousTreeSize: number,
  treeSize: number,
): Promise<VerifyTransparencyConsistencyProofInput> {
  const [leaves, roots] = await Promise.all([leafHashes(), prefixRoots()]);
  return {
    proof: await createTransparencyConsistencyProof(
      leaves.slice(0, treeSize),
      previousTreeSize,
    ),
    previousCheckpoint: checkpoint(
      previousTreeSize,
      roots[previousTreeSize] ?? "",
    ),
    checkpoint: checkpoint(treeSize, roots[treeSize] ?? ""),
  };
}

export async function honestInclusion(
  treeSize: number,
  leafIndex: number,
): Promise<VerifyTransparencyInclusionProofInput> {
  const [leaves, roots] = await Promise.all([leafHashes(), prefixRoots()]);
  return {
    leafHash: leaves[leafIndex] ?? "",
    proof: await createTransparencyInclusionProof(
      leaves.slice(0, treeSize),
      leafIndex,
    ),
    checkpoint: checkpoint(treeSize, roots[treeSize] ?? ""),
  };
}

export function withNodes(
  proof: TransparencyConsistencyProof,
  nodeHashes: readonly string[],
): TransparencyConsistencyProof {
  return { ...proof, nodeHashes };
}

export function withAuditPath(
  proof: TransparencyInclusionProof,
  auditPath: readonly string[],
): TransparencyInclusionProof {
  return { ...proof, auditPath };
}

export function replaced(
  hashes: readonly string[],
  index: number,
  hash: string,
): string[] {
  return hashes.map((node, at) => (at === index ? hash : node));
}

export function swapped(hashes: readonly string[], index: number): string[] {
  const copy = [...hashes];
  const left = copy[index];
  const right = copy[index + 1];
  if (left === undefined || right === undefined) {
    throw new Error("swap needs two nodes");
  }
  copy[index] = right;
  copy[index + 1] = left;
  return copy;
}

export function foreignNodeHash(): Promise<string> {
  return fixtureHash("transparency-matrix-foreign-node");
}

/** Like `expectVerificationError`, but names the matrix cell that failed. */
export function expectCode(
  label: string,
  result: KeyingVerificationResult<unknown>,
  code: KeyingVerificationCode,
): void {
  if (result.ok || result.error.code !== code) {
    throw new Error(
      `${label}: expected ${code}, got ${result.ok ? "ok" : result.error.code}`,
    );
  }
}
