import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  containerKekParentRef,
  containerManifestRef,
} from "../../../../data/containers/shared/projection";
import type {
  ContainerMovePlan,
  MaterializedContainerMovePlan,
} from "../../../../data/containers/shared/types";
import { readCanonicalRecord } from "../../../../data/keying/canonicalJson";
import type { PrincipalPolicyCurrentEvidence } from "../../../../data/principals/principalPolicyEvidence";
import {
  containerMutationRequestCore,
  previousPathRequestFields,
} from "../mutationRequestCore";

function buildContainerMoveRequest(input: {
  body: ContainerMoveAccessEventBody;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly PrincipalPolicyCurrentEvidence[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    ...containerMutationRequestCore("move", input),
    ...previousPathRequestFields(
      input.previousManifest,
      input.previousProjection,
    ),
    destinationParentContainerPathRefs:
      input.destinationParentProjection.path.map(containerManifestRef),
    predecessorBridge: readCanonicalRecord(
      input.predecessorBridge,
      "Container move predecessor bridge",
    ),
    keyring: readCanonicalRecord(input.keyring, "Container move keyring"),
    parentKekRef: containerKekParentRef(input.destinationParentKek),
  };
}

export function buildContainerMovePlanResult(input: {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly PrincipalPolicyCurrentEvidence[];
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}): MaterializedContainerMovePlan {
  const plan: ContainerMovePlan = {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    keyring: input.keyring,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousManifest: input.previousManifest,
    request: buildContainerMoveRequest({
      body: input.body,
      destinationParentKek: input.destinationParentKek,
      destinationParentProjection: input.destinationParentProjection,
      event: input.event,
      keyEpoch: input.keyEpoch,
      keyring: input.keyring,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      predecessorBridge: input.predecessorBridge,
      principalPolicies: input.principalPolicies,
      userRecipientKeys: input.userRecipientKeys,
      wraps: input.wraps,
    }),
    state: input.state,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}
