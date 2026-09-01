import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import { rekeyUnsettledRecoveryPendingUpdates } from "./syncRecoveryRekey";

test("expired recovery cannot re-key after waiting for the SQL lock", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-recovery-rekey-generation",
  );
  try {
    let current = true;
    let releaseLock = () => {};
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = runSerializedSqlMutation(execSql, () => lockHeld);
    const rekeyedInputIds: string[] = [];
    const recovery = rekeyUnsettledRecoveryPendingUpdates({
      execSql,
      recoveryPendingUpdatesById: new Map([
        [
          "stale-update",
          {
            id: "stale-update",
            partialEndVersionVector: "end",
            partialStartVersionVector: "start",
            updateData: "data",
          },
        ],
      ]),
      rekeyPendingUpdate: async (_lockedExecSql, id) => {
        rekeyedInputIds.push(id);
        return `next-${id}`;
      },
      settledPendingUpdateIds: [],
      stillCurrent: () => current,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    current = false;
    releaseLock();
    await Promise.all([blocker, recovery]);

    expect(await recovery).toEqual({
      exhaustedPendingUpdateIds: [],
      rekeyedPendingUpdateIds: [],
    });
    expect(rekeyedInputIds).toEqual([]);
  } finally {
    close();
  }
});
