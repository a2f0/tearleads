import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";

test("a warm full-policy response rejects replaced historical signature bytes", async () => {
  const { head } = await principalHistoryPreparationFixture({
    versions: 3,
    currentArtifacts: true,
  });
  const state = await getCurrentPrincipalState("group", head.principalId, db);
  if (!state) throw new Error("Missing current fixture");
  expect(
    (await getPrincipalPolicyForStateWithExecutor(db, state)).previousStates,
  ).toHaveLength(2);
  await db
    .update(principalStates)
    .set({ signature: head.signature })
    .where(
      and(
        eq(principalStates.principalId, head.principalId),
        eq(principalStates.version, 1),
      ),
    );
  await expect(
    getPrincipalPolicyForStateWithExecutor(db, state),
  ).rejects.toMatchObject({
    status: 409,
  });
});
