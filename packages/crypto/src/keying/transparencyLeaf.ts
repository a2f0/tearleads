import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { AnyVerifiedAccessManifest } from "./accessManifestVerificationTypes";
import { computeKeyingDomainHash } from "./canonical";
import type { KeyingCanonicalPayload } from "./canonicalJsonTypes";
import { normalizeIdentityStateHead } from "./checkpoints";
import type { IdentityStateHead } from "./checkpointTypes";
import type { VerifiedPrincipalPolicy } from "./principalPolicyTypes";
import {
  assertExactKeys,
  normalizeAccessObjectKind,
  normalizeManagedPrincipalKind,
  readHashString,
  readPositiveInteger,
  readString,
  readVersion,
  throwVerification,
} from "./shared";
import type {
  AccessManifestTransparencyLeaf,
  IdentityStateTransparencyLeaf,
  PrincipalPolicyTransparencyLeaf,
  TransparencyLeaf,
} from "./transparencyTypes";

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

export function normalizeTransparencyLeaf(value: unknown): TransparencyLeaf {
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
