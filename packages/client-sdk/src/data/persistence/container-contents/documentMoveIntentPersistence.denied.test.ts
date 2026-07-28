import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentProjectionTables } from "../../sqlite/schema";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { sqlDocumentMoveIntentPersistence as persistence } from "./documentMoveIntentPersistence";

// Row 7's parked lifecycle: denied intents leave the routine replay set,
// count as access-restored evidence, and flip back to pending on reset.
test("denied document move intents park and reset", async () => {
  const { close, execSql } = await createTestExecSql("document-move-denied");
  try {
    await persistence.ensureSchema(execSql);
    await persistence.enqueueMoveIntent(execSql, {
      documentId: "remote-a",
      localId: "doc-a",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "to",
    });
    await persistence.enqueueMoveIntent(execSql, {
      documentId: "remote-b",
      localId: "doc-b",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "to",
    });

    await persistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "remote-a",
      message: "Remote document move was rejected or unavailable: (403)",
    });

    // Parked: out of the routine replay list, but recorded as evidence.
    expect(
      (await persistence.listPendingMoveIntents(execSql)).map(
        (intent) => intent.documentId,
      ),
    ).toEqual(["remote-b"]);
    expect(await persistence.hasDeniedMoveIntents(execSql)).toBe(true);

    // A scoped reset (manual retry) touches only that document's intent.
    await persistence.resetDeniedMoveIntents(execSql, { localId: "doc-b" });
    expect(await persistence.hasDeniedMoveIntents(execSql)).toBe(true);
    await persistence.resetDeniedMoveIntents(execSql, { localId: "doc-a" });
    expect(await persistence.hasDeniedMoveIntents(execSql)).toBe(false);
    expect(
      (await persistence.listPendingMoveIntents(execSql))
        .map((intent) => intent.documentId)
        .sort(),
    ).toEqual(["remote-a", "remote-b"]);

    // The global reset (access restored) covers every parked intent.
    await persistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "remote-a",
      message: "denied again",
    });
    await persistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "remote-b",
      message: "denied again",
    });
    expect(await persistence.listPendingMoveIntents(execSql)).toEqual([]);
    await persistence.resetDeniedMoveIntents(execSql);
    expect(await persistence.listPendingMoveIntents(execSql)).toHaveLength(2);
  } finally {
    await close();
  }
});

// A stale in-flight failure must not park a re-enqueued move: the error
// records only against the intent revision the pass actually read.
test("a stale denial cannot park a re-enqueued move", async () => {
  const { close, execSql } = await createTestExecSql("document-move-stale");
  try {
    await persistence.ensureSchema(execSql);
    await persistence.enqueueMoveIntent(execSql, {
      documentId: "remote-a",
      localId: "doc-a",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "to",
    });
    const [before] = await persistence.listPendingMoveIntents(execSql);
    if (!before) {
      throw new Error("expected enqueued intent");
    }

    // The user re-enqueues (new revision) while the old pass is in flight.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await persistence.enqueueMoveIntent(execSql, {
      documentId: "remote-a",
      localId: "doc-a",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "elsewhere",
    });

    await persistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "remote-a",
      expectedUpdatedAt: before.updatedAt,
      message: "stale 403",
    });

    const [after] = await persistence.listPendingMoveIntents(execSql);
    expect(after).toMatchObject({
      syncStatus: "pending",
      targetContainerId: "elsewhere",
    });
    expect(await persistence.hasDeniedMoveIntents(execSql)).toBe(false);
  } finally {
    await close();
  }
});

// Restoring one organization's access must not un-park moves that another
// organization still denies.
test("denied reset and evidence scope per organization", async () => {
  const { close, execSql } = await createTestExecSql("document-move-orgs");
  try {
    await persistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, documentProjectionTables);
    for (const [doc, local, org] of [
      ["remote-a", "doc-a", "org-a"],
      ["remote-b", "doc-b", "org-b"],
    ] as const) {
      await persistence.enqueueMoveIntent(execSql, {
        documentId: doc,
        localId: local,
        replaceLinkedContainers: false,
        sourceContainerId: "from",
        targetContainerId: "to",
      });
      await execSql(
        `INSERT INTO document_projection (
          local_id, document_id, container_id, organization_id, document_kind,
          title, updated_at
        ) VALUES (?, ?, ?, ?, 'note', ?, ?)`,
        [local, doc, "container", org, local, "2026-01-01T00:00:00.000Z"],
      );
      await persistence.recordMoveIntentError(execSql, {
        denied: true,
        documentId: doc,
        message: "denied",
      });
    }

    expect(
      await persistence.hasDeniedMoveIntents(execSql, {
        organizationId: "org-a",
      }),
    ).toBe(true);

    await persistence.resetDeniedMoveIntents(execSql, {
      organizationId: "org-a",
    });

    // org-a replays; org-b stays parked and keeps its evidence.
    expect(
      (await persistence.listPendingMoveIntents(execSql)).map(
        (intent) => intent.documentId,
      ),
    ).toEqual(["remote-a"]);
    expect(
      await persistence.hasDeniedMoveIntents(execSql, {
        organizationId: "org-b",
      }),
    ).toBe(true);
    expect(
      await persistence.hasDeniedMoveIntents(execSql, {
        organizationId: "org-a",
      }),
    ).toBe(false);
  } finally {
    await close();
  }
});
