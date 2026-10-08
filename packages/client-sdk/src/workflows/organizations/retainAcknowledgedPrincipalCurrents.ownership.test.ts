import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { retainPrincipalHistoryRoot } from "../../data/persistence/principalHistoryRootOwnership";
import { principalHistoryRootOwners } from "../../data/sqlite/principalHistoryNodeRetentionSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test.each([false, true])(
  "acknowledgement replaces predecessor ownership only when its stage is incomplete: complete=%s",
  async (complete) => {
    const f = await currentPolicyPublicationFixture(history);
    try {
      const stages = await f.db.select().from(principalHistoryStages);
      const stage = stages.find(
        (row) =>
          JSON.parse(row.currentJson).currentState.principalId ===
          history.group.currentState.principalId,
      );
      if (!stage) throw new Error("Missing predecessor stage");
      const selected = eq(principalHistoryRootOwners.id, `stage:${stage.id}`);
      const [owner] = await f.db
        .select()
        .from(principalHistoryRootOwners)
        .where(selected);
      if (!owner) throw new Error("Missing predecessor root owner");
      // Distinct disposable metadata makes a rejected owner rewrite observable.
      const savedOwner = { ...owner, rootHash: "existing-stage-root" };
      const runtime = getClientSQLitePersistenceRuntime(f.options.execSql);
      await runtime.transaction(async (tx) => {
        await tx
          .update(principalHistoryStages)
          .set({ complete })
          .where(eq(principalHistoryStages.id, stage.id))
          .run();
        await retainPrincipalHistoryRoot(tx, savedOwner);
      });
      await retainAcknowledgedPrincipalCurrents(f.publication);
      expect(
        await f.db.select().from(principalHistoryRootOwners).where(selected),
      ).toEqual([complete ? savedOwner : owner]);
      const [saved] = await f.db
        .select()
        .from(principalHistoryStages)
        .where(eq(principalHistoryStages.id, stage.id));
      expect(saved?.complete).toBe(true);
      if (complete) expect(saved).toEqual(stage);
    } finally {
      f.close();
    }
  },
  15_000,
);
