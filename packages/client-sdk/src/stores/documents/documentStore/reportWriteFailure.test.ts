import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../../test/helpers/data/waitFor";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { Tearleads } from "../../../Tearleads";
import type {
  DocumentsPersistence,
  ExecSql,
} from "../../../workflows/documents";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import {
  BUSY_WRITE_RETRY_MS,
  reportDocumentStoreWriteFailure,
} from "./reportWriteFailure";
import { addRowToDocumentStore } from "./rows";
import { createDocumentStoreState, type DocumentStoreState } from "./state";

const MESSAGE = "Documents: local text persist failed";
const ROW_MESSAGE = "Documents: row mutation failed";

interface ReportingUtil {
  log: (message: string) => void;
  logError?: DocumentsRuntime["util"]["logError"];
}

/** The reporter reads nothing but the runtime's two log callbacks. */
function createReportingState(util: ReportingUtil): DocumentStoreState {
  return { runtime: { util } } as unknown as DocumentStoreState;
}

/** A live store over a real SQLite database, as a typing user has. */
async function createWriteFailureStore(
  sdk: Tearleads,
  execSql: ExecSql,
  util?: Partial<DocumentsRuntime["util"]>,
): Promise<DocumentStoreState> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const runtime = sdk.documents.workflowRuntime();
  const state = createDocumentStoreState(
    "write-failure-document",
    {
      ...runtime,
      infra: { ...runtime.infra, dbStatus: "ready", execSql },
      state: { ...runtime.state, online: false },
      util: { ...runtime.util, ...util },
    },
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
  );
  if (!(await ensureDocumentStoreReady(state, () => undefined))) {
    throw new Error("Expected the write-failure store to initialize");
  }
  return state;
}

test.each(["success", "throw", "reject"])(
  "a failed local write reaches the SDK logger: %s",
  async (result) => {
    const database = await createTestExecSql("document-write-failure");
    const reported: unknown[] = [];
    const sdk = new Tearleads({
      logger: {
        log: () => undefined,
        logError: (_message, error) => {
          reported.push(error);
          if (result === "throw")
            throw new Error("Diagnostic transport unavailable");
          if (result === "reject")
            return Promise.reject(
              new Error("Diagnostic transport unavailable"),
            );
          return undefined;
        },
      },
    });
    try {
      const state = await createWriteFailureStore(sdk, database.execSql);

      // Fail the way a broken local database does: the store is live and the
      // typed text is already on screen, and only the durable mutation refuses.
      const textFailure = new Error("Local snapshot write rejected");
      const rowFailure = new Error("Local row write rejected");
      let writeFailure = textFailure;
      const durablePersistence = state.persistence;
      state.persistence = {
        ...durablePersistence,
        async commitDocumentMutation() {
          throw writeFailure;
        },
      } satisfies DocumentsPersistence;

      // setDocumentText resolves the write chain, so a throwing or rejecting
      // host has already had its chance to break the chain by here.
      await setDocumentText(state, () => undefined, "typed text");
      expect(reported).toEqual([textFailure]);
      // The optimistic text survives and the in-flight counter still settled.
      expect(state.snapshot.text).toBe("typed text");
      expect(state.pendingLocalWrites).toBe(0);

      // Every keystroke of a burst fails the same way; the host hears once.
      await setDocumentText(state, () => undefined, "more typed text");
      expect(reported).toEqual([textFailure]);

      writeFailure = rowFailure;
      await addRowToDocumentStore(state, () => undefined, { name: "row" });
      expect(reported).toEqual([textFailure, rowFailure]);
    } finally {
      sdk.dispose();
      database.close();
    }
  },
);

test("a released database is logged locally, never reported", () => {
  const logged: string[] = [];
  const reported: unknown[] = [];
  const state = createReportingState({
    log: (message) => logged.push(message),
    logError: (_message, error) => reported.push(error),
  });

  // The SQLite worker's own teardown wording, which every identity switch,
  // logout, and Explorer retry can raise under an in-flight write.
  reportDocumentStoreWriteFailure(
    state,
    MESSAGE,
    new Error("DB has been closed."),
  );

  expect(logged).toEqual([MESSAGE]);
  expect(reported).toEqual([]);
});

test("identical failures report once per store state", () => {
  const reported: unknown[] = [];
  const util: ReportingUtil = {
    log: () => undefined,
    logError: (_message, error) => reported.push(error),
  };
  const first = createReportingState(util);
  const second = createReportingState(util);
  const failure = new Error("Local snapshot write rejected");
  const otherFailure = new Error("Content key derivation failed");

  reportDocumentStoreWriteFailure(first, MESSAGE, failure);
  reportDocumentStoreWriteFailure(first, MESSAGE, failure);
  reportDocumentStoreWriteFailure(first, MESSAGE, otherFailure);
  // A dropped-file import builds one store per file, so a second store is a
  // second document failing, not a repeat of the first.
  reportDocumentStoreWriteFailure(second, MESSAGE, failure);

  expect(reported).toEqual([failure, otherFailure, failure]);
});

test("a host without logError keeps its local line and suppresses nothing", () => {
  const logged: string[] = [];
  const reported: unknown[] = [];
  const util: ReportingUtil = { log: (message) => logged.push(message) };
  const state = createReportingState(util);
  const failure = new Error("Local snapshot write rejected");

  reportDocumentStoreWriteFailure(state, MESSAGE, failure);
  reportDocumentStoreWriteFailure(state, MESSAGE, failure);
  expect(logged).toEqual([MESSAGE, MESSAGE]);

  // The string-only fallback never consumed the suppression slot.
  util.logError = (_message, error) => reported.push(error);
  reportDocumentStoreWriteFailure(state, MESSAGE, failure);
  expect(reported).toEqual([failure]);
});

