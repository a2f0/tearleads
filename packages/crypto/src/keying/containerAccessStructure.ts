import { isContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  assertExactKeys,
  readNullableHashString,
  readNullableString,
  readString,
  throwVerification,
} from "./shared";
import type {
  ContainerAccessMetadata,
  ContainerAccessStructural,
} from "./types";

export function normalizeContainerAccessStructural(
  value: unknown,
): ContainerAccessStructural {
  const record = assertExactKeys(
    value,
    ["parentContainerId", "parentManifestHash"],
    "container access structural state",
  );
  const parentContainerId = readNullableString(
    record,
    "parentContainerId",
    "container access structural state",
  );
  const parentManifestHash = readNullableHashString(
    record,
    "parentManifestHash",
    "container access structural state",
  );

  if ((parentContainerId === null) !== (parentManifestHash === null)) {
    throwVerification(
      "invalid_shape",
      "container access parent id and parent manifest hash must both be present or both be null",
    );
  }

  return {
    parentContainerId,
    parentManifestHash,
  };
}

export function normalizeContainerAccessMetadata(
  value: unknown,
): ContainerAccessMetadata {
  const record = assertExactKeys(
    value,
    ["metadataDocumentId", "systemSlot"],
    "container access metadata state",
  );

  const systemSlot = readNullableString(
    record,
    "systemSlot",
    "container access metadata state",
  );
  if (systemSlot !== null && !isContainerSystemSlot(systemSlot)) {
    throwVerification("invalid_shape", "container system slot is invalid");
  }
  return {
    systemSlot,
    metadataDocumentId: readString(
      record,
      "metadataDocumentId",
      "container access metadata state",
    ),
  };
}

export function normalizeContainerAccessStructuralState(
  value: unknown,
): ContainerAccessStructural & ContainerAccessMetadata {
  const record = assertExactKeys(
    value,
    [
      "metadataDocumentId",
      "systemSlot",
      "parentContainerId",
      "parentManifestHash",
    ],
    "container access structural state",
  );

  return {
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    }),
    ...normalizeContainerAccessMetadata({
      metadataDocumentId: record.metadataDocumentId,
      systemSlot: record.systemSlot,
    }),
  };
}
