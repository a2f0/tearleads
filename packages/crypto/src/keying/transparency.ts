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
  readHashString,
  readNonNegativeInteger,
  readPositiveInteger,
  readSignedAt,
  readString,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import {
  assertTransparencyConsistency,
  assertTransparencyInclusion,
  normalizeTransparencyConsistencyProof,
  normalizeTransparencyInclusionProof,
} from "./transparencyProofs";
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

    await assertTransparencyInclusion({
      leafHash,
      proof: normalizedInclusionProof,
      checkpoint: verifiedTreeHead.value.checkpoint,
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
      await assertTransparencyConsistency({
        proof: normalizedConsistencyProof,
        previousCheckpoint: verifiedPreviousTreeHead.value.checkpoint,
        checkpoint: verifiedTreeHead.value.checkpoint,
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
