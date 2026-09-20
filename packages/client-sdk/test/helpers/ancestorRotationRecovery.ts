import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/child/create";
import { buildMaterializedContainerRekeyPlan } from "../../src/workflows/containers/child/rekey";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "./containerFixtures";

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

/**
 * A chain deep enough that repairing it exceeds `MAX_INLINE_CONTAINER_REKEYS`,
 * so the standalone prefix path runs. Rotating the root staled the first edge;
 * each repair mints a new epoch and stales the next, so the whole chain needs
 * repairing one level at a time.
 */
export async function createDeepRotatedAncestorFixture(depth: number) {
  const root = await createParentProjection();
  const database = await createTestExecSql("deep-ancestor-rotation-author");
  const input = {
    author: root.author,
    execSql: database.execSql,
    persistVerificationCheckpoints: false,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(root),
    targetSecretKey: root.secretKey,
  };
  try {
    let parent = root.projection;
    const descendants: ContainerWriterProjectionResponse[] = [];
    for (let level = 0; level < depth; level += 1) {
      const materializedPlan = await buildMaterializedContainerCreatePlan({
        ...input,
        containerId: `descendant-${level}`,
        parentProjection: parent,
        parentSecretKey: root.secretKey,
      });
      parent = childContainerWriterProjectionFromCreatePlan({
        materializedPlan,
        parentProjection: parent,
      });
      descendants.push(parent);
    }
    const leaf = parent;
    const rotatedRoot = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: root.projection,
    });
    const projection = {
      ...leaf,
      path: [...rotatedRoot.writerProjection.path, ...leaf.path.slice(1)],
      containerKeks: [
        ...rotatedRoot.writerProjection.containerKeks,
        ...leaf.containerKeks.slice(1),
      ],
    };
    return { descendants, input, leaf, projection, root };
  } finally {
    database.close();
  }
}
