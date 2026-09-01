import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { toFingerprint } from "../fingerprint";
import { sign } from "../signing/sign";
import { verify } from "../signing/verify";
import { computeKeyingDomainHash, encodeDomainPayload } from "./canonical";
import { normalizeIdentityStateHead } from "./checkpoints";
import {
  assertExactKeys,
  normalizeAccessObjectKind,
  normalizeManagedPrincipalKind,
  readHashArray,
  readHashString,
  readNonNegativeInteger,
  readPositiveInteger,
  readSignedAt,
  readString,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  AccessManifestTransparencyLeaf,
  AnyVerifiedAccessManifest,
  IdentityStateHead,
  IdentityStateTransparencyLeaf,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  PrincipalPolicyTransparencyLeaf,
  SignedTransparencyTreeHead,
  TransparencyConsistencyProof,
  TransparencyInclusionProof,
  TransparencyLeaf,
  TransparencyTreeCheckpoint,
  UnsignedTransparencyTreeHead,
  VerifiedPrincipalPolicy,
  VerifiedTransparencyProof,
  VerifiedTransparencyTreeHead,
  VerifySignedTransparencyTreeHeadInput,
  VerifyTransparencyProofInput,
} from "./types";
import {
  makeVerifiedTransparencyProof,
  makeVerifiedTransparencyTreeHead,
} from "./types";

interface TransparencyLeafCandidate extends Record<string, unknown> {
  readonly leafKind?: unknown;
}

function normalizeIdentityTransparencyLeaf(
  value: unknown,
): IdentityStateTransparencyLeaf {
  const record = assertExactKeys(
    value,
    ["identityId", "leafKind", "stateHash", "stateVersion", "version"],
    "identity transparency leaf",
  );

  if (record.leafKind !== "identity_state_head") {
    throwVerification(
      "invalid_domain",
      "identity transparency leaf.leafKind is unsupported",
    );
  }

  return {
    version: readVersion(record, "identity transparency leaf"),
    leafKind: "identity_state_head",
    identityId: readString(record, "identityId", "identity transparency leaf"),
    stateVersion: readPositiveInteger(
      record,
      "stateVersion",
      "identity transparency leaf",
    ),
    stateHash: readHashString(
      record,
      "stateHash",
      "identity transparency leaf",
    ),
  };
}

function normalizePrincipalPolicyTransparencyLeaf(
  value: unknown,
): PrincipalPolicyTransparencyLeaf {
  const record = assertExactKeys(
    value,
    [
      "keyEpoch",
      "keyFingerprint",
      "leafKind",
      "policyVersion",
      "principalId",
      "principalType",
      "stateHash",
      "version",
    ],
    "principal policy transparency leaf",
  );

  if (record.leafKind !== "principal_policy_head") {
    throwVerification(
      "invalid_domain",
      "principal policy transparency leaf.leafKind is unsupported",
    );
  }

  return {
    version: readVersion(record, "principal policy transparency leaf"),
    leafKind: "principal_policy_head",
    principalType: normalizeManagedPrincipalKind(
      record.principalType,
      "principal policy transparency leaf",
    ),
    principalId: readString(
      record,
      "principalId",
      "principal policy transparency leaf",
    ),
    policyVersion: readPositiveInteger(
      record,
      "policyVersion",
      "principal policy transparency leaf",
    ),
    keyEpoch: readPositiveInteger(
      record,
      "keyEpoch",
      "principal policy transparency leaf",
    ),
    stateHash: readHashString(
      record,
      "stateHash",
      "principal policy transparency leaf",
    ),
    keyFingerprint: readHashString(
      record,
      "keyFingerprint",
      "principal policy transparency leaf",
    ),
  };
}

function normalizeAccessManifestTransparencyLeaf(
  value: unknown,
): AccessManifestTransparencyLeaf {
  const record = assertExactKeys(
    value,
    [
      "epoch",
      "leafKind",
      "manifestHash",
      "objectId",
      "objectKind",
      "organizationId",
      "version",
    ],
    "access manifest transparency leaf",
  );

  if (record.leafKind !== "access_manifest_head") {
    throwVerification(
      "invalid_domain",
      "access manifest transparency leaf.leafKind is unsupported",
    );
  }

  return {
    version: readVersion(record, "access manifest transparency leaf"),
    leafKind: "access_manifest_head",
    objectKind: normalizeAccessObjectKind(
      record.objectKind,
      "access manifest transparency leaf",
    ),
    objectId: readString(
      record,
      "objectId",
      "access manifest transparency leaf",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "access manifest transparency leaf",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "access manifest transparency leaf",
    ),
    manifestHash: readHashString(
      record,
      "manifestHash",
      "access manifest transparency leaf",
    ),
  };
}

