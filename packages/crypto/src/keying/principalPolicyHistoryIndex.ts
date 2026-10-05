import { computeKeyingDomainHash } from "./canonical";
import { readHashString, throwVerification } from "./shared";
import {
  computeTransparencyNodeHash,
  largestPowerOfTwoLessThan,
} from "./transparencyTree";
import type {
  PrincipalPolicySignedState,
  TransparencyInclusionProof,
} from "./types";

/** Content-addressed, untrusted proof material; the verified root is authority. */
export interface PrincipalHistoryIndexNode {
  readonly hash: string;
  readonly leftHash: string;
  readonly rightHash: string;
}

export type PrincipalHistoryIndexFrontier = readonly (string | null)[];

export function normalizePrincipalHistoryIndexFrontier(
  value: unknown,
  size: number,
): (string | null)[] {
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !Array.isArray(value) ||
    value.length > 53
  )
    throwVerification(
      "invalid_shape",
      "invalid principal history index frontier",
    );
  const frontier: (string | null)[] = [];
  let remaining = size;
  for (const item of value) {
    if (
      remaining === 0 ||
      (remaining % 2 === 0 ? item !== null : item === null)
    )
      throwVerification(
        "invalid_shape",
        "principal history frontier does not match its size",
      );
    frontier.push(
      item === null
        ? null
        : readHashString({ hash: item }, "hash", "principal history frontier"),
    );
    remaining = Math.floor(remaining / 2);
  }
  if (remaining !== 0)
    throwVerification(
      "invalid_shape",
      "principal history frontier is incomplete",
    );
  return frontier;
}

export function principalHistoryIndexLeaf(
  state: PrincipalPolicySignedState,
): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.principal-history-leaf", {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
    stateHash: state.stateHash,
    signature: state.signature,
  });
}

async function join(
  leftHash: string,
  rightHash: string,
  nodes?: Map<string, PrincipalHistoryIndexNode>,
): Promise<string> {
  const hash = await computeTransparencyNodeHash(leftHash, rightHash);
  nodes?.set(hash, { hash, leftHash, rightHash });
  return hash;
}

export async function principalHistoryIndexRoot(
  frontier: PrincipalHistoryIndexFrontier,
): Promise<string | null> {
  let root: string | null = null;
  for (const hash of frontier) {
    if (hash !== null) root = root === null ? hash : await join(hash, root);
  }
  return root;
}

/** Build privately; the caller publishes this only with an accepted page. */
export async function appendPrincipalHistoryIndex(
  previous: PrincipalHistoryIndexFrontier,
  states: readonly PrincipalPolicySignedState[],
) {
  const frontier = [...previous];
  const nodes = new Map<string, PrincipalHistoryIndexNode>();
  for (const state of states) {
    let carry = await principalHistoryIndexLeaf(state);
    let height = 0;
    while (frontier[height]) {
      const left = frontier[height];
      if (!left)
        throwVerification(
          "invalid_shape",
          "principal history frontier changed",
        );
      carry = await join(left, carry, nodes);
      frontier[height] = null;
      height += 1;
    }
    frontier[height] = carry;
  }
  let rootHash: string | null = null;
  for (const hash of frontier) {
    if (hash !== null)
      rootHash = rootHash === null ? hash : await join(hash, rootHash, nodes);
  }
  return { frontier, rootHash, nodes: [...nodes.values()] };
}

/** Fetch at most one content-addressed node per level, never a history array. */
export async function createPrincipalHistoryIndexProof(input: {
  readonly rootHash: string;
  readonly treeSize: number;
  readonly version: number;
  readonly readNode: (
    hash: string,
  ) => Promise<PrincipalHistoryIndexNode | null>;
}): Promise<TransparencyInclusionProof> {
  const { treeSize, version } = input;
  if (
    !Number.isSafeInteger(treeSize) ||
    treeSize < 1 ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > treeSize
  )
    throwVerification(
      "invalid_shape",
      "principal history proof version is out of range",
    );
  let hash = readHashString(input, "rootHash", "principal history proof");
  let size = treeSize;
  let position = version - 1;
  const siblings: string[] = [];
  while (size > 1) {
    const node = await input.readNode(hash);
    if (!node || node.hash !== hash)
      throwVerification(
        "missing_dependency",
        "principal history index node is missing",
      );
    const left = readHashString(
      { leftHash: node.leftHash },
      "leftHash",
      "principal history index node",
    );
    const right = readHashString(
      { rightHash: node.rightHash },
      "rightHash",
      "principal history index node",
    );
    if ((await join(left, right)) !== hash)
      throwVerification(
        "hash_mismatch",
        "principal history index node hash mismatch",
      );
    const split = largestPowerOfTwoLessThan(size);
    if (position < split) {
      siblings.push(right);
      hash = left;
      size = split;
    } else {
      siblings.push(left);
      hash = right;
      position -= split;
      size -= split;
    }
  }
  return {
    version: 1,
    treeSize,
    leafIndex: version - 1,
    auditPath: siblings.reverse(),
  };
}
