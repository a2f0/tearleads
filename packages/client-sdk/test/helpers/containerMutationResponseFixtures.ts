import {
  type AccessEvent,
  type ContainerCreateAccessEventBody,
  type ContainerKeyEpoch,
  computeAccessEventHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";

export async function createMutationResponseFromRequest(
  request: ContainerMutationRequest,
): Promise<ContainerMutationResponse> {
  const event = request.event as unknown as AccessEvent;
  const body = request.body as ContainerCreateAccessEventBody;
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;

  return {
    containerId: event.objectId,
    createdAt: "2026-05-05T00:00:00.000Z",
    organizationId: event.organizationId,
    parentId: body.parentContainerId,
    updatedAt: "2026-05-05T00:00:00.000Z",
    manifestHead: {
      epoch: 1,
      manifestHash: request.expectedManifestHash,
    },
    accessManifest: {
      event: {
        event: request.event,
        body: request.body as Record<string, unknown>,
        eventHash: await computeAccessEventHash(event),
      },
      manifest: request.manifest,
      manifestHash: request.expectedManifestHash,
      state: {},
    },
    containerKek: {
      containerId: event.objectId,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpochId: keyEpoch.id,
      containerKeyEpoch: keyEpoch.keyEpoch,
      keyEpoch: request.keyEpoch,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyTargetHash: "test-key-target-hash",
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      recipientTargets: [{}],
      wraps: request.wraps,
    },
    referencedPrincipalHeads: [],
  };
}
