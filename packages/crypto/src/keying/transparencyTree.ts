import { computeKeyingDomainHash } from "./canonical";
import { readHashArray, throwVerification } from "./shared";
import type {
  TransparencyConsistencyProof,
  TransparencyInclusionProof,
} from "./types";

/**
 * Merkle tree shape and proof generation for the keying transparency log.
 * The tree is the RFC 6962 shape (each node splits at the largest power of
 * two below its size) over Tearleads domain-separated hashes, so the proofs
 * are structurally equivalent to RFC 6962 proofs but not byte-compatible
 * with them. Verification lives in transparencyProofs.ts.
 */

export async function computeTransparencyEmptyTreeHash(): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-empty-tree", {
    version: 1,
  });
}

export async function computeTransparencyNodeHash(
  leftHash: string,
  rightHash: string,
): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-node", {
    leftHash,
    rightHash,
    version: 1,
  });
}

export function largestPowerOfTwoLessThan(value: number): number {
  let power = 1;

  while (power * 2 < value) {
    power *= 2;
  }

  return power;
}

function normalizeLeafHashes(leafHashes: readonly string[]): string[] {
  return readHashArray(leafHashes, "transparency leaf hashes");
}

export async function computeTransparencyMerkleRoot(
  leafHashes: readonly string[],
): Promise<string> {
  const normalizedLeafHashes = normalizeLeafHashes(leafHashes);

  if (normalizedLeafHashes.length === 0) {
    return computeTransparencyEmptyTreeHash();
  }

  if (normalizedLeafHashes.length === 1) {
    const onlyHash = normalizedLeafHashes.at(0);
    if (onlyHash === undefined) {
      throwVerification("invalid_shape", "transparency leaf hashes is empty");
    }

    return onlyHash;
  }

  const splitIndex = largestPowerOfTwoLessThan(normalizedLeafHashes.length);
  return computeTransparencyNodeHash(
    await computeTransparencyMerkleRoot(
      normalizedLeafHashes.slice(0, splitIndex),
    ),
    await computeTransparencyMerkleRoot(normalizedLeafHashes.slice(splitIndex)),
  );
}

async function createTransparencyInclusionAuditPath(input: {
  readonly leafHashes: readonly string[];
  readonly leafIndex: number;
}): Promise<string[]> {
  if (input.leafHashes.length === 1) {
    return [];
  }

  const splitIndex = largestPowerOfTwoLessThan(input.leafHashes.length);
  if (input.leafIndex < splitIndex) {
    return [
      ...(await createTransparencyInclusionAuditPath({
        leafHashes: input.leafHashes.slice(0, splitIndex),
        leafIndex: input.leafIndex,
      })),
      await computeTransparencyMerkleRoot(input.leafHashes.slice(splitIndex)),
    ];
  }

  return [
    ...(await createTransparencyInclusionAuditPath({
      leafHashes: input.leafHashes.slice(splitIndex),
      leafIndex: input.leafIndex - splitIndex,
    })),
    await computeTransparencyMerkleRoot(input.leafHashes.slice(0, splitIndex)),
  ];
}

export async function createTransparencyInclusionProof(
  leafHashes: readonly string[],
  leafIndex: number,
): Promise<TransparencyInclusionProof> {
  const normalizedLeafHashes = normalizeLeafHashes(leafHashes);

  if (normalizedLeafHashes.length === 0) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof requires at least one leaf",
    );
  }

  if (
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= normalizedLeafHashes.length
  ) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof leafIndex is out of bounds",
    );
  }

  return {
    version: 1,
    treeSize: normalizedLeafHashes.length,
    leafIndex,
    auditPath: await createTransparencyInclusionAuditPath({
      leafHashes: normalizedLeafHashes,
      leafIndex,
    }),
  };
}

/** RFC 6962 SUBPROOF over the domain hashes. */
async function createTransparencyConsistencyNodeHashes(input: {
  readonly leafHashes: readonly string[];
  readonly previousTreeSize: number;
  readonly subtreeComplete: boolean;
}): Promise<string[]> {
  const treeSize = input.leafHashes.length;

  if (input.previousTreeSize === treeSize) {
    return input.subtreeComplete
      ? []
      : [await computeTransparencyMerkleRoot(input.leafHashes)];
  }

  const splitIndex = largestPowerOfTwoLessThan(treeSize);
  if (input.previousTreeSize <= splitIndex) {
    return [
      ...(await createTransparencyConsistencyNodeHashes({
        leafHashes: input.leafHashes.slice(0, splitIndex),
        previousTreeSize: input.previousTreeSize,
        subtreeComplete: input.subtreeComplete,
      })),
      await computeTransparencyMerkleRoot(input.leafHashes.slice(splitIndex)),
    ];
  }

  return [
    ...(await createTransparencyConsistencyNodeHashes({
      leafHashes: input.leafHashes.slice(splitIndex),
      previousTreeSize: input.previousTreeSize - splitIndex,
      subtreeComplete: false,
    })),
    await computeTransparencyMerkleRoot(input.leafHashes.slice(0, splitIndex)),
  ];
}

export async function createTransparencyConsistencyProof(
  leafHashes: readonly string[],
  previousTreeSize: number,
): Promise<TransparencyConsistencyProof> {
  const normalizedLeafHashes = normalizeLeafHashes(leafHashes);

  if (
    !Number.isInteger(previousTreeSize) ||
    previousTreeSize < 0 ||
    previousTreeSize > normalizedLeafHashes.length
  ) {
    throwVerification(
      "invalid_shape",
      "transparency consistency proof previousTreeSize is out of bounds",
    );
  }

  return {
    version: 1,
    previousTreeSize,
    treeSize: normalizedLeafHashes.length,
    nodeHashes:
      previousTreeSize === 0
        ? []
        : await createTransparencyConsistencyNodeHashes({
            leafHashes: normalizedLeafHashes,
            previousTreeSize,
            subtreeComplete: true,
          }),
  };
}
