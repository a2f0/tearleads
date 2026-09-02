import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import {
  normalizeDocumentKekTargetResponse,
  readManifestContainerId,
} from "../../data/documents/shared/readers";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

function replaceRekeyedPathNode(input: {
  plan: MaterializedContainerRekeyPlan;
  projection: DocumentWriterProjectionResponse["authorizingContainerPaths"][number];
}) {
  const index = input.projection.path.findIndex(
    (bundle) => readManifestContainerId(bundle) === input.plan.plan.containerId,
  );
  if (index < 0) return { projection: input.projection, replaced: false };
  const previousManifest = input.projection.path[index];
  const previousKek = input.projection.containerKeks[index];
  const nextManifest = input.plan.writerProjection.path.at(-1);
  const nextKek = input.plan.writerProjection.containerKeks.at(-1);
  if (
    !previousManifest ||
    !previousKek ||
    !nextManifest ||
    !nextKek ||
    previousManifest.manifestHash !==
      input.plan.plan.previousManifest.manifestHash ||
    previousKek.accessManifestHash !== previousManifest.manifestHash
  ) {
    throw new Error("Document inline rekey projection predecessor mismatch");
  }
  const path = [...input.projection.path];
  const containerKeks = [...input.projection.containerKeks];
  path[index] = nextManifest;
  containerKeks[index] = nextKek;
  return {
    projection: { ...input.projection, containerKeks, path },
    replaced: true,
  };
}

async function applyContainerRekeyPlan(
  writerProjection: DocumentWriterProjectionResponse,
  plan: MaterializedContainerRekeyPlan,
): Promise<DocumentWriterProjectionResponse> {
  let replacedPath = false;
  const authorizingContainerPaths =
    writerProjection.authorizingContainerPaths.map((projection) => {
      const replaced = replaceRekeyedPathNode({ plan, projection });
      replacedPath ||= replaced.replaced;
      return replaced.projection;
    });
  const nextKek = plan.writerProjection.containerKeks.at(-1);
  const nextManifest = plan.writerProjection.path.at(-1);
  if (!nextKek || !nextManifest) {
    throw new Error("Document inline rekey projection is empty");
  }
  let replacedTarget = false;
  const targets = normalizeDocumentKekTargetResponse(
    writerProjection.documentKekTargets,
  ).map((target) => {
    if (target.containerId !== plan.plan.containerId) return target;
    replacedTarget = true;
    return {
      ...target,
      containerKeyEpoch: nextKek.containerKeyEpoch,
      containerKeyEpochId: nextKek.containerKeyEpochId,
      containerManifestHash: nextManifest.manifestHash,
    };
  });
  if (!replacedPath && !replacedTarget) {
    throw new Error(
      "Document inline rekey does not belong to its writer projection",
    );
  }
  const documentKeyTargetHash =
    await computeDocumentContentKeyTargetHash(targets);
  return {
    ...writerProjection,
    authorizingContainerPaths,
    ...(documentKeyTargetHash === writerProjection.contentKeyBundle.targetHash
      ? {}
      : { contentKeyBundleStale: true as const }),
    documentKekTargets: {
      ...writerProjection.documentKekTargets,
      documentKeyTargetHash,
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      targets: targets.map((target) => ({ ...target })),
    },
  };
}

async function applyDocumentSyncContainerRekeys(input: {
  plans: readonly MaterializedContainerRekeyPlan[];
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentWriterProjectionResponse> {
  let projection = input.writerProjection;
  for (const plan of input.plans) {
    projection = await applyContainerRekeyPlan(projection, plan);
  }
  return projection;
}

export async function buildRemoteDocumentSyncPlan(input: {
  minLsn?: string | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  pullCursor?: string | undefined;
  projection: DocumentWriterProjectionResponse;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  const rekeyPlans = input.pendingUpdates.length
    ? await input.sync.buildContainerRekeys?.(input.projection)
    : undefined;
  const writerProjection = rekeyPlans?.length
    ? await applyDocumentSyncContainerRekeys({
        plans: rekeyPlans,
        writerProjection: input.projection,
      })
    : input.projection;
  return buildMaterializedDocumentSyncPlan({
    author: input.sync.author,
    buildRotationSnapshot: input.sync.buildRotationSnapshot,
    containerRekeys: rekeyPlans?.map(({ plan }) => plan.request),
    execSql: input.sync.execSql,
    historyMode: input.sync.historyMode,
    localVersionVector: input.sync.localVersionVector,
    minLsn: input.minLsn,
    onSyncTrace: input.sync.onSyncTrace,
    pendingUpdates: input.pendingUpdates,
    persistVerificationCheckpoints: rekeyPlans?.length ? false : undefined,
    pullCursor: input.pullCursor,
    regenerateQueuedCheckpoints: input.regenerateQueuedCheckpoints,
    signedAt: input.sync.signedAt,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection,
    ...projectionVerificationOptions(input.sync),
  });
}
