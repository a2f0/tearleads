import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { referencedPrincipalKey } from "./accessEvent";
import { normalizeContainerReciteAccessEventBody } from "./containerAccessReciteBody";
import { normalizeContainerRekeyAccessEventBody } from "./containerAccessRekeyBody";
import {
  assertReferencedPrincipalHeadsMatchDirectGrants,
  managedGrantReferenceKey,
  normalizeContainerAccessKeyState,
  normalizeContainerDirectGrant,
  normalizeContainerDirectGrants,
} from "./containerAccessState";
import {
  normalizeContainerAccessMetadata,
  normalizeContainerAccessStructural,
} from "./containerAccessStructure";
import {
  normalizeContainerGrantPrincipalHead,
  normalizeContainerGrantPrincipalHeads,
} from "./containerGrantPrincipalHead";
import {
  assertExactKeys,
  normalizeContainerGrantSubjectType,
  readHashString,
  readNullableHashString,
  readString,
  throwVerification,
} from "./shared";
import type {
  ContainerAccessEventBody,
  ContainerCreateAccessEventBody,
  ContainerGrantAccessEventBody,
  ContainerMoveAccessEventBody,
  ContainerRevokeAccessEventBody,
  KeyingCanonicalJson,
} from "./types";

function normalizeContainerCreateAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerCreateAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "containerKeyPublicKey",
      "directGrants",
      "eventType",
      "metadataDocumentId",
      "systemSlot",
      "parentContainerId",
      "parentManifestHash",
      "referencedPrincipalHeads",
    ],
    "container.create event body",
  );
  const directGrants = record.directGrants;
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(directGrants)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.directGrants must be an array",
    );
  }

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.referencedPrincipalHeads must be an array",
    );
  }

  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  });
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
    containerKeyPublicKey: record.containerKeyPublicKey,
  });
  const metadata = normalizeContainerAccessMetadata({
    metadataDocumentId: record.metadataDocumentId,
    systemSlot: record.systemSlot,
  });
  const normalizedDirectGrants = normalizeContainerDirectGrants(directGrants);
  const normalizedReferencedPrincipalHeads =
    normalizeContainerGrantPrincipalHeads(referencedPrincipalHeads);

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  });

  return {
    eventType: "container.create",
    ...structural,
    ...keyState,
    ...metadata,
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  };
}

function normalizeContainerGrantAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerGrantAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "containerKeyPublicKey",
      "eventType",
      "grant",
      "referencedPrincipalHead",
    ],
    "container.grant event body",
  );
  const grant = normalizeContainerDirectGrant(record.grant);
  const referencedPrincipalHead =
    record.referencedPrincipalHead === null
      ? null
      : normalizeContainerGrantPrincipalHead(record.referencedPrincipalHead);
  const managedGrantKey = managedGrantReferenceKey(grant);

  if (managedGrantKey === null && referencedPrincipalHead !== null) {
    throwVerification(
      "missing_dependency",
      "container.grant user grants must not include a referenced principal head",
    );
  }

  if (
    managedGrantKey !== null &&
    (!referencedPrincipalHead ||
      referencedPrincipalKey(referencedPrincipalHead) !== managedGrantKey)
  ) {
    throwVerification(
      "missing_dependency",
      "container.grant managed-principal grants must include the matching referenced principal head",
    );
  }

  return {
    eventType: "container.grant",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
      containerKeyPublicKey: record.containerKeyPublicKey,
    }),
    grant,
    referencedPrincipalHead,
  };
}

function normalizeContainerRevokeAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRevokeAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "containerKeyPublicKey",
      "eventType",
      "keyringHash",
      "parentManifestHash",
      "predecessorBridgeHash",
      "subjectId",
      "subjectType",
    ],
    "container.revoke event body",
  );

  return {
    eventType: "container.revoke",
    parentManifestHash: readNullableHashString(
      record,
      "parentManifestHash",
      "container.revoke body",
    ),
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
      containerKeyPublicKey: record.containerKeyPublicKey,
    }),
    keyringHash: readHashString(
      record,
      "keyringHash",
      "container.revoke event body",
    ),
    predecessorBridgeHash: readHashString(
      record,
      "predecessorBridgeHash",
      "container.revoke event body",
    ),
    subjectId: readString(record, "subjectId", "container.revoke event body"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container.revoke event body",
    ),
  };
}

function normalizeContainerMoveAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerMoveAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "containerKeyPublicKey",
      "eventType",
      "keyringHash",
      "parentContainerId",
      "parentManifestHash",
      "predecessorBridgeHash",
    ],
    "container.move event body",
  );

  return {
    eventType: "container.move",
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    }),
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
      containerKeyPublicKey: record.containerKeyPublicKey,
    }),
    keyringHash: readHashString(
      record,
      "keyringHash",
      "container.move event body",
    ),
    predecessorBridgeHash: readHashString(
      record,
      "predecessorBridgeHash",
      "container.move event body",
    ),
  };
}

export function normalizeContainerAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "container access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "container access body");

  if (eventType === "container.create") {
    return normalizeContainerCreateAccessEventBody(value);
  }

  if (eventType === "container.grant") {
    return normalizeContainerGrantAccessEventBody(value);
  }

  if (eventType === "container.revoke") {
    return normalizeContainerRevokeAccessEventBody(value);
  }

  if (eventType === "container.rekey") {
    return normalizeContainerRekeyAccessEventBody(value);
  }

  if (eventType === "container.recite") {
    return normalizeContainerReciteAccessEventBody(value);
  }

  if (eventType === "container.move") {
    return normalizeContainerMoveAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "container access event body eventType is unsupported",
  );
}
