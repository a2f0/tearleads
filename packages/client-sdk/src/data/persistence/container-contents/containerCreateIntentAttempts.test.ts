import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

// A create stuck in error must show WHEN it last failed, like the move
// intent twin: the recorder stamps last_attempted_at alongside the message.
test("recording a create intent error stamps the attempt time", async () => {
  const { close, execSql } = await createTestExecSql("create-intent-attempts");
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'container-1', 'root', 'container.create',
        'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    const [before] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    expect(before?.lastAttemptedAt).toBeNull();

    await sqlContainerContentsPersistence.recordCreateIntentError(
      execSql,
      "container-1",
      "create refused",
    );

    const [after] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    expect(after?.lastError).toBe("create refused");
    expect(after?.lastAttemptedAt).toBe(after?.updatedAt ?? "");
    expect(after?.lastAttemptedAt).not.toBeNull();
  } finally {
    close();
  }
});
