import {
  assertExactKeys,
  readHashArray,
  readHashString,
  readNonNegativeInteger,
  readPositiveInteger,
  readString,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import {
  computeTransparencyEmptyTreeHash,
  computeTransparencyNodeHash,
  largestPowerOfTwoLessThan,
} from "./transparencyTree";
import type {
  KeyingVerificationResult,
  TransparencyConsistencyProof,
  TransparencyInclusionProof,
  TransparencyTreeCheckpoint,
} from "./types";

/**
 * Inclusion and consistency verification for the keying transparency log.
 * Both work on tree checkpoints (log id, size, root) rather than on signed
 * tree heads, so a caller holding a verified head, a persisted checkpoint,
 * or both can check a proof without an unrelated signature or leaf;
 * `verifyTransparencyProof` composes them over signed heads.
 *
 * The consistency verifier follows the RFC 9162 §2.1.4.2 walk exactly. The
 * earlier two-phase fold omitted the branch where the previous and current
 * node indices coincide, so a block of valid proofs starting at the 5 → 6
 * prefix ran out of nodes and was refused (#2186).
 */

function halveTreeIndex(value: number): number {
  return Math.floor(value / 2);
}

function normalizeTransparencyTreeCheckpoint(
  value: unknown,
  label: string,
): TransparencyTreeCheckpoint {
  const record = assertExactKeys(
    value,
    ["logId", "rootHash", "treeSize"],
    label,
  );

  return {
    logId: readString(record, "logId", label),
    treeSize: readNonNegativeInteger(record, "treeSize", label),
    rootHash: readHashString(record, "rootHash", label),
  };
}

export function normalizeTransparencyInclusionProof(
  value: unknown,
): TransparencyInclusionProof {
  const record = assertExactKeys(
    value,
    ["auditPath", "leafIndex", "treeSize", "version"],
    "transparency inclusion proof",
  );

  return {
    version: readVersion(record, "transparency inclusion proof"),
    treeSize: readPositiveInteger(
      record,
      "treeSize",
      "transparency inclusion proof",
    ),
    leafIndex: readNonNegativeInteger(
      record,
      "leafIndex",
      "transparency inclusion proof",
    ),
    auditPath: readHashArray(
      record.auditPath,
      "transparency inclusion proof.auditPath",
    ),
  };
}

export function normalizeTransparencyConsistencyProof(
  value: unknown,
): TransparencyConsistencyProof {
  const record = assertExactKeys(
    value,
    ["nodeHashes", "previousTreeSize", "treeSize", "version"],
    "transparency consistency proof",
  );

  return {
    version: readVersion(record, "transparency consistency proof"),
    previousTreeSize: readNonNegativeInteger(
      record,
      "previousTreeSize",
      "transparency consistency proof",
    ),
    treeSize: readNonNegativeInteger(
      record,
      "treeSize",
      "transparency consistency proof",
    ),
    nodeHashes: readHashArray(
      record.nodeHashes,
      "transparency consistency proof.nodeHashes",
    ),
  };
}

async function computeTransparencyInclusionRoot(input: {
  readonly leafHash: string;
  readonly proof: TransparencyInclusionProof;
}): Promise<string> {
  let proofIndex = input.proof.auditPath.length - 1;

  const computeRoot = async (
    leafIndex: number,
    treeSize: number,
  ): Promise<string> => {
    if (treeSize === 1) {
      return input.leafHash;
    }

    const siblingHash = input.proof.auditPath[proofIndex];
    if (!siblingHash) {
      throwVerification(
        "missing_dependency",
        "transparency inclusion proof is missing an audit path node",
      );
    }
    proofIndex -= 1;

    const splitIndex = largestPowerOfTwoLessThan(treeSize);
    if (leafIndex < splitIndex) {
      return computeTransparencyNodeHash(
        await computeRoot(leafIndex, splitIndex),
        siblingHash,
      );
    }

    return computeTransparencyNodeHash(
      siblingHash,
      await computeRoot(leafIndex - splitIndex, treeSize - splitIndex),
    );
  };

  const computedRoot = await computeRoot(
    input.proof.leafIndex,
    input.proof.treeSize,
  );

  if (proofIndex !== -1) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof has extra audit path nodes",
    );
  }

  return computedRoot;
}

