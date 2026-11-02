import type {
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKekKeyring,
  ContainerKekRecipientTarget,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { makeVerifiedContainerAccessManifest } from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ContainerKekResponse,
} from "@tearleads/validators/response";
import { z } from "zod";
import {
  toContainerKeyEpoch,
  toContainerKeyWrap,
} from "../../../access/read/containerKekStore";
import {
  accessManifestCheckpoint,
  containerAccessManifestStateRecord,
  projectionAccessManifestRecord,
  projectionContainerAccessManifestSchema,
  projectionContainerGrantPrincipalHeadsSchema,
  projectionVerifiedAccessEventRecord,
  readProjectionVerifiedAccessEvent,
} from "../../../keyingProjectionRecords";
import {
  copyProjectionRecord,
  parseProjection,
  projectionNullableString,
  projectionPositiveInteger,
  projectionRecord,
  projectionString,
  projectionVersion,
} from "../../../keyingProjectionSchemas";
import type { ContainerKekProjection } from "./types";
import { ContainerWriterProjectionError } from "./types";

function projectionError(message: string): ContainerWriterProjectionError {
  return new ContainerWriterProjectionError(message, 409);
}

const containerDirectGrantSchema = projectionRecord(
  {
    subjectType: z.enum(["group", "user"]),
    subjectId: projectionString,
    accessLevel: z.enum(["admin", "read", "write"]),
  },
  ["accessLevel", "subjectType"],
);

const containerAccessStateSchema = projectionRecord({
  version: projectionVersion,
  systemSlot: projectionNullableString,
  containerId: projectionString,
  organizationId: projectionString,
  epoch: projectionPositiveInteger,
  previousManifestHash: projectionNullableString,
  eventHash: projectionString,
  parentContainerId: projectionNullableString,
  parentManifestHash: projectionNullableString,
  metadataDocumentId: projectionString,
  containerKeyEpochId: projectionString,
  containerKeyPublicKey: projectionString,
  directGrants: z.array(containerDirectGrantSchema),
  referencedPrincipalHeads: projectionContainerGrantPrincipalHeadsSchema,
});

type ContainerAccessStateFields = z.output<typeof containerAccessStateSchema>;

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
    event: projectionVerifiedAccessEventRecord(input.event),
    manifest: projectionAccessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: copyProjectionRecord(
      input.state,
      "Container manifest state",
      projectionError,
    ),
  };
}

export function toVerifiedContainerManifest(
  bundle: AccessManifestBundleWireResponse,
): VerifiedContainerAccessManifest {
  const manifest = readContainerManifest(bundle);
  return makeVerifiedContainerAccessManifest({
    event: readProjectionVerifiedAccessEvent(
      bundle.event,
      "Container access event bundle",
      projectionError,
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

function readContainerManifest(bundle: AccessManifestBundleWireResponse) {
  return parseProjection(
    projectionContainerAccessManifestSchema,
    bundle.manifest,
    "Container manifest",
    projectionError,
  );
}

function readContainerAccessState(
  bundle: AccessManifestBundleWireResponse,
): ContainerAccessManifestState {
  const state = parseProjection(
    containerAccessStateSchema,
    bundle.state,
    "Container manifest state",
    projectionError,
  );
  assertContainerManifestMatchesState(readContainerManifest(bundle), state);

  return containerAccessManifestStateRecord(state);
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
