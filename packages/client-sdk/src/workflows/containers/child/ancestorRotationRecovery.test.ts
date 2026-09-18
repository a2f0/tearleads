import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "./create";
import { buildMaterializedContainerRekeyPlan } from "./rekey";

async function createRotatedAncestorFixture() {
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

test("cold verified reads recover descendants after ancestor rotation and permit repair", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("ancestor-rotation-cold-reader");
  const input = { ...fixture.input, execSql: database.execSql };
  try {
    const recovered = await unwrapContainerKekPath({
      ...input,
      projection: fixture.projection,
      secretKey: fixture.root.secretKey,
    });
    expect(recovered.get(fixture.child.epochId)).toEqual(fixture.child.key);
    expect(recovered.get(fixture.grandchild.epochId)).toEqual(
      fixture.grandchild.key,
    );

    const repairedChild = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: {
        ...fixture.projection,
        containerId: fixture.child.projection.containerId,
        path: fixture.projection.path.slice(0, 2),
        containerKeks: fixture.projection.containerKeks.slice(0, 2),
      },
    });
    const repairedProjection = {
      ...fixture.projection,
      path: [
        ...repairedChild.writerProjection.path,
        ...fixture.projection.path.slice(2),
      ],
      containerKeks: [
        ...repairedChild.writerProjection.containerKeks,
        ...fixture.projection.containerKeks.slice(2),
      ],
    };
    // Reconstructing a non-root historical epoch also requires its original
    // signed parent citation. No trustedLocalProjection shortcut is used.
    const recoveredAgain = await unwrapContainerKekPath({
      ...input,
      projection: repairedProjection,
      secretKey: fixture.root.secretKey,
    });
    expect(recoveredAgain.get(fixture.grandchild.epochId)).toEqual(
      fixture.grandchild.key,
    );
    const repairedGrandchild = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: repairedProjection,
    });
    expect(repairedGrandchild.plan.keyEpoch.parentContainerKeyEpochId).toBe(
      repairedChild.plan.containerKeyEpochId,
    );
  } finally {
    database.close();
  }
});

test.each(["missing-history", "wrong-parent-pin", "forged-history"] as const)(
  "ancestor recovery rejects %s",
  async (tampering) => {
    const fixture = await createRotatedAncestorFixture();
    const projection = structuredClone(fixture.projection);
    const [root, child] = projection.containerKeks;
    const history = root?.containerManifestHistory[0];
    if (!root || !child || !history)
      throw new Error("Expected ancestor history");
    if (tampering === "missing-history") root.containerManifestHistory = [];
    if (tampering === "wrong-parent-pin") {
      child.keyEpoch = {
        ...child.keyEpoch,
        parentContainerKeyEpochId: child.containerKeyEpochId,
      };
    }
    if (tampering === "forged-history") {
      history.state = {
        ...history.state,
        containerKeyEpochId: child.containerKeyEpochId,
      };
    }
    const database = await createTestExecSql(`ancestor-rotation-${tampering}`);
    try {
      await expect(
        unwrapContainerKekPath({
          ...fixture.input,
          execSql: database.execSql,
          projection,
          secretKey: fixture.root.secretKey,
        }),
      ).rejects.toThrow();
    } finally {
      database.close();
    }
  },
);
