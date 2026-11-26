import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { createDocuments } from "./index";

function offlineDocuments(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  dbStatus: "ready" | "idle" = "ready",
) {
  const workflowInput = createWorkflowInputFixture({
    apiClient: createMockApiClient(),
    auth: { isAuthenticated: true },
    blobStore: createMemoryBlobStore(),
    containerId: "root",
    dbStatus,
    execSql,
    online: false,
  });
  return createDocuments({
    getDefaultContainerId: () => "root",
    runtime: createInternalRuntimeFixture(() => workflowInput),
  });
}

test("openHistory replays a document edited through its store", async () => {
  const { close, execSql } = await createTestExecSql("client-document-history");
  try {
    const documents = offlineDocuments(execSql);
    const note = documents.open({ localId: "history-note" });
    await note.setText("first");
    await note.setText("first and second");

    const history = await documents.openHistory("history-note");
    if (!history) throw new Error("expected document history");
    try {
      const last = history.stops.length - 1;
      expect(history.viewAt(last).text).toBe("first and second");
      expect(history.viewAt(-1).text).toBe("");
      expect(history.stops.every((stop) => stop.committedAt !== null)).toBe(
        true,
      );
      // The store keeps working: history never touches the live document.
      await note.setText("first, second, and third");
      expect(note.getSnapshot().text).toBe("first, second, and third");
    } finally {
      history.close();
    }

    expect(await documents.openHistory("no-such-document")).toBeNull();
  } finally {
    close();
  }
});

test("openHistory waits for a ready database", async () => {
  const { close, execSql } = await createTestExecSql(
    "client-document-history-loading",
  );
  try {
    expect(
      await offlineDocuments(execSql, "idle").openHistory("history-note"),
    ).toBeNull();
  } finally {
    close();
  }
});

// Verification's outcomes are statuses, so only a database that is not ready
// resolves to null.
test("verifyHistory reports why it could not check instead of throwing", async () => {
  const { close, execSql } = await createTestExecSql(
    "client-document-history-verify",
  );
  try {
    const documents = offlineDocuments(execSql);
    const note = documents.open({ localId: "history-note" });
    await note.setText("never uploaded");

    expect(await documents.verifyHistory("history-note")).toEqual({
      reason: "not_synced",
      status: "unavailable",
    });
    expect(
      await offlineDocuments(execSql, "idle").verifyHistory("history-note"),
    ).toBeNull();
    expect(note.getSnapshot().text).toBe("never uploaded");
  } finally {
    close();
  }
});

test("open passes createIfMissing through to the store", async () => {
  const { close, execSql } = await createTestExecSql("client-open-no-create");
  try {
    const documents = offlineDocuments(execSql);
    const reader = documents.open(
      { localId: "listed-note" },
      { createIfMissing: false },
    );
    expect(await reader.ensureInitialized()).toBe(false);

    const creator = documents.open({ localId: "listed-note" });
    expect(creator).toBe(reader);
    expect(await creator.ensureInitialized()).toBe(true);
  } finally {
    close();
  }
});