test.each(["throw", "reject"])(
  "a failing host log cannot break the write chain: %s",
  async (result) => {
    const database = await createTestExecSql(`write-failure-log-${result}`);
    const sdk = new Tearleads({
      logger: { log: () => undefined, logError: () => undefined },
    });
    try {
      // Armed only after setup, so store initialization still logs normally.
      let hostile = false;
      const state = await createWriteFailureStore(sdk, database.execSql, {
        log: () => {
          if (!hostile) return undefined;
          if (result === "throw")
            throw new Error("Diagnostic transport unavailable");
          return Promise.reject(new Error("Diagnostic transport unavailable"));
        },
      });
      // A released database takes the local-log branch — the one report path
      // that runs with no logError involved.
      state.persistence = {
        ...state.persistence,
        async commitDocumentMutation() {
          throw new Error("DB has been closed.");
        },
      } satisfies DocumentsPersistence;
      hostile = true;

      // Both awaits would reject, and the text chain would skip its settle, if
      // the local line were not isolated from the chain it observes.
      await setDocumentText(state, () => undefined, "typed text");
      expect(state.snapshot.text).toBe("typed text");
      expect(state.pendingLocalWrites).toBe(0);
      await addRowToDocumentStore(state, () => undefined, { name: "row" });
    } finally {
      sdk.dispose();
      database.close();
    }
  },
);

test("each failing write site reports, even on one shared error", () => {
  const reported: unknown[] = [];
  const state = createReportingState({
    log: () => undefined,
    logError: (message) => reported.push(message),
  });
  const failure = new Error("Local snapshot write rejected");

  // One broken database fails the text and row paths with the same error, and
  // the suppression key carries the message so neither site loses its report.
  reportDocumentStoreWriteFailure(state, MESSAGE, failure);
  reportDocumentStoreWriteFailure(state, ROW_MESSAGE, failure);
  reportDocumentStoreWriteFailure(state, ROW_MESSAGE, failure);

  expect(reported).toEqual([MESSAGE, ROW_MESSAGE]);
});

/** Fails each commit with the next queued error, then commits for real. */
function failCommits(state: DocumentStoreState, failures: Error[]): void {
  const durable = state.persistence;
  state.persistence = {
    ...durable,
    async commitDocumentMutation(...args) {
      const failure = failures.shift();
      if (failure) throw failure;
      return durable.commitDocumentMutation(...args);
    },
  } satisfies DocumentsPersistence;
}

const busyRefusal = () =>
  new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

async function durableText(execSql: ExecSql): Promise<string | undefined> {
  return (
    await sqlDocumentsPersistence.loadDocument(
      execSql,
      "write-failure-document",
    )
  )?.text;
}

// #3360: a persist refused behind another tab's transaction used to wait for
// the next edit, so text typed last stayed out of SQLite until then.
test("a text write refused as busy is saved again without another edit", async () => {
  const database = await createTestExecSql("document-busy-write-retry");
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    const state = await createWriteFailureStore(sdk, database.execSql, {
      log: (message) => logged.push(message),
    });
    failCommits(state, [busyRefusal()]);

    await setDocumentText(state, () => undefined, "typed text");
    expect(await durableText(database.execSql)).not.toBe("typed text");

    await waitFor(
      async () => (await durableText(database.execSql)) === "typed text",
      "The busy text write was not saved again.",
      BUSY_WRITE_RETRY_MS * 3,
    );
    expect(state.unsavedLocalEdits).toBe(false);
    expect(reported).toEqual([]);
    expect(logged).toContain(
      `${MESSAGE} behind another tab's database transaction`,
    );
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("a busy retry saves the newest text, never a value a later write replaced", async () => {
  const database = await createTestExecSql("document-busy-write-newest");
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: () => undefined },
  });
  try {
    const state = await createWriteFailureStore(sdk, database.execSql);
    failCommits(state, [busyRefusal(), new Error("Local write rejected")]);

    await setDocumentText(state, () => undefined, "first");
    await setDocumentText(state, () => undefined, "second");

    await waitFor(
      async () => (await durableText(database.execSql)) === "second",
      "The busy retry did not save the newest text.",
      BUSY_WRITE_RETRY_MS * 3,
    );
    expect(state.snapshot.text).toBe("second");
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("a busy refusal at a write site that does not retry is still reported", () => {
  const logged: string[] = [];
  const reported: unknown[] = [];
  const state = createReportingState({
    log: (message) => logged.push(message),
    logError: (_message, error) => reported.push(error),
  });
  const refusal = busyRefusal();

  reportDocumentStoreWriteFailure(state, ROW_MESSAGE, refusal);

  expect(reported).toEqual([refusal]);
  expect(logged).toEqual([]);
});

test("a row write refused as busy is saved again without another edit", async () => {
  const database = await createTestExecSql("document-busy-row-retry");
  const reported: unknown[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    const state = await createWriteFailureStore(sdk, database.execSql);
    failCommits(state, [busyRefusal()]);

    await addRowToDocumentStore(state, () => undefined, { name: "row" });
    expect(state.unsavedLocalEdits).toBe(true);

    await waitFor(
      () => !state.unsavedLocalEdits,
      "The busy row write was not saved again.",
      BUSY_WRITE_RETRY_MS * 3,
    );
    expect(reported).toEqual([]);
  } finally {
    sdk.dispose();
    database.close();
  }
});
