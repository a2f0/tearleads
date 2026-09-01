import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
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

test("create intent settlement reports overtaking and generation races", async () => {
  const { close, execSql } = await createTestExecSql(
    "create-intent-settlement-races",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'container-1', 'root', 'container.create',
        'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    const settlement = {
      containerId: "container-1",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      remoteContainerId: "container-1",
      remoteMetadataAccessStateHash: "access-state-1",
      remoteMetadataDocumentId: "metadata-1",
    };

    expect(
      await sqlContainerContentsPersistence.markCreateIntentSynced(execSql, {
        ...settlement,
        expectedUpdatedAt: "stale-intent-version",
        stillCurrent: () => true,
      }),
    ).toBe(false);
    expect(
      await sqlContainerContentsPersistence.markCreateIntentSynced(execSql, {
        ...settlement,
        stillCurrent: () => false,
      }),
    ).toBe(false);
    expect(
      await sqlContainerContentsPersistence.markCreateIntentSynced(execSql, {
        ...settlement,
        stillCurrent: () => true,
      }),
    ).toBe(true);
    expect(
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql),
    ).toEqual([]);
  } finally {
    close();
  }
});
