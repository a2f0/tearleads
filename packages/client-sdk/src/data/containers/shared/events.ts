import {
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerGrantAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerMoveAccessEventBody,
  type ContainerRekeyAccessEventBody,
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
  // The organization the new container belongs to — always the parent
  // container's org, NOT the author's. A member writing under another org's
  // shared root creates a container owned by that org; only the signer identity
  // comes from the author. The server trusts this signed field, so it is the
  // load-bearing org for the create.
  organizationId: string;
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
    organizationId: input.organizationId,
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
    | ContainerRekeyAccessEventBody
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
  containerId: string;
  containerKeyEpochId: string;
  // Grants baked into the create manifest. Defaults to none. A child container
  // born with a managed-principal (group/organization) grant — e.g. the org
  // public metadata container granted to the Members group — supplies both the
  // grant and its referenced principal head here so the manifest hash reconciles
  // with the signed event body and the server can derive the KEK recipient target.
  directGrants?: ContainerCreateAccessEventBody["directGrants"] | undefined;
  eventHash: string;
  metadataDocumentId: string;
  // The parent container's org (see signContainerCreateEvent). Must match the
  // signed event's org or the manifest hash will not reconcile server-side.
  organizationId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
  referencedPrincipalHeads?:
    | ContainerCreateAccessEventBody["referencedPrincipalHeads"]
    | undefined;
}): Promise<Pick<ContainerCreatePlan, "manifest" | "manifestHash" | "state">> {
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.eventHash,
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: input.directGrants ? [...input.directGrants] : [],
    referencedPrincipalHeads: input.referencedPrincipalHeads
      ? [...input.referencedPrincipalHeads]
      : [],
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
  /** Defaults to the creation epoch; rotations pass their next epoch. */
  keyEpoch?: number | undefined;
  manifestHash: string;
  parentContainerKeyEpochId: string | null;
}): ContainerKeyEpoch {
  return {
    id: input.containerKeyEpochId,
    containerId: input.containerId,
    keyEpoch: input.keyEpoch ?? 1,
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
  const materialId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: input.keyEpoch,
    keyMaterial: input.keyMaterial,
  });
  if (input.override !== undefined && input.override !== materialId) {
    throw new Error(
      "Container key epoch id does not match the committed KEK material",
    );
  }

  return materialId;
}
