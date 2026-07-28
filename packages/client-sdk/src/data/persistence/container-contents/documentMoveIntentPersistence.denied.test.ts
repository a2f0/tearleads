import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
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
