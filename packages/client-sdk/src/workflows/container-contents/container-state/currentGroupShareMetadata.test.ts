import { expect, test } from "bun:test";
import { createCurrentShareMetadataFixture } from "../../../../test/helpers/currentShareMetadata";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { resolveCurrentGroupKeyEpoch } from "./groupShareEpoch";

for (const correctName of [true, false]) {
  test(`current share epoch binds the ${correctName ? "correct" : "wrong"} name through runtime metadata verification`, async () => {
    const f = await createCurrentShareMetadataFixture();
    try {
      const epoch = resolveCurrentGroupKeyEpoch({
        expectedGroupName: correctName ? f.name : "Another group",
        groupId: f.group.currentState.principalId,
        organizationId: f.organizationId,
        runtime: f.runtime,
      });
      if (correctName) expect(await epoch).toBe(f.group.currentState.keyEpoch);
      else {
        await expect(epoch).rejects.toMatchObject({ code: "object_mismatch" });
        expect(
          await loadPrincipalPolicyCheckpoint(
            f.options.execSql,
            "group",
            f.group.currentState.principalId,
          ),
        ).toBeNull();
      }
      expect(f.metadataReads()).toBeGreaterThan(0);
      expect(f.fullReads()).toBe(0);
    } finally {
      f.close();
    }
  }, 15_000);
}

test("current share epoch rejects corrupt signed metadata evidence", async () => {
  const f = await createCurrentShareMetadataFixture();
  try {
    const entry = f.projection.path[0];
    if (!entry) throw new Error("Missing signed metadata root");
    entry.event.eventHash = "f".repeat(64);
    await expect(
      resolveCurrentGroupKeyEpoch({
        expectedGroupName: f.name,
        groupId: f.group.currentState.principalId,
        organizationId: f.organizationId,
        runtime: f.runtime,
      }),
    ).rejects.toThrow();
    expect(f.metadataReads()).toBeGreaterThan(0);
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
}, 15_000);
