import type {
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  makeVerifiedContainerKekState,
  normalizeContainerKekKeyring,
  normalizeContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionString,
  readProjectionValue,
} from "../../../../keyingProjectionRecords";
import { mutationShapeError } from "../errors";

function isKekRecipientKind(
  value: unknown,
): value is ContainerKeyWrap["recipientKind"] {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

function readContainerUserRecipientKey(
  value: unknown,
  label: string,
): ContainerUserRecipientKey {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  return {
    userId: readProjectionString(record, "userId", label, mutationShapeError),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      mutationShapeError,
    ),
  };
}

export function userRecipientKeysFromRequest(
  request: ContainerMutationRequest,
): ContainerUserRecipientKey[] {
  return (request.userRecipientKeys ?? []).map((key, index) =>
    readContainerUserRecipientKey(key, `userRecipientKeys[${index}]`),
  );
}

export function readContainerKekPredecessorBridge(
  value: unknown,
  label: string,
): ContainerKekPredecessorBridge {
  try {
    return normalizeContainerKekPredecessorBridge(value);
  } catch {
    throw mutationShapeError(`${label} is invalid`);
  }
}

export function readContainerKekKeyring(
  value: unknown,
  label: string,
): ContainerKekKeyring {
  try {
    return normalizeContainerKekKeyring(value);
  } catch {
    throw mutationShapeError(`${label} is invalid`);
  }
}

export function readContainerKeyEpoch(
  value: unknown,
  label: string,
): ContainerKeyEpoch {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  return {
    id: readProjectionString(record, "id", label, mutationShapeError),
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      mutationShapeError,
    ),
    keyEpoch: readProjectionPositiveInteger(
      record,
      "keyEpoch",
      label,
      mutationShapeError,
    ),
    accessManifestHash: readProjectionString(
      record,
      "accessManifestHash",
      label,
      mutationShapeError,
    ),
    parentContainerKeyEpochId: readProjectionNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
      mutationShapeError,
    ),
    createdByEventHash: readProjectionString(
      record,
      "createdByEventHash",
      label,
      mutationShapeError,
    ),
    createdByManifestHash: readProjectionString(
      record,
      "createdByManifestHash",
      label,
      mutationShapeError,
    ),
  };
}

export function containerKeyEpochRecord(
  keyEpoch: ContainerKeyEpoch,
): Record<string, unknown> {
  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}

function readContainerKeyWrap(value: unknown, label: string): ContainerKeyWrap {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const recipientKind = readProjectionValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw mutationShapeError(`${label}.recipientKind is invalid`);
  }

  return {
    containerKeyEpochId: readProjectionString(
      record,
      "containerKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKind,
    recipientId: readProjectionString(
      record,
      "recipientId",
      label,
      mutationShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      mutationShapeError,
    ),
    kemCipherText: readProjectionString(
      record,
      "kemCipherText",
      label,
      mutationShapeError,
    ),
    wrappedKey: readProjectionString(
      record,
      "wrappedKey",
      label,
      mutationShapeError,
    ),
    wrapManifestHash: readProjectionString(
      record,
      "wrapManifestHash",
      label,
      mutationShapeError,
    ),
  };
}

export function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrap[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerKeyWrap(entry, `${label}[${index}]`),
  );
}

export function containerKeyWrapRecord(
  wrap: ContainerKeyWrap,
): Record<string, unknown> {
  return {
    containerKeyEpochId: wrap.containerKeyEpochId,
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    kemCipherText: wrap.kemCipherText,
    wrappedKey: wrap.wrappedKey,
    wrapManifestHash: wrap.wrapManifestHash,
  };
}

function readContainerKekRecipientTarget(
  value: unknown,
  label: string,
): ContainerKekRecipientTarget {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const recipientKind = readProjectionValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw mutationShapeError(`${label}.recipientKind is invalid`);
  }

  return {
    recipientKind,
    recipientId: readProjectionString(
      record,
      "recipientId",
      label,
      mutationShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      mutationShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      mutationShapeError,
    ),
  };
}

function readContainerKekRecipientTargets(
  value: unknown,
  label: string,
): ContainerKekRecipientTarget[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerKekRecipientTarget(entry, `${label}[${index}]`),
  );
}

export function containerKekRecipientTargetRecord(
  target: ContainerKekRecipientTarget,
): Record<string, unknown> {
  return {
    recipientKind: target.recipientKind,
    recipientId: target.recipientId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
  };
}

export function readVerifiedContainerKekState(
  value: unknown,
  label: string,
): VerifiedContainerKekState {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);

  return makeVerifiedContainerKekState({
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      mutationShapeError,
    ),
    accessManifestHash: readProjectionString(
      record,
      "accessManifestHash",
      label,
      mutationShapeError,
    ),
    containerKeyEpochId: readProjectionString(
      record,
      "containerKeyEpochId",
      label,
      mutationShapeError,
    ),
    containerKeyEpoch: readProjectionPositiveInteger(
      record,
      "containerKeyEpoch",
      label,
      mutationShapeError,
    ),
    keyEpoch: readContainerKeyEpoch(
      readProjectionValue(record, "keyEpoch"),
      `${label}.keyEpoch`,
    ),
    keyEpochHash: readProjectionString(
      record,
      "keyEpochHash",
      label,
      mutationShapeError,
    ),
    parentContainerKeyEpochId: readProjectionNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
      mutationShapeError,
    ),
    keyTargetHash: readProjectionString(
      record,
      "keyTargetHash",
      label,
      mutationShapeError,
    ),
    recipientTargets: readContainerKekRecipientTargets(
      readProjectionValue(record, "recipientTargets"),
      `${label}.recipientTargets`,
    ),
    wraps: readContainerKeyWraps(
      readProjectionValue(record, "wraps"),
      `${label}.wraps`,
    ),
  });
}
