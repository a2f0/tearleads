import {
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerGrantAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerMoveAccessEventBody,
  type ContainerRevokeAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekMaterialId,
  deriveContainerAccessManifest,
  signAccessEvent,
  type UnsignedAccessEvent,
} from "@tearleads/crypto";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { readCanonicalJson } from "../../keyingCanonicalJson";
import { uniqueSortedManifestHashes } from "./projection";
import type {
  ContainerCreatePlan,
  ContainerMovePlan,
  ContainerMutationAuthor,
  ContainerRevokePlan,
  ContainerSharePlan,
} from "./types";

export function buildContainerCreateBody(input: {
  containerKeyEpochId: string;
  metadataDocumentId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
}): ContainerCreateAccessEventBody {
  return {
    eventType: "container.create",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
}

export async function signContainerCreateEvent(input: {
  author: ContainerMutationAuthor;
  body: ContainerCreateAccessEventBody;
  containerId: string;
  eventId: string;
  parentPath: ContainerWriterProjectionResponse["path"];
  signedAt: string;
}): Promise<Pick<ContainerCreatePlan, "event" | "eventHash">> {
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(input.body, "Container create body"),
  );
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId,
    eventType: "container.create",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.author.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: uniqueSortedManifestHashes(input.parentPath),
    bodyHash,
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt,
  };
  const event = await signAccessEvent(
    unsignedEvent,
    input.author.signerPrivateKey,
  );

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

export async function signContainerMutationEvent(input: {
  author: ContainerMutationAuthor;
  body:
    | ContainerGrantAccessEventBody
    | ContainerMoveAccessEventBody
    | ContainerRevokeAccessEventBody;
  containerId: string;
  dependencyManifestHashes: readonly string[];
  eventId: string;
  previousManifestHash: string;
  signedAt: string;
}): Promise<
  Pick<
    ContainerSharePlan | ContainerMovePlan | ContainerRevokePlan,
    "event" | "eventHash"
  >
> {
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(input.body, "Container mutation body"),
  );
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId,
    eventType: input.body.eventType,
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.author.organizationId,
    previousManifestHash: input.previousManifestHash,
    dependencyManifestHashes: [
      ...new Set(input.dependencyManifestHashes),
    ].sort(),
    bodyHash,
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt,
  };
  const event = await signAccessEvent(
    unsignedEvent,
    input.author.signerPrivateKey,
  );

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

export async function deriveContainerCreateManifest(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
}): Promise<Pick<ContainerCreatePlan, "manifest" | "manifestHash" | "state">> {
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId: input.author.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.eventHash,
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

export function buildContainerCreateKeyEpoch(input: {
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  manifestHash: string;
  parentContainerKeyEpochId: string | null;
}): ContainerKeyEpoch {
  return {
    id: input.containerKeyEpochId,
    containerId: input.containerId,
    keyEpoch: 1,
    accessManifestHash: input.manifestHash,
    parentContainerKeyEpochId: input.parentContainerKeyEpochId,
    createdByEventHash: input.eventHash,
    createdByManifestHash: input.manifestHash,
  };
}

export function buildParentRecipientTargets(
  parentKek: ContainerKekResponse,
): ContainerKekRecipientTarget[] {
  return [
    {
      recipientKind: "container",
      recipientId: parentKek.containerId,
      recipientKeyEpochId: parentKek.containerKeyEpochId,
      recipientKeyFingerprint: parentKek.keyEpochHash,
    },
  ];
}

export async function resolveContainerKekEpochId(input: {
  containerId: string;
  keyEpoch: number;
  keyMaterial: Uint8Array;
  override?: string | undefined;
}): Promise<string> {
  return (
    input.override ??
    (await computeContainerKekMaterialId({
      containerId: input.containerId,
      keyEpoch: input.keyEpoch,
      keyMaterial: input.keyMaterial,
    }))
  );
}