function normalizeTransparencyLeaf(value: unknown): TransparencyLeaf {
  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", "transparency leaf must be an object");
  }
  const record: TransparencyLeafCandidate = value;

  if (record.leafKind === "identity_state_head") {
    return normalizeIdentityTransparencyLeaf(value);
  }

  if (record.leafKind === "principal_policy_head") {
    return normalizePrincipalPolicyTransparencyLeaf(value);
  }

  if (record.leafKind === "access_manifest_head") {
    return normalizeAccessManifestTransparencyLeaf(value);
  }

  throwVerification(
    "invalid_domain",
    "transparency leaf.leafKind is unsupported",
  );
}

export function identityStateTransparencyLeaf(
  head: IdentityStateHead,
): IdentityStateTransparencyLeaf {
  const normalizedHead = normalizeIdentityStateHead(head);

  return {
    version: 1,
    leafKind: "identity_state_head",
    identityId: normalizedHead.identityId,
    stateVersion: normalizedHead.version,
    stateHash: normalizedHead.stateHash,
  };
}

export function principalPolicyTransparencyLeaf(
  policy: VerifiedPrincipalPolicy,
): PrincipalPolicyTransparencyLeaf {
  return {
    version: 1,
    leafKind: "principal_policy_head",
    principalType: policy.principalType,
    principalId: policy.principalId,
    policyVersion: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };
}

export function accessManifestTransparencyLeaf(
  manifest: AnyVerifiedAccessManifest,
): AccessManifestTransparencyLeaf {
  return {
    version: 1,
    leafKind: "access_manifest_head",
    objectKind: manifest.checkpoint.objectKind,
    objectId: manifest.checkpoint.objectId,
    organizationId: manifest.checkpoint.organizationId,
    epoch: manifest.checkpoint.epoch,
    manifestHash: manifest.checkpoint.manifestHash,
  };
}

export async function computeTransparencyLeafHash(
  leaf: TransparencyLeaf,
): Promise<string> {
  const payload: KeyingCanonicalPayload<TransparencyLeaf> =
    normalizeTransparencyLeaf(leaf);

  return computeKeyingDomainHash("tearleads.keying.transparency-leaf", payload);
}

async function computeTransparencyEmptyTreeHash(): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-empty-tree", {
    version: 1,
  });
}

async function computeTransparencyNodeHash(
  leftHash: string,
  rightHash: string,
): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-node", {
    leftHash,
    rightHash,
    version: 1,
  });
}

function largestPowerOfTwoLessThan(value: number): number {
  let power = 1;

  while (power * 2 < value) {
    power *= 2;
  }

  return power;
}

function normalizeLeafHashes(
  leafHashes: readonly string[],
  label: string,
): string[] {
  return readHashArray(leafHashes, label);
}