export interface VerifyTransparencyInclusionProofInput {
  readonly leafHash: string;
  readonly checkpoint: TransparencyTreeCheckpoint;
  readonly proof: TransparencyInclusionProof;
}

/** Throws the verification error; callers wrap it in `runVerifier`. */
export async function assertTransparencyInclusion(
  input: VerifyTransparencyInclusionProofInput,
): Promise<void> {
  if (input.proof.treeSize !== input.checkpoint.treeSize) {
    throwVerification(
      "object_mismatch",
      "transparency inclusion proof tree size does not match tree head",
    );
  }

  if (input.proof.leafIndex >= input.proof.treeSize) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof leafIndex is out of bounds",
    );
  }

  const computedRoot = await computeTransparencyInclusionRoot(input);
  if (computedRoot !== input.checkpoint.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency inclusion proof root does not match tree head",
    );
  }
}

/**
 * Standalone inclusion check against a checkpoint the caller already trusts.
 * Returns the normalized checkpoint the leaf is included in.
 */
export async function verifyTransparencyInclusionProof(
  input: VerifyTransparencyInclusionProofInput,
): Promise<KeyingVerificationResult<TransparencyTreeCheckpoint>> {
  return runVerifier(async () => {
    const checkpoint = normalizeTransparencyTreeCheckpoint(
      input.checkpoint,
      "transparency tree checkpoint",
    );
    await assertTransparencyInclusion({
      leafHash: readHashString(
        { leafHash: input.leafHash },
        "leafHash",
        "transparency inclusion",
      ),
      checkpoint,
      proof: normalizeTransparencyInclusionProof(input.proof),
    });
    return checkpoint;
  });
}

export interface VerifyTransparencyConsistencyProofInput {
  readonly previousCheckpoint: TransparencyTreeCheckpoint;
  readonly checkpoint: TransparencyTreeCheckpoint;
  readonly proof: TransparencyConsistencyProof;
}

function assertTransparencyConsistencyShape(
  input: VerifyTransparencyConsistencyProofInput,
): void {
  if (input.previousCheckpoint.logId !== input.checkpoint.logId) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof log id does not match",
    );
  }

  if (input.proof.previousTreeSize !== input.previousCheckpoint.treeSize) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof previous tree size does not match",
    );
  }

  if (input.proof.treeSize !== input.checkpoint.treeSize) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof tree size does not match",
    );
  }

  if (input.previousCheckpoint.treeSize > input.checkpoint.treeSize) {
    throwVerification(
      "rollback",
      "transparency tree head is older than the local checkpoint",
    );
  }
}

/** The empty and same-size cases need no walk; true when handled. */
async function assertTrivialTransparencyConsistency(
  input: VerifyTransparencyConsistencyProofInput,
): Promise<boolean> {
  if (input.previousCheckpoint.treeSize === 0) {
    const emptyRoot = await computeTransparencyEmptyTreeHash();
    if (input.previousCheckpoint.rootHash !== emptyRoot) {
      throwVerification(
        "hash_mismatch",
        "empty transparency tree checkpoint root is invalid",
      );
    }
    if (input.proof.nodeHashes.length !== 0) {
      throwVerification(
        "invalid_shape",
        "transparency consistency proof for empty tree must be empty",
      );
    }
    return true;
  }

  if (input.previousCheckpoint.treeSize === input.checkpoint.treeSize) {
    if (input.proof.nodeHashes.length !== 0) {
      throwVerification(
        "invalid_shape",
        "same-size transparency consistency proof must be empty",
      );
    }

    if (input.previousCheckpoint.rootHash !== input.checkpoint.rootHash) {
      throwVerification(
        "equivocation",
        "same-size transparency tree head root changed",
      );
    }
    return true;
  }

  return false;
}

