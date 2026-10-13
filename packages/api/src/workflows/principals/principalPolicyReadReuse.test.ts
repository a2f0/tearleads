import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
  principalStatePayloads,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";

for (const artifact of ["members", "grants", "payload"] as const) {
  test(`verified policy reuse rechecks ${artifact} on the next call in the same transaction`, async () => {
    const { head } = await principalHistoryPreparationFixture({
      versions: 1,
      currentArtifacts: true,
    });
    await db.transaction(async (tx) => {
      const state = await getCurrentPrincipalState(
        "group",
        head.principalId,
        tx,
      );
      if (!state) throw new Error("Missing policy fixture");
      const read = () =>
        getVerifiedPrincipalPolicyForStateWithExecutor(tx, state, [head]);
      expect((await read()).policy.stateHash).toBe(head.stateHash);
      expect((await read()).policy.stateHash).toBe(head.stateHash);
      if (artifact === "members") {
        await tx
          .update(principalMembershipProjection)
          .set({ role: "member" })
          .where(
            eq(principalMembershipProjection.principalId, head.principalId),
          );
      } else if (artifact === "grants") {
        await tx.insert(principalContainerGrantProjection).values({
          principalType: "group",
          principalId: head.principalId,
          stateHash: head.stateHash,
          containerId: crypto.randomUUID(),
          accessLevel: "admin",
        });
      } else {
        await tx
          .update(principalStatePayloads)
          .set({ ciphertext: "tampered" })
          .where(eq(principalStatePayloads.principalId, head.principalId));
      }
      await expect(read()).rejects.toMatchObject({ status: 409 });
    });
  });
}