export async function computeTransparencyMerkleRoot(
  leafHashes: readonly string[],
): Promise<string> {
  const normalizedLeafHashes = normalizeLeafHashes(
    leafHashes,
    "transparency leaf hashes",
  );

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
  const normalizedLeafHashes = normalizeLeafHashes(
    leafHashes,
    "transparency leaf hashes",
  );

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
  const normalizedLeafHashes = normalizeLeafHashes(
    leafHashes,
    "transparency leaf hashes",
  );

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

function normalizeUnsignedTransparencyTreeHead(
  value: unknown,
): UnsignedTransparencyTreeHead {
  const record = assertExactKeys(
    value,
    [
      "logId",
      "logKeyFingerprint",
      "rootHash",
      "signedAt",
      "treeSize",
      "version",
    ],
    "transparency tree head",
  );

  return {
    version: readVersion(record, "transparency tree head"),
    logId: readString(record, "logId", "transparency tree head"),
    treeSize: readNonNegativeInteger(
      record,
      "treeSize",
      "transparency tree head",
    ),
    rootHash: readHashString(record, "rootHash", "transparency tree head"),
    signedAt: readSignedAt(record, "signedAt", "transparency tree head"),
    logKeyFingerprint: readHashString(
      record,
      "logKeyFingerprint",
      "transparency tree head",
    ),
  };
}

function normalizeSignedTransparencyTreeHead(
  value: unknown,
): SignedTransparencyTreeHead {
  const record = assertExactKeys(
    value,
    [
      "logId",
      "logKeyFingerprint",
      "rootHash",
      "signature",
      "signedAt",
      "treeSize",
      "version",
    ],
    "transparency tree head",
  );
  const unsignedHead = normalizeUnsignedTransparencyTreeHead({
    version: record.version,
    logId: record.logId,
    treeSize: record.treeSize,
    rootHash: record.rootHash,
    signedAt: record.signedAt,
    logKeyFingerprint: record.logKeyFingerprint,
  });

  return {
    ...unsignedHead,
    signature: readString(record, "signature", "transparency tree head"),
  };
}

function transparencyTreeHeadSigningBytes(
  treeHead: UnsignedTransparencyTreeHead,
): Uint8Array {
  const payload: KeyingCanonicalPayload<UnsignedTransparencyTreeHead> =
    normalizeUnsignedTransparencyTreeHead(treeHead);

  return encodeDomainPayload(
    "tearleads.keying.transparency-tree-head-signing",
    payload,
  );
}

function toUnsignedTransparencyTreeHead(
  treeHead: SignedTransparencyTreeHead,
): UnsignedTransparencyTreeHead {
  return {
    version: treeHead.version,
    logId: treeHead.logId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
    signedAt: treeHead.signedAt,
    logKeyFingerprint: treeHead.logKeyFingerprint,
  };
}

export async function signTransparencyTreeHead(
  treeHead: UnsignedTransparencyTreeHead,
  signingPrivateKey: Uint8Array,
): Promise<SignedTransparencyTreeHead> {
  const normalizedTreeHead = normalizeUnsignedTransparencyTreeHead(treeHead);
  const signature = sign(
    transparencyTreeHeadSigningBytes(normalizedTreeHead),
    signingPrivateKey,
  );

  return {
    ...normalizedTreeHead,
    signature: bytesToBase64(signature),
  };
}

function transparencyTreeCheckpointFromHead(
  treeHead: UnsignedTransparencyTreeHead,
): TransparencyTreeCheckpoint {
  return {
    logId: treeHead.logId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
  };
}

export async function verifySignedTransparencyTreeHead({
  logPublicKey,
  treeHead,
}: VerifySignedTransparencyTreeHeadInput): Promise<
  KeyingVerificationResult<VerifiedTransparencyTreeHead>
> {
  return runVerifier(async () => {
    const normalizedTreeHead = normalizeSignedTransparencyTreeHead(treeHead);
    const logKeyFingerprint = await toFingerprint(logPublicKey);
    if (logKeyFingerprint !== normalizedTreeHead.logKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "transparency tree head log key fingerprint does not match public key",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedTreeHead.signature);
    } catch {
      throwVerification(
        "signature_mismatch",
        "transparency tree head signature invalid",
      );
    }

    if (
      !verify(
        signature,
        transparencyTreeHeadSigningBytes(
          toUnsignedTransparencyTreeHead(normalizedTreeHead),
        ),
        logPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "transparency tree head signature verification failed",
      );
    }

    return makeVerifiedTransparencyTreeHead({
      treeHead: normalizedTreeHead,
      checkpoint: transparencyTreeCheckpointFromHead(normalizedTreeHead),
    });
  });
}

