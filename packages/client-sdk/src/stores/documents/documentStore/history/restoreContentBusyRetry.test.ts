import { afterEach, expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DATABASE_BUSY_RUN_LIMIT } from "../../../../data/sqlite/availability/databaseBusyRetry";
import { Tearleads } from "../../../../Tearleads";
import type { DocumentsPersistence } from "../../../../workflows/documents";
import { openDocumentHistory } from "../../../../workflows/documents/history/documentHistory";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { setDocumentText } from "../mutations";
import { createDocumentStoreState } from "../state";
import { openHistoryTestStore as openStore } from "./historyDurability.testFixtures";
import { restoreDocumentStoreContent } from "./restoreContent";

const noop = () => undefined;
const realNow = Date.now;
let clock = Date.UTC(2030, 0, 1, 12, 0, 0);

afterEach(() => {
  Date.now = realNow;
});

function tick(): void {
  clock += 60_000;
  Date.now = () => clock;
}

const busyRefusal = () =>
  new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

async function openHistory(
  execSql: Parameters<typeof openDocumentHistory>[0]["execSql"],
  localId: string,
) {
  const history = await openDocumentHistory({
    documentProjectors: defaultDocumentProjectorRegistry,
    execSql,
    localId,
    persistence: sqlDocumentsPersistence,
  });
  if (!history) throw new Error("expected document history");
  return history;
}

test("restoreDocumentStoreContent retries busy persist refusals as one history stop", async () => {
  const database = await createTestExecSql("restore-busy-retry");
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    tick();
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    const seed = await openStore(
      database.execSql,
      "restore-busy",
      sqlDocumentsPersistence,
      "first",
    );
    tick();
    await setDocumentText(seed, noop, "first and second");
    const before = await openHistory(database.execSql, "restore-busy");
    const target = before.viewAt(0);
    const stopsBefore = before.stops.length;
    before.close();
    expect(target.text).toBe("first");
    tick();

    let initRefusals = 1;
    let commitRefusals = 2;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async loadDocumentStoreState(...args) {
        if (initRefusals > 0) {
          initRefusals -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.loadDocumentStoreState(...args);
      },
      async commitDocumentMutation(...args) {
        if (commitRefusals > 0) {
          commitRefusals -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    const runtime = sdk.documents.workflowRuntime();
    const coldState = createDocumentStoreState(
      "restore-busy",
      {
        ...runtime,
        infra: {
          ...runtime.infra,
          dbStatus: "ready",
          execSql: database.execSql,
        },
        state: { ...runtime.state, online: false },
        util: { ...runtime.util, log: (message) => logged.push(message) },
      },
      persistence,
      noopDocumentStorePersistenceEffects,
      null,
    );

    expect(await restoreDocumentStoreContent(coldState, noop, target)).toBe(
      true,
    );
    expect(coldState.snapshot.text).toBe("first");
    expect(coldState.unsavedLocalEdits).toBe(false);
    expect(reported).toEqual([]);
    expect(
      logged.some((line) =>
        line.includes("content restore failed behind another tab"),
      ),
    ).toBe(true);

    const after = await openHistory(database.execSql, "restore-busy");
    try {
      expect(after.stops).toHaveLength(stopsBefore + 1);
      expect(after.viewAt(after.stops.length - 1).text).toBe("first");
    } finally {
      after.close();
    }
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("restoreDocumentStoreContent retries busy refusals on a no-op restore", async () => {
  const database = await createTestExecSql("restore-busy-noop");
  const reported: unknown[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    tick();
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    await openStore(
      database.execSql,
      "restore-noop-busy",
      sqlDocumentsPersistence,
      "unchanged",
    );
    const before = await openHistory(database.execSql, "restore-noop-busy");
    const current = before.viewAt(before.stops.length - 1);
    before.close();
    tick();

    let commitRefusals = 1;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async commitDocumentMutation(...args) {
        if (commitRefusals > 0) {
          commitRefusals -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    const runtime = sdk.documents.workflowRuntime();
    const state = createDocumentStoreState(
      "restore-noop-busy",
      {
        ...runtime,
        infra: {
          ...runtime.infra,
          dbStatus: "ready",
          execSql: database.execSql,
        },
        state: { ...runtime.state, online: false },
      },
      persistence,
      noopDocumentStorePersistenceEffects,
      null,
    );

    expect(await restoreDocumentStoreContent(state, noop, current)).toBe(true);
    expect(commitRefusals).toBe(0);
    expect(reported).toEqual([]);
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("restoreDocumentStoreContent returns false and reports when busy retries exhaust", async () => {
  const database = await createTestExecSql("restore-busy-exhausted");
  const reported: unknown[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    tick();
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    const seed = await openStore(
      database.execSql,
      "restore-exhausted",
      sqlDocumentsPersistence,
      "first",
    );
    tick();
    await setDocumentText(seed, noop, "first and second");
    const history = await openHistory(database.execSql, "restore-exhausted");
    const target = history.viewAt(0);
    history.close();
    expect(target.text).toBe("first");
    tick();

    let commitAttempts = 0;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async commitDocumentMutation() {
        commitAttempts += 1;
        throw busyRefusal();
      },
    };
    const runtime = sdk.documents.workflowRuntime();
    const state = createDocumentStoreState(
      "restore-exhausted",
      {
        ...runtime,
        infra: {
          ...runtime.infra,
          dbStatus: "ready",
          execSql: database.execSql,
        },
        state: { ...runtime.state, online: false },
      },
      persistence,
      noopDocumentStorePersistenceEffects,
      null,
    );

    expect(await restoreDocumentStoreContent(state, noop, target)).toBe(false);
    expect(commitAttempts).toBe(DATABASE_BUSY_RUN_LIMIT);
    expect(reported).toHaveLength(1);
    const durable = await sqlDocumentsPersistence.loadDocument(
      database.execSql,
      "restore-exhausted",
    );
    expect(durable?.text).toBe("first and second");
  } finally {
    sdk.dispose();
    database.close();
  }
});
