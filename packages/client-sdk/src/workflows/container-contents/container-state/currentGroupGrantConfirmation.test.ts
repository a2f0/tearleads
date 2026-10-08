import { expect, test } from "bun:test";
import { createCurrentGrantConfirmationFixture } from "../../../../test/helpers/currentGrantConfirmation";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createTestContainerState } from "./containerState.testFixtures";
import { containerStateHasCurrentGroupGrant } from "./groupGrantVerification";

for (const corrupt of [false, true]) {
  test(`current group grant confirmation ${corrupt ? "rejects corrupt" : "accepts signed"} container evidence`, async () => {
    const f = await createCurrentGrantConfirmationFixture();
    try {
      const target = f.projection.path.at(-1);
      if (!target) throw new Error("Missing root manifest");
      if (corrupt) target.event.eventHash = "f".repeat(64);
      const result = containerStateHasCurrentGroupGrant({
        accessLevel: "admin",
        containerState: createTestContainerState({
          id: f.containerId,
          organizationId: f.author.organizationId,
          parentId: null,
        }),
        expectedContainerId: f.containerId,
        expectedGroupHead: principalPolicyHead(f.admin),
        expectedOrganizationId: f.author.organizationId,
        groupId: f.admin.currentState.principalId,
        resolveProjectionUserKey: f.resolveUser,
        runtime: f.runtime,
      });
      if (corrupt)
        await expect(result).rejects.toMatchObject({ code: "hash_mismatch" });
      else expect(await result).toBe(true);
      expect(f.fullReads()).toBe(0);
    } finally {
      f.close();
    }
  });
}
