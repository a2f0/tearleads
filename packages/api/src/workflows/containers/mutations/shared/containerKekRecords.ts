import type {
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import {
  normalizeContainerKekKeyring,
  normalizeContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { z } from "zod";
import {
  parseProjection,
  projectionNullableString,
  projectionPositiveInteger,
  projectionRecord,
  projectionString,
} from "../../../../keyingProjectionSchemas";
import { mutationShapeError } from "../errors";

const kekRecipientKindSchema = z.enum(["container", "group", "user"]);

export const containerUserRecipientKeySchema = projectionRecord({
  userId: projectionString,
  recipientKeyEpochId: projectionString,
  recipientKeyFingerprint: projectionString,
});

export const containerKeyEpochSchema = projectionRecord({
  id: projectionString,
  containerId: projectionString,
  keyEpoch: projectionPositiveInteger,
  accessManifestHash: projectionString,
  parentContainerKeyEpochId: projectionNullableString,
  createdByEventHash: projectionString,
  createdByManifestHash: projectionString,
});

export const containerKeyWrapSchema = projectionRecord(
  {
    containerKeyEpochId: projectionString,
    recipientKind: kekRecipientKindSchema,
    recipientId: projectionString,
    recipientKeyEpochId: projectionString,
    recipientKeyFingerprint: projectionString,
    kemCipherText: projectionString,
    wrappedKey: projectionString,
    wrapManifestHash: projectionString,
  },
  ["recipientKind"],
);

export function userRecipientKeysFromRequest(
  request: ContainerMutationRequest,
): ContainerUserRecipientKey[] {
  return (request.userRecipientKeys ?? []).map((key, index) =>
    parseProjection(
      containerUserRecipientKeySchema,
      key,
      `userRecipientKeys[${index}]`,
      mutationShapeError,
    ),
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
  return parseProjection(
    containerKeyEpochSchema,
    value,
    label,
    mutationShapeError,
  );
}

export function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrap[] {
  return parseProjection(
    z.array(containerKeyWrapSchema),
    value,
    label,
    mutationShapeError,
  );
}
