import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../../../test/helpers/data/waitFor";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { Tearleads } from "../../../../Tearleads";
import type {
  DocumentsPersistence,
  ExecSql,
} from "../../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { restoreDocumentStoreContent } from "../history/restoreContent";
import { ensureDocumentStoreReady } from "../initialization";
import { setDocumentText } from "../mutations";
import { addRowToDocumentStore } from "../rows";
import {
  createDocumentStoreState,
  type DocumentStoreState,
  resetDocumentStore,
} from "../state";
import { removeAttachmentFromDocumentStore } from "./attachmentRemoval";
import {
  attachFilesToDocumentStore,
  replaceAttachmentInDocumentStore,
} from "./index";

const busyRefusal = () =>
  new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

async function createStoreFixture(
  name: string,
  options: {
    readonly deferInitialUpdate?: boolean;
    readonly initialize?: boolean;
  } = {},
) {
  const database = await createTestExecSql(name);
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: {
      log: (message) => logged.push(message),
      logError: (_message, error) => reported.push(error),
    },
  });
  await sqlDocumentsPersistence.ensureSchema(database.execSql);
  const runtime = sdk.documents.workflowRuntime();
  const state = createDocumentStoreState(
    "busy-write-doc",
    {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
      },
      infra: { ...runtime.infra, dbStatus: "ready", execSql: database.execSql },
      state: { ...runtime.state, online: false },
      util: {
        ...runtime.util,
        log: (message) => logged.push(message),
        logError: (_message, error) => reported.push(error),
      },
    },
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
    options.deferInitialUpdate ? "deferred birth content" : "",
  );
  if (options.deferInitialUpdate) {
    state.deferInitialUpdate = true;
  }
  if (options.initialize !== false) {
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
  }
  return {
    close: () => {
      sdk.dispose();
      database.close();
    },
    execSql: database.execSql,
    logged,
    reported,
    state,
  };
}

function failCommitsOnce(state: DocumentStoreState, count = 2): () => number {
  const durable = state.persistence;
  let remaining = count;
  let attempts = 0;
  state.persistence = {
    ...durable,
    async commitDocumentMutation(...args) {
      attempts += 1;
      if (remaining > 0) {
        remaining -= 1;
        throw busyRefusal();
      }
      return durable.commitDocumentMutation(...args);
    },
  } satisfies DocumentsPersistence;
  return () => attempts;
}