/**
 * RFC 9162 §2.1.4.2 consistency walk for 0 < previous size < current size.
 * `firstIndex`/`secondIndex` are the RFC's `fn`/`sn`; both roots are folded
 * from the same node stream, the previous root only at the levels where the
 * previous tree's rightmost path is complete.
 */
async function computeTransparencyConsistencyProofRoots(
  input: VerifyTransparencyConsistencyProofInput,
): Promise<{ readonly previousRoot: string; readonly currentRoot: string }> {
  let firstIndex = input.previousCheckpoint.treeSize - 1;
  let secondIndex = input.checkpoint.treeSize - 1;

  while (firstIndex % 2 === 1) {
    firstIndex = halveTreeIndex(firstIndex);
    secondIndex = halveTreeIndex(secondIndex);
  }

  // A previous tree whose size is a power of two is a complete subtree of
  // the current tree, so its own root is the first node of the walk.
  const path =
    firstIndex === 0
      ? [input.previousCheckpoint.rootHash, ...input.proof.nodeHashes]
      : input.proof.nodeHashes;
  const [seed, ...nodes] = path;
  if (seed === undefined) {
    throwVerification(
      "missing_dependency",
      "transparency consistency proof is missing a node",
    );
  }

  let previousRoot = seed;
  let currentRoot = seed;
  for (const node of nodes) {
    if (secondIndex === 0) {
      throwVerification(
        "invalid_shape",
        "transparency consistency proof has extra nodes",
      );
    }

    if (firstIndex % 2 === 1 || firstIndex === secondIndex) {
      previousRoot = await computeTransparencyNodeHash(node, previousRoot);
      currentRoot = await computeTransparencyNodeHash(node, currentRoot);
      while (firstIndex % 2 === 0 && firstIndex !== 0) {
        firstIndex = halveTreeIndex(firstIndex);
        secondIndex = halveTreeIndex(secondIndex);
      }
    } else {
      currentRoot = await computeTransparencyNodeHash(currentRoot, node);
    }

    firstIndex = halveTreeIndex(firstIndex);
    secondIndex = halveTreeIndex(secondIndex);
  }

  if (secondIndex !== 0) {
    throwVerification(
      "missing_dependency",
      "transparency consistency proof is missing a node",
    );
  }

  return { previousRoot, currentRoot };
}

/** Throws the verification error; callers wrap it in `runVerifier`. */
export async function assertTransparencyConsistency(
  input: VerifyTransparencyConsistencyProofInput,
): Promise<void> {
  assertTransparencyConsistencyShape(input);

  if (await assertTrivialTransparencyConsistency(input)) {
    return;
  }

  const roots = await computeTransparencyConsistencyProofRoots(input);
  if (roots.previousRoot !== input.previousCheckpoint.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency consistency proof previous root mismatch",
    );
  }

  if (roots.currentRoot !== input.checkpoint.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency consistency proof current root mismatch",
    );
  }
}

/**
 * Standalone append-only check between two checkpoints of one log, with no
 * leaf, inclusion proof, or signature involved. Returns the normalized newer
 * checkpoint the previous one is a prefix of.
 */
export async function verifyTransparencyConsistencyProof(
  input: VerifyTransparencyConsistencyProofInput,
): Promise<KeyingVerificationResult<TransparencyTreeCheckpoint>> {
  return runVerifier(async () => {
    const checkpoint = normalizeTransparencyTreeCheckpoint(
      input.checkpoint,
      "transparency tree checkpoint",
    );
    await assertTransparencyConsistency({
      previousCheckpoint: normalizeTransparencyTreeCheckpoint(
        input.previousCheckpoint,
        "previous transparency tree checkpoint",
      ),
      checkpoint,
      proof: normalizeTransparencyConsistencyProof(input.proof),
    });
    return checkpoint;
  });
}
