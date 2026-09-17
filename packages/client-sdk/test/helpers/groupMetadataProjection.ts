import { createTestExecSql } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { buildMaterializedContainerCreatePlan } from "../../src/workflows/containers/child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../../src/workflows/containers/child/createProjection";
import {
  type createParentProjection,
  createParentProjectionUserKeyResolver,
} from "./containerFixtures";
import { testGroupMetadataKey } from "./groupMetadata";

export async function createTestGroupMetadataProjection(
  parent: Awaited<ReturnType<typeof createParentProjection>>,
  resolveProjectionUserKey = createParentProjectionUserKeyResolver(parent),
) {
  const key = testGroupMetadataKey(parent.author.organizationId);
  const database = await createTestExecSql("group-metadata-projection-fixture");
  const materializedPlan = await buildMaterializedContainerCreatePlan({
    execSql: database.execSql,
    author: parent.author,
    containerId: key.containerId,
    containerKey: key.keyMaterial,
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    resolveProjectionUserKey,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: key.organizationId,
    }),
  }).finally(() => database.close());
  return {
    key: {
      ...key,
      containerKeyEpochId: materializedPlan.plan.containerKeyEpochId,
    },
    projection: childContainerWriterProjectionFromCreatePlan({
      materializedPlan,
      parentProjection: parent.projection,
    }),
  };
}
