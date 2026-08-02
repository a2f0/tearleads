import {
  type ContainerKekRecipientTarget,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers";
import { moveRemoteContainer } from "../../src/workflows/containers/child/move";
import {
  createMutationResponseFromRequest,
  type createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "./containerFixtures";

type ProjectionBundle = ContainerWriterProjectionResponse["path"][number];
type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];
type RemoteMovePlan = NonNullable<
  Awaited<ReturnType<typeof moveRemoteContainer>>
>["plan"];

function movePlanManifestBundle(plan: RemoteMovePlan): ProjectionBundle {
  return {
    event: {
      event: plan.event as unknown as Record<string, unknown>,
      body: plan.body as unknown,
      eventHash: plan.eventHash,
    },
    manifest: plan.manifest as unknown as Record<string, unknown>,
    manifestHash: plan.manifestHash,
    state: plan.state as unknown as Record<string, unknown>,
  };
}

async function movePlanKek(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  manifestHistory: readonly ProjectionBundle[];
  plan: RemoteMovePlan;
  sourceProjection: ContainerWriterProjectionResponse;
}): Promise<ProjectionKek> {
  const destinationParentKek =
    input.destinationParentProjection.containerKeks.at(-1);
  if (!destinationParentKek) {
    throw new Error("Expected destination parent KEK");
  }
  const keyring = input.plan.request.keyring;
  if (!keyring) {
    throw new Error("Expected move keyring");
  }
  const recipientTargets: ContainerKekRecipientTarget[] = [
    {
      recipientKind: "container",
      recipientId: destinationParentKek.containerId,
      recipientKeyEpochId: destinationParentKek.containerKeyEpochId,
      recipientKeyFingerprint: destinationParentKek.keyEpochHash,
    },
  ];
  return {
    containerId: input.plan.containerId,
    accessManifestHash: input.plan.manifestHash,
    containerKeyEpochId: input.plan.containerKeyEpochId,
    containerKeyEpoch: input.plan.keyEpoch.keyEpoch,
    keyEpoch: input.plan.keyEpoch as unknown as Record<string, unknown>,
    keyEpochHash: await computeContainerKeyEpochHash(input.plan.keyEpoch),
    keyTargetHash:
      await computeContainerKekRecipientTargetHash(recipientTargets),
    parentContainerKeyEpochId: input.plan.keyEpoch.parentContainerKeyEpochId,
    containerManifestHistory: [...input.manifestHistory],
    keyring: keyring as unknown as ProjectionKek["keyring"],
    recipientTargets: recipientTargets as unknown as Record<string, unknown>[],
    wraps: input.plan.wraps as unknown as Record<string, unknown>[],
  };
}

export async function createChildContainerProjection(input: {
  containerId: string;
  parent: Awaited<ReturnType<typeof createParentProjection>>;
  parentProjection: ContainerWriterProjectionResponse;
}) {
  const materializedPlan = await buildMaterializedContainerCreatePlan({
    author: input.parent.author,
    containerId: input.containerId,
    eventId: `${input.containerId}-event-1`,
    metadataDocumentId: `${input.containerId}-metadata-document`,
    parentProjection: input.parentProjection,
    parentSecretKey: input.parent.secretKey,
    signedAt: SIGNED_AT,
    trustedLocalProjection: true,
  });
  const projection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan,
    parentProjection: input.parentProjection,
  });
  const bundle = projection.path.at(-1);
  if (!bundle) {
    throw new Error("Expected created child projection bundle");
  }
  return { bundle, containerKey: materializedPlan.containerKey, projection };
}

export async function moveContainerProjection(input: {
  containerId: string;
  destinationParentProjection: ContainerWriterProjectionResponse;
  eventId: string;
  manifestHistory: readonly ProjectionBundle[];
  parent: Awaited<ReturnType<typeof createParentProjection>>;
  sourceProjection: ContainerWriterProjectionResponse;
}) {
  const { close, execSql } = await createTestExecSql(input.eventId);
  const moved = await moveRemoteContainer({
    apiClient: {
      getContainerWriterProjection: async (containerId) => {
        if (containerId === input.sourceProjection.containerId) {
          return input.sourceProjection;
        }
        return containerId === input.destinationParentProjection.containerId
          ? input.destinationParentProjection
          : null;
      },
      moveContainer: async (_containerId, request) =>
        createMutationResponseFromRequest(
          request,
          input.sourceProjection.containerKeks.at(-1),
        ),
    },
    author: input.parent.author,
    containerId: input.containerId,
    destinationParentContainerId: input.destinationParentProjection.containerId,
    eventId: input.eventId,
    execSql,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(
      input.parent,
    ),
    signedAt: SIGNED_AT,
    targetSecretKey: input.parent.secretKey,
  }).finally(close);
  if (!moved) {
    throw new Error("Expected remote container move result");
  }
  const bundle = movePlanManifestBundle(moved.plan);
  const projection: ContainerWriterProjectionResponse = {
    containerId: moved.plan.containerId,
    organizationId: moved.plan.state.organizationId,
    path: [...input.destinationParentProjection.path, bundle],
    containerKeks: [
      ...input.destinationParentProjection.containerKeks,
      await movePlanKek({
        destinationParentProjection: input.destinationParentProjection,
        manifestHistory: input.manifestHistory,
        plan: moved.plan,
        sourceProjection: input.sourceProjection,
      }),
    ],
  };
  return { bundle, containerKey: moved.containerKey, projection };
}