function normalizeTransparencyInclusionProof(
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

function normalizeTransparencyConsistencyProof(
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

function verifyTransparencyInclusionProofAgainstHead(input: {
  readonly leafHash: string;
  readonly proof: TransparencyInclusionProof;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): void {
  if (input.proof.treeSize !== input.treeHead.treeHead.treeSize) {
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
}

async function verifyTransparencyInclusionRoot(input: {
  readonly leafHash: string;
  readonly proof: TransparencyInclusionProof;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<void> {
  verifyTransparencyInclusionProofAgainstHead(input);
  const computedRoot = await computeTransparencyInclusionRoot({
    leafHash: input.leafHash,
    proof: input.proof,
  });

  if (computedRoot !== input.treeHead.treeHead.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency inclusion proof root does not match tree head",
    );
  }
}

async function verifyTransparencyConsistencyRoot(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<void> {
  verifyTransparencyConsistencyShape(input);

  if (await verifyTrivialTransparencyConsistency(input)) {
    return;
  }

  const roots = await computeTransparencyConsistencyProofRoots(input);
  if (roots.proofIndex !== input.proof.nodeHashes.length) {
    throwVerification(
      "invalid_shape",
      "transparency consistency proof has extra nodes",
    );
  }

  verifyTransparencyConsistencyProofRoots({
    ...input,
    previousRoot: roots.previousRoot,
    currentRoot: roots.currentRoot,
  });
}

function verifyTransparencyConsistencyShape(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): void {
  if (input.previousTreeHead.treeHead.logId !== input.treeHead.treeHead.logId) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof log id does not match",
    );
  }

  if (
    input.proof.previousTreeSize !== input.previousTreeHead.treeHead.treeSize
  ) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof previous tree size does not match",
    );
  }

  if (input.proof.treeSize !== input.treeHead.treeHead.treeSize) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof tree size does not match",
    );
  }

  if (
    input.previousTreeHead.treeHead.treeSize > input.treeHead.treeHead.treeSize
  ) {
    throwVerification(
      "rollback",
      "transparency tree head is older than the local checkpoint",
    );
  }
}

async function verifyTrivialTransparencyConsistency(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<boolean> {
  if (input.previousTreeHead.treeHead.treeSize === 0) {
    const emptyRoot = await computeTransparencyEmptyTreeHash();
    if (input.previousTreeHead.treeHead.rootHash !== emptyRoot) {
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

  if (
    input.previousTreeHead.treeHead.treeSize ===
    input.treeHead.treeHead.treeSize
  ) {
    if (input.proof.nodeHashes.length !== 0) {
      throwVerification(
        "invalid_shape",
        "same-size transparency consistency proof must be empty",
      );
    }

    if (
      input.previousTreeHead.treeHead.rootHash !==
      input.treeHead.treeHead.rootHash
    ) {
      throwVerification(
        "equivocation",
        "same-size transparency tree head root changed",
      );
    }
    return true;
  }

  return false;
}

function readTransparencyConsistencyNode(
  proof: TransparencyConsistencyProof,
  proofIndex: number,
): string {
  const proofHash = proof.nodeHashes[proofIndex];
  if (!proofHash) {
    throwVerification(
      "missing_dependency",
      "transparency consistency proof is missing a node",
    );
  }
  return proofHash;
}

function halveTreeIndex(value: number): number {
  return Math.floor(value / 2);
}

interface TransparencyConsistencyRootState {
  readonly previousNodeIndex: number;
  readonly currentNodeIndex: number;
  readonly previousRoot: string;
  readonly currentRoot: string;
  readonly proofIndex: number;
}

function initializeTransparencyConsistencyRootState(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): TransparencyConsistencyRootState {
  let previousNodeIndex = input.previousTreeHead.treeHead.treeSize - 1;
  let currentNodeIndex = input.treeHead.treeHead.treeSize - 1;

  while (previousNodeIndex % 2 === 1) {
    previousNodeIndex = halveTreeIndex(previousNodeIndex);
    currentNodeIndex = halveTreeIndex(currentNodeIndex);
  }

  let proofIndex = 0;
  let previousRoot: string;
  let currentRoot: string;

  if (previousNodeIndex === 0) {
    previousRoot = input.previousTreeHead.treeHead.rootHash;
    currentRoot = input.previousTreeHead.treeHead.rootHash;
  } else {
    const firstProofHash = readTransparencyConsistencyNode(input.proof, 0);
    previousRoot = firstProofHash;
    currentRoot = firstProofHash;
    proofIndex += 1;
  }

  return {
    previousNodeIndex,
    currentNodeIndex,
    previousRoot,
    currentRoot,
    proofIndex,
  };
}

async function foldPreviousTransparencyConsistencyNodes(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly state: TransparencyConsistencyRootState;
}): Promise<TransparencyConsistencyRootState> {
  let { currentNodeIndex, currentRoot, previousNodeIndex, previousRoot } =
    input.state;
  let { proofIndex } = input.state;

  while (previousNodeIndex > 0) {
    const proofHash = readTransparencyConsistencyNode(input.proof, proofIndex);

    if (previousNodeIndex % 2 === 1) {
      previousRoot = await computeTransparencyNodeHash(proofHash, previousRoot);
      currentRoot = await computeTransparencyNodeHash(proofHash, currentRoot);
    } else {
      currentRoot = await computeTransparencyNodeHash(currentRoot, proofHash);
    }

    previousNodeIndex = halveTreeIndex(previousNodeIndex);
    currentNodeIndex = halveTreeIndex(currentNodeIndex);
    proofIndex += 1;
  }

  return {
    previousNodeIndex,
    currentNodeIndex,
    previousRoot,
    currentRoot,
    proofIndex,
  };
}

async function foldCurrentTransparencyConsistencyNodes(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly state: TransparencyConsistencyRootState;
}): Promise<TransparencyConsistencyRootState> {
  let { currentNodeIndex, currentRoot, previousNodeIndex, previousRoot } =
    input.state;
  let { proofIndex } = input.state;

  while (currentNodeIndex > 0) {
    const proofHash = readTransparencyConsistencyNode(input.proof, proofIndex);

    currentRoot = await computeTransparencyNodeHash(currentRoot, proofHash);
    currentNodeIndex = halveTreeIndex(currentNodeIndex);
    proofIndex += 1;
  }

  return {
    previousNodeIndex,
    currentNodeIndex,
    previousRoot,
    currentRoot,
    proofIndex,
  };
}

async function computeTransparencyConsistencyProofRoots(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<{
  readonly previousRoot: string;
  readonly currentRoot: string;
  readonly proofIndex: number;
}> {
  const previousFold = await foldPreviousTransparencyConsistencyNodes({
    proof: input.proof,
    state: initializeTransparencyConsistencyRootState(input),
  });
  const currentFold = await foldCurrentTransparencyConsistencyNodes({
    proof: input.proof,
    state: previousFold,
  });

  return {
    previousRoot: currentFold.previousRoot,
    currentRoot: currentFold.currentRoot,
    proofIndex: currentFold.proofIndex,
  };
}

function verifyTransparencyConsistencyProofRoots(input: {
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
  readonly previousRoot: string;
  readonly currentRoot: string;
}): void {
  if (input.previousRoot !== input.previousTreeHead.treeHead.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency consistency proof previous root mismatch",
    );
  }

  if (input.currentRoot !== input.treeHead.treeHead.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency consistency proof current root mismatch",
    );
  }
}

