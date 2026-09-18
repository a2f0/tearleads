import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { buildMaterializedDocumentCreatePlan } from "../../documents/create";
import { createRotatedAncestorFixture } from "./ancestorRotationRecovery.testFixtures";
import { buildMaterializedContainerRekeyPlan } from "./rekey";

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

test("a recovery projection cannot wrap a new document key through stale ancestor epochs", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("ancestor-stale-document-write");
  try {
    await expect(
      buildMaterializedDocumentCreatePlan({
        ...fixture.input,
        execSql: database.execSql,
        containerProjection: fixture.projection,
      }),
    ).rejects.toThrow("ancestor KEK repair");
  } finally {
    database.close();
  }
});
