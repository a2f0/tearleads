import type {
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantSubjectType,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { makeVerifiedContainerAccessManifest } from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import {
  accessManifestCheckpoint,
  containerAccessManifestStateRecord,
  readProjectionAccessManifest,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionReferencedPrincipalHeads,
  readProjectionString,
  readProjectionValue,
  readProjectionVerifiedAccessEvent,
  readProjectionVersion,
} from "../../../../keyingProjectionRecords";
import { mutationShapeError } from "../errors";

function isContainerAccessLevel(value: unknown): value is ContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "user";
}

function readContainerDirectGrant(
  value: unknown,
  label: string,
): ContainerDirectGrant {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  const accessLevel = readProjectionValue(record, "accessLevel");
  const subjectType = readProjectionValue(record, "subjectType");

  if (!isContainerAccessLevel(accessLevel)) {
    throw mutationShapeError(`${label}.accessLevel is invalid`);
  }
  if (!isContainerGrantSubjectType(subjectType)) {
    throw mutationShapeError(`${label}.subjectType is invalid`);
  }

  return {
    accessLevel,
    subjectId: readProjectionString(
      record,
      "subjectId",
      label,
      mutationShapeError,
    ),
    subjectType,
  };
}

function readContainerDirectGrants(
  value: unknown,
  label: string,
): ContainerDirectGrant[] {
  if (!Array.isArray(value)) {
    throw mutationShapeError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerDirectGrant(entry, `${label}[${index}]`),
  );
}

function readContainerAccessState(
  value: unknown,
  label: string,
): ContainerAccessManifestState {
  const record = readProjectionPlainRecord(value, label, mutationShapeError);
  readProjectionVersion(record, label, mutationShapeError);

  return containerAccessManifestStateRecord({
    version: 1,
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      mutationShapeError,
    ),
    organizationId: readProjectionString(
      record,
      "organizationId",
      label,
      mutationShapeError,
    ),
    epoch: readProjectionPositiveInteger(
      record,
      "epoch",
      label,
      mutationShapeError,
    ),
    previousManifestHash: readProjectionNullableString(
      record,
      "previousManifestHash",
      label,
      mutationShapeError,
    ),
    eventHash: readProjectionString(
      record,
      "eventHash",
      label,
      mutationShapeError,
    ),
    parentContainerId: readProjectionNullableString(
      record,
      "parentContainerId",
      label,
      mutationShapeError,
    ),
    parentManifestHash: readProjectionNullableString(
      record,
      "parentManifestHash",
      label,
      mutationShapeError,
    ),
    metadataDocumentId: readProjectionString(
      record,
      "metadataDocumentId",
      label,
      mutationShapeError,
    ),
    containerKeyEpochId: readProjectionNullableString(
      record,
      "containerKeyEpochId",
      label,
      mutationShapeError,
    ),
    directGrants: readContainerDirectGrants(
      readProjectionValue(record, "directGrants"),
      `${label}.directGrants`,
    ),
    referencedPrincipalHeads: readProjectionReferencedPrincipalHeads(
      readProjectionValue(record, "referencedPrincipalHeads"),
      `${label}.referencedPrincipalHeads`,
      mutationShapeError,
    ),
  });
}

export function readVerifiedContainerManifest(
  bundle: AccessManifestBundleWire,
  label: string,
): VerifiedContainerAccessManifest {
  const manifest = readProjectionAccessManifest(
    bundle.manifest,
    `${label}.manifest`,
    mutationShapeError,
  );

  return makeVerifiedContainerAccessManifest({
    event: readProjectionVerifiedAccessEvent(
      bundle.event,
      `${label}.event`,
      mutationShapeError,
    ),
    manifest,
    manifestHash: bundle.manifestHash,
    state: readContainerAccessState(bundle.state, `${label}.state`),
    checkpoint: accessManifestCheckpoint({
      manifest,
      manifestHash: bundle.manifestHash,
    }),
  });
}