export async function verifyTransparencyProof({
  consistencyProof,
  inclusionProof,
  leaf,
  logPublicKey,
  previousTreeHead,
  treeHead,
}: VerifyTransparencyProofInput): Promise<
  KeyingVerificationResult<VerifiedTransparencyProof>
> {
  return runVerifier(async () => {
    const verifiedTreeHead = await verifySignedTransparencyTreeHead({
      treeHead,
      logPublicKey,
    });

    if (!verifiedTreeHead.ok) {
      throw verifiedTreeHead.error;
    }

    const normalizedLeaf = normalizeTransparencyLeaf(leaf);
    const leafHash = await computeTransparencyLeafHash(normalizedLeaf);
    const normalizedInclusionProof =
      normalizeTransparencyInclusionProof(inclusionProof);

    await verifyTransparencyInclusionRoot({
      leafHash,
      proof: normalizedInclusionProof,
      treeHead: verifiedTreeHead.value,
    });

    let normalizedConsistencyProof: TransparencyConsistencyProof | undefined;

    if (previousTreeHead || consistencyProof) {
      if (!previousTreeHead || !consistencyProof) {
        throwVerification(
          "missing_dependency",
          "transparency consistency verification requires both previous tree head and proof",
        );
      }

      const verifiedPreviousTreeHead = await verifySignedTransparencyTreeHead({
        treeHead: previousTreeHead,
        logPublicKey,
      });

      if (!verifiedPreviousTreeHead.ok) {
        throw verifiedPreviousTreeHead.error;
      }

      normalizedConsistencyProof =
        normalizeTransparencyConsistencyProof(consistencyProof);
      await verifyTransparencyConsistencyRoot({
        proof: normalizedConsistencyProof,
        previousTreeHead: verifiedPreviousTreeHead.value,
        treeHead: verifiedTreeHead.value,
      });
    }

    return makeVerifiedTransparencyProof({
      leaf: normalizedLeaf,
      leafHash,
      treeHead: verifiedTreeHead.value,
      inclusionProof: normalizedInclusionProof,
      ...(normalizedConsistencyProof
        ? { consistencyProof: normalizedConsistencyProof }
        : {}),
    });
  });
}
