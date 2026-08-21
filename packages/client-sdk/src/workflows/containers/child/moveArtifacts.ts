import type {
  ContainerAccessManifestState,
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerMoveAccessEventBody,
} from "@symcrypt/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
  deriveContainerAccessManifest,
} from "@symcrypt/crypto";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  buildContainerCreateKeyEpoch,
  signContainerMutationEvent,
} from "../../../data/containers/shared/events";
import {
  type getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import type {
  ContainerMovePlan,
  ContainerMutationAuthor,
} from "../../../data/containers/shared/types";
import { buildContainerRotationArtifacts } from "./moveRotation";

async function deriveContainerMoveManifest(input: {
  containerKeyEpochId: string;
  destinationParent: ContainerWriterProjectionResponse["path"][number];
  eventHash: string;
  previousManifest: ContainerWriterProjectionResponse["path"][number];
}): Promise<Pick<ContainerMovePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerState(input.previousManifest);
  const destinationState = readContainerState(input.destinationParent);
  const state: ContainerAccessManifestState = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: input.eventHash,
    parentContainerId: destinationState.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

async function buildContainerMoveEventBody(input: {
  containerKeyEpochId: string;
  keyring: ContainerKekKeyring;
  parentContainerId: string;
  parentManifestHash: string;
  predecessorBridge: ContainerKekPredecessorBridge;
}): Promise<ContainerMoveAccessEventBody> {
  return {
    eventType: "container.move",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
    keyringHash: await computeContainerKekKeyringHash(input.keyring),
    predecessorBridgeHash: await computeContainerKekPredecessorBridgeHash(
      input.predecessorBridge,
    ),
  };
}

interface MoveSigningContext {
  author: ContainerMutationAuthor;
  dependencyManifestHashes: readonly string[];
  eventId: string | undefined;
  signedAt: string | undefined;
}

function signContainerMoveEvent(input: {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  signing: MoveSigningContext;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  return signContainerMutationEvent({
    author: input.signing.author,
    body: input.body,
    containerId: input.containerId,
    dependencyManifestHashes: input.signing.dependencyManifestHashes,
    eventId: input.signing.eventId ?? crypto.randomUUID(),
    previousManifestHash: input.source.manifest.manifestHash,
    signedAt: input.signing.signedAt ?? new Date().toISOString(),
  });
}

function buildMoveKeyEpoch(input: {
  containerKeyEpochId: string;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  eventHash: string;
  manifestHash: string;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  return buildContainerCreateKeyEpoch({
    containerId: readContainerState(input.source.manifest).containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash: input.eventHash,
    keyEpoch: input.source.kek.containerKeyEpoch + 1,
    manifestHash: input.manifestHash,
    parentContainerKeyEpochId: input.destinationParent.kek.containerKeyEpochId,
  });
}

export async function buildMoveRotationWithBody(input: {
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  destinationState: ContainerAccessManifestState;
  override: string | undefined;
  predecessorContainerKey: Uint8Array;
  previousState: ContainerAccessManifestState;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const rotation = await buildContainerRotationArtifacts({
    containerId: input.previousState.containerId,
    currentKek: input.source.kek,
    currentKeyMaterial: input.predecessorContainerKey,
    keyEpoch: input.source.kek.containerKeyEpoch + 1,
    override: input.override,
  });
  const body = await buildContainerMoveEventBody({
    containerKeyEpochId: rotation.containerKeyEpochId,
    keyring: rotation.keyring,
    parentContainerId: input.destinationState.containerId,
    parentManifestHash: input.destinationParent.manifest.manifestHash,
    predecessorBridge: rotation.predecessorBridge,
  });
  return { ...rotation, body };
}

export async function deriveMoveManifestArtifacts(input: {
  body: ContainerMoveAccessEventBody;
  containerKeyEpochId: string;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  previousState: ContainerAccessManifestState;
  signing: MoveSigningContext;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const { event, eventHash } = await signContainerMoveEvent({
    body: input.body,
    containerId: input.previousState.containerId,
    signing: input.signing,
    source: input.source,
  });
  const { manifest, manifestHash, state } = await deriveContainerMoveManifest({
    containerKeyEpochId: input.containerKeyEpochId,
    destinationParent: input.destinationParent.manifest,
    eventHash,
    previousManifest: input.source.manifest,
  });
  const keyEpoch = buildMoveKeyEpoch({
    containerKeyEpochId: input.containerKeyEpochId,
    destinationParent: input.destinationParent,
    eventHash,
    manifestHash,
    source: input.source,
  });
  return { event, eventHash, keyEpoch, manifest, manifestHash, state };
}
