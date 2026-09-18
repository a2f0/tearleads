import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "./create";
import { buildMaterializedContainerRekeyPlan } from "./rekey";

export async function createRotatedAncestorFixture() {
  const root = await createParentProjection();
  const database = await createTestExecSql("ancestor-rotation-author");
  const input = {
    author: root.author,
    execSql: database.execSql,
    persistVerificationCheckpoints: false,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(root),
    targetSecretKey: root.secretKey,
  };
  const createChild = async (
    parentProjection: ContainerWriterProjectionResponse,
    containerId: string,
  ) => {
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      ...input,
      containerId,
      parentProjection,
      parentSecretKey: root.secretKey,
    });
    return {
      key: materializedPlan.containerKey,
      epochId: materializedPlan.plan.containerKeyEpochId,
      projection: childContainerWriterProjectionFromCreatePlan({
        materializedPlan,
        parentProjection,
      }),
    };
  };
  try {
    const child = await createChild(root.projection, "child");
    const grandchild = await createChild(child.projection, "grandchild");
    const rotatedRoot = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: root.projection,
    });
    const projection = {
      ...grandchild.projection,
      path: [
        ...rotatedRoot.writerProjection.path,
        ...grandchild.projection.path.slice(1),
      ],
      containerKeks: [
        ...rotatedRoot.writerProjection.containerKeks,
        ...grandchild.projection.containerKeks.slice(1),
      ],
    };
    return { child, grandchild, input, projection, root };
  } finally {
    database.close();
  }
}