test("attach, replace, and remove retry busy SQLite refusals without dropping work", async () => {
  const fixture = await createStoreFixture("doc-busy-attachments");
  try {
    // Attach with 2 busy refusals.
    const attachAttempts = failCommitsOnce(fixture.state, 2);
    await attachFilesToDocumentStore(fixture.state, () => undefined, [
      {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/octet-stream",
        name: "first.bin",
      },
    ]);
    expect(attachAttempts()).toBe(3);
    expect(fixture.state.snapshot.attachments).toHaveLength(1);
    const slotId = fixture.state.snapshot.attachments[0]?.slotId;
    if (!slotId) throw new Error("Expected attached slot");
    expect(fixture.reported).toEqual([]);

    // Replace with 2 busy refusals.
    const replaceAttempts = failCommitsOnce(fixture.state, 2);
    await replaceAttachmentInDocumentStore(
      fixture.state,
      () => undefined,
      slotId,
      {
        bytes: new Uint8Array([4, 5, 6, 7]),
        mimeType: "application/octet-stream",
        name: "replaced.bin",
      },
    );
    expect(replaceAttempts()).toBe(3);
    expect(fixture.state.snapshot.attachments[0]?.name).toBe("replaced.bin");
    expect(fixture.reported).toEqual([]);

    // Remove with 2 busy refusals.
    const removeAttempts = failCommitsOnce(fixture.state, 2);
    await removeAttachmentFromDocumentStore(
      fixture.state,
      () => undefined,
      slotId,
    );
    expect(removeAttempts()).toBe(3);
    expect(fixture.state.snapshot.attachments).toEqual([]);
    expect(fixture.reported).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("history content restore retries busy SQLite refusals and returns true", async () => {
  const fixture = await createStoreFixture("doc-busy-restore");
  try {
    await setDocumentText(fixture.state, () => undefined, "newer text");
    const restoreAttempts = failCommitsOnce(fixture.state, 2);

    const restored = await restoreDocumentStoreContent(
      fixture.state,
      () => undefined,
      {
        rows: [],
        structuredFields: {},
        text: "restored text",
      },
    );
    expect(restored).toBe(true);
    expect(restoreAttempts()).toBe(3);
    expect(fixture.state.snapshot.text).toBe("restored text");
    expect(
      (
        await sqlDocumentsPersistence.loadDocument(
          fixture.execSql,
          "busy-write-doc",
        )
      )?.text,
    ).toBe("restored text");
    expect(fixture.reported).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("cold store initialization retries busy SQLite refusals so addRow succeeds", async () => {
  const fixture = await createStoreFixture("doc-busy-cold-init", {
    initialize: false,
  });
  try {
    const durable = fixture.state.persistence;
    let remainingLoadBusy = 2;
    let loadAttempts = 0;
    fixture.state.persistence = {
      ...durable,
      async loadDocument(execSql: ExecSql, localId: string) {
        loadAttempts += 1;
        if (remainingLoadBusy > 0) {
          remainingLoadBusy -= 1;
          throw busyRefusal();
        }
        return durable.loadDocument(execSql, localId);
      },
    } satisfies DocumentsPersistence;

    const rowId = await addRowToDocumentStore(fixture.state, () => undefined, {
      value: "saved-after-init-busy",
    });
    expect(loadAttempts).toBeGreaterThanOrEqual(3);
    expect(fixture.state.initialized).toBe(true);
    expect(fixture.state.snapshot.rows).toEqual([
      expect.objectContaining({
        fields: { value: "saved-after-init-busy" },
        id: rowId,
      }),
    ]);
    expect(fixture.reported).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("superseding a busy retry during its pause stops cleanly without logging errors", async () => {
  const initFixture = await createStoreFixture("doc-busy-superseded-init", {
    initialize: false,
  });
  const attachFixture = await createStoreFixture("doc-busy-superseded-attach");
  const restoreFixture = await createStoreFixture(
    "doc-busy-superseded-restore",
  );
  try {
    // Cold init superseded mid-pause.
    const initDurable = initFixture.state.persistence;
    initFixture.state.persistence = {
      ...initDurable,
      async loadDocument() {
        resetDocumentStore(initFixture.state);
        throw busyRefusal();
      },
    } satisfies DocumentsPersistence;
    expect(
      await ensureDocumentStoreReady(initFixture.state, () => undefined),
    ).toBe(false);
    expect(initFixture.reported).toEqual([]);

    // Attach superseded mid-pause.
    const attachDurable = attachFixture.state.persistence;
    attachFixture.state.persistence = {
      ...attachDurable,
      async commitDocumentMutation() {
        resetDocumentStore(attachFixture.state);
        throw busyRefusal();
      },
    } satisfies DocumentsPersistence;
    await attachFilesToDocumentStore(attachFixture.state, () => undefined, [
      {
        bytes: new Uint8Array([9, 8, 7]),
        mimeType: "application/octet-stream",
        name: "superseded.bin",
      },
    ]);
    expect(attachFixture.reported).toEqual([]);

    // Restore superseded mid-pause.
    const restoreDurable = restoreFixture.state.persistence;
    restoreFixture.state.persistence = {
      ...restoreDurable,
      async commitDocumentMutation() {
        resetDocumentStore(restoreFixture.state);
        throw busyRefusal();
      },
    } satisfies DocumentsPersistence;
    expect(
      await restoreDocumentStoreContent(restoreFixture.state, () => undefined, {
        rows: [],
        structuredFields: {},
        text: "superseded",
      }),
    ).toBe(false);
    expect(restoreFixture.reported).toEqual([]);
  } finally {
    initFixture.close();
    attachFixture.close();
    restoreFixture.close();
  }
});

test("restore finishes persisting after a busy refusal even if stillCurrent flips false post-admission", async () => {
  const fixture = await createStoreFixture("doc-busy-restore-post-admission");
  try {
    let stillCurrent = true;
    const durable = fixture.state.persistence;
    let remainingBusy = 1;
    fixture.state.persistence = {
      ...durable,
      async commitDocumentMutation(...args) {
        if (remainingBusy > 0) {
          remainingBusy -= 1;
          stillCurrent = false;
          throw busyRefusal();
        }
        return durable.commitDocumentMutation(...args);
      },
    } satisfies DocumentsPersistence;

    const restored = await restoreDocumentStoreContent(
      fixture.state,
      () => undefined,
      { rows: [], structuredFields: {}, text: "committed-after-flip" },
      { stillCurrent: () => stillCurrent },
    );
    expect(restored).toBe(true);
    expect(fixture.reported).toEqual([]);
    expect(
      (
        await sqlDocumentsPersistence.loadDocument(
          fixture.execSql,
          "busy-write-doc",
        )
      )?.text,
    ).toBe("committed-after-flip");
  } finally {
    fixture.close();
  }
});

test("exhausted busy attach resets the live doc when rollback reload is also busy", async () => {
  const fixture = await createStoreFixture("doc-busy-attach-exhausted-reset");
  try {
    const durable = fixture.state.persistence;
    let blockSql = true;
    fixture.state.persistence = {
      ...durable,
      async commitDocumentMutation(...args) {
        if (blockSql) throw busyRefusal();
        return durable.commitDocumentMutation(...args);
      },
      async loadDocumentWithHistoryRestoreState(execSql, localId) {
        if (blockSql) throw busyRefusal();
        return durable.loadDocumentWithHistoryRestoreState(execSql, localId);
      },
    } satisfies DocumentsPersistence;

    await attachFilesToDocumentStore(fixture.state, () => undefined, [
      {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/octet-stream",
        name: "never-committed.bin",
      },
    ]);
    // Exhausted retries reported the failure and cleared the dirty live doc.
    expect(fixture.reported).toHaveLength(1);
    expect(fixture.state.doc).toBeNull();

    // Once SQLite clears, reinitialization restores the clean durable document
    // with zero ghost attachment slots.
    blockSql = false;
    await waitFor(
      () => fixture.state.initialized && fixture.state.doc !== null,
      "Expected store to reinitialize after exhausted busy rollback reset",
      3_000,
    );
    expect(fixture.state.snapshot.attachments).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("settleDeferredInitialUpdate retries busy SQLite refusals when enqueuing the birth", async () => {
  const fixture = await createStoreFixture("doc-busy-deferred-birth", {
    deferInitialUpdate: true,
  });
  try {
    expect(fixture.state.deferInitialUpdate).toBe(true);
    const attempts = failCommitsOnce(fixture.state, 2);

    // Passing no files runs settleDeferredInitialUpdate -> enqueueDeferredTail.
    await attachFilesToDocumentStore(fixture.state, () => undefined, []);

    expect(attempts()).toBe(3);
    expect(fixture.state.deferInitialUpdate).toBe(false);
    expect(fixture.reported).toEqual([]);
    const pending = await sqlDocumentsPersistence.listPendingUpdates(
      fixture.execSql,
      "busy-write-doc",
    );
    expect(pending.length).toBeGreaterThan(0);
  } finally {
    fixture.close();
  }
});
