import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { exportFullHistorySnapshot, getTextValue } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { DOCUMENT_HISTORY_COMPACTION_MAX_ROWS } from "../../../data/sqlite/documentHistoryPersistence";
import type { DocumentsRuntime } from "../types";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import { pendingDeltaSinceBase, persistDocument } from "./persistence";
import { createDocumentStoreState, type DocumentStoreState } from "./state";

const ignoredPersistenceEffects = {
  emitPersistedDocument: () => undefined,
  registerDocumentIdentity: () => undefined,
};

// Offline runtime: history durability is a purely local property, so these
// tests never touch the network (the store's sync preconditions all fail).
function offlineRuntime(execSql: DocumentsRuntime["infra"]["execSql"]) {
  return {
    apiClient: {} as DocumentsRuntime["apiClient"],
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: null as never,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container",
      domainScope: createDomainScope(),
      events: [],
      online: false,
      peerScope: null,
    },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
}

async function openStore(
  execSql: DocumentsRuntime["infra"]["execSql"],
  localId: string,
  initialText = "",
): Promise<DocumentStoreState> {
  const state = createDocumentStoreState(
    localId,
    offlineRuntime(execSql),
    sqlDocumentsPersistence,
    ignoredPersistenceEffects,
    null,
    initialText,
  );
  expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
  return state;
}

test("a document created offline is fully durable from birth", async () => {
  const { close, execSql } = await createTestExecSql("history-birth");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    // Creation is the ONLY persist this document sees before the "restart".
    await openStore(execSql, "born-offline", "created and closed");

    const reopened = await openStore(execSql, "born-offline");
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("created and closed");
    expect(() => {
      if (!reopened.doc) throw new Error("expected restored doc");
      exportFullHistorySnapshot(reopened.doc);
    }).not.toThrow();
  } finally {
    close();
  }
});

test("compaction deletes only the tail rows captured before its export", async () => {
  const { close, execSql } = await createTestExecSql("history-covered-ids");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      localId: "raced-doc",
      updates: ["covered-row"],
    });
    const coveredTailIds =
      (await sqlDocumentsPersistence.listHistoryTailIds?.(
        execSql,
        "raced-doc",
      )) ?? [];
    // A concurrent append lands after the capture (and after the export it
    // models); the replacement must leave it for the next compaction.
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      localId: "raced-doc",
      updates: ["late-row"],
    });
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds,
      localId: "raced-doc",
      snapshot: "checkpoint",
    });

    const tail = await sqlDocumentsPersistence.readHistoryTailSize?.(
      execSql,
      "raced-doc",
    );
    expect(tail).toMatchObject({ hasCheckpoint: true, rowCount: 1 });
  } finally {
    close();
  }
});

test("full history survives a restart via the checkpoint and tail", async () => {
  const { close, execSql } = await createTestExecSql("history-durability");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const first = await openStore(execSql, "history-doc");
    await setDocumentText(first, () => undefined, "first line");
    await setDocumentText(first, () => undefined, "first line and more");

    const reopened = await openStore(execSql, "history-doc");
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("first line and more");
    // The whole point: a restarted device can still export the full-history
    // baselines that heals, rotations, and unlinks require.
    expect(() => {
      if (!reopened.doc) throw new Error("expected restored doc");
      exportFullHistorySnapshot(reopened.doc);
    }).not.toThrow();
  } finally {
    close();
  }
});

test("the tail compacts into a fresh checkpoint past the row threshold", async () => {
  const { close, execSql } = await createTestExecSql("history-compaction");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(execSql, "compaction-doc");
    await setDocumentText(state, () => undefined, "seed");

    // Inflate the tail past the threshold; the rows only need to exist (a
    // compaction clears them from the live doc's export without replaying
    // them), so opaque filler is fine here.
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      localId: "compaction-doc",
      updates: Array.from(
        { length: DOCUMENT_HISTORY_COMPACTION_MAX_ROWS },
        (_, index) => `filler-${index}`,
      ),
    });
    if (!state.doc) throw new Error("expected live doc");
    await persistDocument(state, state.doc);

    const tail = await sqlDocumentsPersistence.readHistoryTailSize?.(
      execSql,
      "compaction-doc",
    );
    expect(tail).toMatchObject({ hasCheckpoint: true, rowCount: 0 });
  } finally {
    close();
  }
});

test("a legacy shallow-only row keeps its behavior and a deferred edit wins over the checkpoint", async () => {
  const { close, execSql } = await createTestExecSql("history-fallbacks");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    // Deferred-edit safety valve: persist a snapshot AHEAD of the durable
    // queue/tail (deferRemoteSync shape). The restore must prefer the shallow
    // snapshot over the (lagging) checkpoint+tail — losing the deferred edit
    // would drop user data.
    const state = await openStore(execSql, "deferred-doc");
    await setDocumentText(state, () => undefined, "enqueued edit");
    if (!state.doc) throw new Error("expected live doc");
    state.doc.getText("text").update("enqueued edit plus deferred");
    state.doc.commit();
    await persistDocument(state, state.doc);

    const reopened = await openStore(execSql, "deferred-doc");
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("enqueued edit plus deferred");
  } finally {
    close();
  }
});

test("a deferred write covered by the tail restores with full history", async () => {
  const { close, execSql } = await createTestExecSql("history-deferred-tail");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(execSql, "deferred-covered-doc");
    await setDocumentText(state, () => undefined, "enqueued edit");
    if (!state.doc) throw new Error("expected live doc");

    // The deferRemoteSync shape: mutate, append the delta to the history
    // tail, persist — but never enqueue or advance the marker (the op is
    // re-derived by the next edit).
    state.doc.getText("text").update("enqueued edit plus deferred");
    state.doc.commit();
    const deferredDelta = pendingDeltaSinceBase(state, state.doc);
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      localId: "deferred-covered-doc",
      updates: [bytesToBase64(deferredDelta)],
    });
    await persistDocument(state, state.doc);

    const reopened = await openStore(execSql, "deferred-covered-doc");
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("enqueued edit plus deferred");
    // Because the tail covers the deferred delta, the restore keeps full
    // history instead of falling back to the shallow snapshot.
    expect(() => {
      if (!reopened.doc) throw new Error("expected restored doc");
      exportFullHistorySnapshot(reopened.doc);
    }).not.toThrow();
  } finally {
    close();
  }
});

test("deleting a document deletes its history checkpoint and tail", async () => {
  const { close, execSql } = await createTestExecSql("history-delete");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(execSql, "deleted-doc");
    await setDocumentText(state, () => undefined, "short lived");
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState?.(
        execSql,
        "deleted-doc",
      ),
    ).not.toBeNull();

    await sqlDocumentsPersistence.deleteDocument(execSql, "deleted-doc");
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState?.(
        execSql,
        "deleted-doc",
      ),
    ).toBeNull();
  } finally {
    close();
  }
});
