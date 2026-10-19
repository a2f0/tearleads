import { expect, test } from "bun:test";
import {
  createPrincipalReciteFixture,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import { containerWriterProjectionFromSharePlan } from "../../containers/child/rekey/rekeyProjection";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";

test("grant projections preserve key epochs and require the authored predecessor", async () => {
  const f = await createPrincipalReciteFixture({
    databaseName: "grant-projection",
    rotateKey: false,
  });
  try {
    const previousProjection =
      await f.input.apiClient.getContainerWriterProjection(ROOT_CONTAINER_ID);
    if (!previousProjection) throw new Error("Missing previous projection");
    const prepared = await preparePrincipalContainerRematerializationBatch(
      f.input,
    );
    const plan = prepared.plans[0]?.plan;
    if (!plan || "keyring" in plan) throw new Error("Expected grant plan");
    const next = await containerWriterProjectionFromSharePlan({
      plan,
      previousProjection,
    });
    expect(next.path.at(-1)?.manifestHash).toBe(plan.manifestHash);
    expect(next.containerKeks.at(-1)?.containerKeyEpochId).toBe(
      previousProjection.containerKeks.at(-1)?.containerKeyEpochId,
    );
    expect(next.containerKeks.at(-1)?.wraps).toEqual(
      plan.wraps.map((wrap) => ({ ...wrap })),
    );
    expect(previousProjection.path.at(-1)?.manifestHash).toBe(
      plan.previousManifest.manifestHash,
    );
    await expect(
      containerWriterProjectionFromSharePlan({
        plan,
        previousProjection: next,
      }),
    ).rejects.toThrow("Container grant projection predecessor mismatch");
  } finally {
    f.database.close();
  }
});
