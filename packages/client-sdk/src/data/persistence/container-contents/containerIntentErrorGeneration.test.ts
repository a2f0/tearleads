import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

for (const intentType of ["create", "move"] as const) {
  test(`${intentType} intent errors roll back after generation expiry`, async () => {
    const database = await createTestExecSql(
      `container-${intentType}-intent-error-generation`,
    );
    let transactionStarted = false;
    const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
      const rows = await database.execSql(...args);
      if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
        transactionStarted = true;
      }
      return rows;
    }) as ExecSql;

    try {
      await sqlContainerContentsPersistence.ensureSchema(database.execSql);
      if (intentType === "create") {
        await database.execSql(
          `INSERT INTO container_create_intents (
            id, container_id, parent_container_id, intent_type, sync_status,
            created_at, updated_at
          ) VALUES ('intent-1', 'container-1', 'root', 'container.create',
            'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        );
        await sqlContainerContentsPersistence.recordCreateIntentRevisionError(
          guardedExecSql,
          {
            containerId: "container-1",
            expectedIntentId: "intent-1",
            expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
            message: "stale create failure",
            stillCurrent: () => !transactionStarted,
          },
        );
        const [intent] =
          await sqlContainerContentsPersistence.listPendingCreateIntents(
            database.execSql,
          );
        expect(intent).toMatchObject({
          lastAttemptedAt: null,
          lastError: null,
          syncStatus: "pending",
        });
      } else {
        await database.execSql(
          `INSERT INTO container_move_intents (
            id, container_id, parent_container_id, previous_parent_container_id,
            intent_type, sync_status, created_at, updated_at
          ) VALUES ('intent-1', 'container-1', 'next-parent', 'old-parent',
            'container.move', 'pending', '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z')`,
        );
        await sqlContainerContentsPersistence.recordMoveIntentError(
          guardedExecSql,
          {
            blocked: true,
            containerId: "container-1",
            expectedIntentId: "intent-1",
            expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
            message: "stale move failure",
            stillCurrent: () => !transactionStarted,
          },
        );
        const [intent] =
          await sqlContainerContentsPersistence.listUnsyncedMoveIntents(
            database.execSql,
          );
        expect(intent).toMatchObject({
          lastAttemptedAt: null,
          lastError: null,
          syncStatus: "pending",
        });
      }
      expect(transactionStarted).toBe(true);
    } finally {
      database.close();
    }
  });
}
