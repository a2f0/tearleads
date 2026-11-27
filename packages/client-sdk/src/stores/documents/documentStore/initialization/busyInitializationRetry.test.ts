import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DATABASE_BUSY_RUN_LIMIT } from "../../../../data/sqlite/availability/databaseBusyRetry";
import { Tearleads } from "../../../../Tearleads";
import type { DocumentsPersistence } from "../../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { setDocumentStructuredFields, setDocumentText } from "../mutations";
import {
  addRowToDocumentStore,
  removeRowFromDocumentStore,
  updateRowInDocumentStore,
} from "../rows";
import { createDocumentStoreState } from "../state";
import { ensureDocumentStoreReady } from "./index";

const noop = () => undefined;

const busyRefusal = () =>
  new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

function createColdStore(input: {
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
  localId: string;
  logged: string[];
  persistence: DocumentsPersistence;
  sdk: Tearleads;
}) {
  const runtime = input.sdk.documents.workflowRuntime();
  return createDocumentStoreState(
    input.localId,
    {
      ...runtime,
      infra: { ...runtime.infra, dbStatus: "ready", execSql: input.execSql },
      state: { ...runtime.state, online: false },
      util: { ...runtime.util, log: (message) => input.logged.push(message) },
    },
    input.persistence,
    noopDocumentStorePersistenceEffects,
    null,
  );
}

test("ensureDocumentStoreReady retries busy refusals during load and creation", async () => {
  const database = await createTestExecSql("init-busy-load-create");
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    let loadCalls = 0;
    let createCalls = 0;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async loadDocumentStoreState(...args) {
        loadCalls += 1;
        if (loadCalls === 1) throw busyRefusal();
        return sqlDocumentsPersistence.loadDocumentStoreState(...args);
      },
      async createDocumentWithHistoryCheckpoint(...args) {
        createCalls += 1;
        if (createCalls === 1) throw busyRefusal();
        return sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
          ...args,
        );
      },
    };
    const state = createColdStore({
      execSql: database.execSql,
      localId: "init-busy-doc",
      logged,
      persistence,
      sdk,
    });

    expect(await ensureDocumentStoreReady(state, noop)).toBe(true);
    expect(loadCalls).toBeGreaterThanOrEqual(3);
    expect(createCalls).toBe(2);
    expect(reported).toEqual([]);
    expect(
      logged.some((line) =>
        line.includes("initialization delayed behind another tab"),
      ),
    ).toBe(true);
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("cold row, text, and structured-field calls succeed after a busy initialization refusal", async () => {
  const database = await createTestExecSql("init-busy-write-callers");
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    const makeBusyOncePersistence = (): DocumentsPersistence => {
      let refused = false;
      return {
        ...sqlDocumentsPersistence,
        async loadDocumentStoreState(...args) {
          if (!refused) {
            refused = true;
            throw busyRefusal();
          }
          return sqlDocumentsPersistence.loadDocumentStoreState(...args);
        },
      };
    };

    const rowState = createColdStore({
      execSql: database.execSql,
      localId: "cold-row-doc",
      logged,
      persistence: makeBusyOncePersistence(),
      sdk,
    });
    const rowId = await addRowToDocumentStore(rowState, noop, {
      street: "1 Busy Way",
    });
    expect(rowId).toBeString();
    if (!rowId) throw new Error("Expected added row id");
    expect(rowState.snapshot.rows.map((row) => row.id)).toEqual([rowId]);

    const updateState = createColdStore({
      execSql: database.execSql,
      localId: "cold-row-doc",
      logged,
      persistence: makeBusyOncePersistence(),
      sdk,
    });
    await updateRowInDocumentStore(updateState, noop, rowId, {
      street: "2 Updated Way",
    });
    expect(updateState.snapshot.rows[0]?.fields).toEqual({
      street: "2 Updated Way",
    });

    const removeState = createColdStore({
      execSql: database.execSql,
      localId: "cold-row-doc",
      logged,
      persistence: makeBusyOncePersistence(),
      sdk,
    });
    await removeRowFromDocumentStore(removeState, noop, rowId);
    expect(removeState.snapshot.rows).toEqual([]);

    const textState = createColdStore({
      execSql: database.execSql,
      localId: "cold-text-doc",
      logged,
      persistence: makeBusyOncePersistence(),
      sdk,
    });
    await setDocumentText(textState, noop, "saved after busy init");
    expect(textState.snapshot.text).toBe("saved after busy init");

    const fieldsState = createColdStore({
      execSql: database.execSql,
      localId: "cold-fields-doc",
      logged,
      persistence: makeBusyOncePersistence(),
      sdk,
    });
    await setDocumentStructuredFields(fieldsState, noop, "contact", {
      firstName: "Ada",
    });
    expect(fieldsState.snapshot.structuredFields).toHaveProperty(
      "firstName",
      "Ada",
    );
    expect(reported).toEqual([]);
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("exhausted busy initialization returns null from addRow and reports the loss", async () => {
  const database = await createTestExecSql("init-busy-exhausted");
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    let remainingRefusals = DATABASE_BUSY_RUN_LIMIT;
    let attempts = 0;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async loadDocumentStoreState(...args) {
        attempts += 1;
        if (remainingRefusals > 0) {
          remainingRefusals -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.loadDocumentStoreState(...args);
      },
    };
    const state = createColdStore({
      execSql: database.execSql,
      localId: "init-exhausted-doc",
      logged,
      persistence,
      sdk,
    });

    const failedId = await addRowToDocumentStore(state, noop, {
      street: "Never Saved",
    });
    expect(failedId).toBeNull();
    expect(attempts).toBe(DATABASE_BUSY_RUN_LIMIT);
    expect(state.initialized).toBe(false);
    expect(state.snapshot.rows).toEqual([]);
    expect(reported).toHaveLength(1);

    // Once the other tab releases its transaction, a later call initializes
    // cleanly and returns the persisted row id.
    const nextId = await addRowToDocumentStore(state, noop, {
      street: "Saved After Clear",
    });
    expect(nextId).toBeString();
    expect(state.initialized).toBe(true);
    expect(state.snapshot.rows.map((row) => row.id)).toEqual([nextId ?? ""]);
  } finally {
    sdk.dispose();
    database.close();
  }
});
