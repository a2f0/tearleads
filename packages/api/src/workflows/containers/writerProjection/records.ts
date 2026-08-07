import type {
  AccessManifest,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantSubjectType,
  ContainerKekKeyring,
  ContainerKekRecipientTarget,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { makeVerifiedContainerAccessManifest } from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ContainerKekResponse,
} from "@tearleads/validators/response";
import {
  toContainerKeyEpoch,
  toContainerKeyWrap,
} from "../../../access/read/containerKekStore";
import {
  accessManifestCheckpoint,
  containerAccessManifestStateRecord,
  createProjectionReaders,
} from "../../../keyingProjectionRecords";
import type { ContainerKekProjection } from "./types";
import { ContainerWriterProjectionError } from "./types";

function projectionError(message: string): ContainerWriterProjectionError {
  return new ContainerWriterProjectionError(message, 409);
}

const {
  accessManifestRecord,
  readAccessManifest,
  readCanonicalRecord,
  readNullableString,
  readPlainRecord,
  readPositiveInteger,
  readReferencedPrincipalHeads,
  readString,
  readValue,
  readVerifiedAccessEvent,
  readVersion,
  verifiedAccessEventRecord,
} = createProjectionReaders(projectionError);

function isContainerAccessLevel(value: unknown): value is ContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "organization" || value === "user";
}

function readContainerDirectGrant(
  value: unknown,
  label: string,
): ContainerDirectGrant {
  const record = readPlainRecord(value, label);
  const accessLevel = readValue(record, "accessLevel");
  const subjectType = readValue(record, "subjectType");
  if (!isContainerAccessLevel(accessLevel)) {
    throw projectionError(`${label}.accessLevel is invalid`);
  }
  if (!isContainerGrantSubjectType(subjectType)) {
    throw projectionError(`${label}.subjectType is invalid`);
  }

  return {
    subjectType,
    subjectId: readString(record, "subjectId", label),
    accessLevel,
  };
}

function readContainerDirectGrants(
  value: unknown,
  label: string,
): ContainerDirectGrant[] {
  if (!Array.isArray(value)) {
    throw projectionError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerDirectGrant(entry, `${label}[${index}]`),
  );
}

interface ContainerAccessStateFields {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly directGrants: ContainerDirectGrant[];
  readonly epoch: number;
  readonly eventHash: string;
  readonly metadataDocumentId: string;
  readonly organizationId: string;
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly previousManifestHash: string | null;
  readonly referencedPrincipalHeads: ReferencedPrincipalHead[];
}

function readContainerAccessStateFields(
  record: Record<string, unknown>,
): ContainerAccessStateFields {
  readVersion(record, "Container manifest state");

  return {
    containerId: readString(record, "containerId", "Container manifest state"),
    organizationId: readString(
      record,
      "organizationId",
      "Container manifest state",
    ),
    epoch: readPositiveInteger(record, "epoch", "Container manifest state"),
    previousManifestHash: readNullableString(
      record,
      "previousManifestHash",
      "Container manifest state",
    ),
    eventHash: readString(record, "eventHash", "Container manifest state"),
    parentContainerId: readNullableString(
      record,
      "parentContainerId",
      "Container manifest state",
    ),
    parentManifestHash: readNullableString(
      record,
      "parentManifestHash",
      "Container manifest state",
    ),
    metadataDocumentId: readString(
      record,
      "metadataDocumentId",
      "Container manifest state",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "Container manifest state",
    ),
    directGrants: readContainerDirectGrants(
      readValue(record, "directGrants"),
      "Container manifest state.directGrants",
    ),
    referencedPrincipalHeads: readReferencedPrincipalHeads(
      readValue(record, "referencedPrincipalHeads"),
      "Container manifest state.referencedPrincipalHeads",
    ),
  };
}

function assertContainerManifestMatchesState(
  manifest: AccessManifest,
  state: ContainerAccessStateFields,
): void {
  if (
    manifest.objectKind !== "container" ||
    manifest.objectId !== state.containerId ||
    manifest.organizationId !== state.organizationId ||
    manifest.epoch !== state.epoch ||
    manifest.eventHash !== state.eventHash ||
    manifest.previousManifestHash !== state.previousManifestHash
  ) {
    throw new ContainerWriterProjectionError(
      "Container manifest state mismatch",
      409,
    );
  }
}

export function toManifestBundleResponse(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: KeyingCanonicalJson;
}): AccessManifestBundleWireResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Container manifest state"),
  };
}

export function toVerifiedContainerManifest(
  bundle: AccessManifestBundleWireResponse,
): VerifiedContainerAccessManifest {
  const manifest = readAccessManifest(bundle.manifest, "Container manifest");
  return makeVerifiedContainerAccessManifest({
    event: readVerifiedAccessEvent(
      bundle.event,
      "Container access event bundle",
    ),
    manifest,
    manifestHash: bundle.manifestHash,
    state: readContainerAccessState(bundle),
    checkpoint: accessManifestCheckpoint({
      manifest,
      manifestHash: bundle.manifestHash,
    }),
  });
}

function readContainerAccessState(
  bundle: AccessManifestBundleWireResponse,
): ContainerAccessManifestState {
  const record = readPlainRecord(bundle.state, "Container manifest state");
  const manifest = readAccessManifest(bundle.manifest, "Container manifest");
  const state = readContainerAccessStateFields(record);
  assertContainerManifestMatchesState(manifest, state);

  return containerAccessManifestStateRecord({
    version: 1,
    containerId: state.containerId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    parentContainerId: state.parentContainerId,
    parentManifestHash: state.parentManifestHash,
    metadataDocumentId: state.metadataDocumentId,
    containerKeyEpochId: state.containerKeyEpochId,
    directGrants: state.directGrants,
    referencedPrincipalHeads: state.referencedPrincipalHeads,
  });
}

function containerKekRecipientTargetRecord(
  target: ContainerKekRecipientTarget,
): Record<string, unknown> {
  return {
    recipientKind: target.recipientKind,
    recipientId: target.recipientId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
  };
}

export function containerKekResponse(
  projection: ContainerKekProjection,
  keyring: ContainerKekKeyring | null,
): ContainerKekResponse {
  const kekState = projection.state;
  return {
    containerId: kekState.containerId,
    accessManifestHash: kekState.accessManifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
    keyring: keyring ? { ...keyring } : null,
    keyEpoch: { ...toContainerKeyEpoch(kekState.keyEpoch) },
    keyEpochHash: kekState.keyEpochHash,
    keyTargetHash: kekState.keyTargetHash,
    parentContainerKeyEpochId: kekState.parentContainerKeyEpochId,
    containerManifestHistory: projection.manifestHistory,
    recipientTargets: kekState.recipientTargets.map(
      containerKekRecipientTargetRecord,
    ),
    wraps: kekState.wraps.map((wrap) => ({ ...toContainerKeyWrap(wrap) })),
  };
}
