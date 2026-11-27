import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
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
import { createDocumentStoreState, type DocumentStoreState } from "../state";
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
  options: { readonly initialize?: boolean } = {},
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
  );
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
