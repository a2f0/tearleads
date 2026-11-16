import { afterEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import {
  type DocumentHistory,
  openDocumentHistory,
} from "../../../../workflows/documents/history/documentHistory";
import { setDocumentStructuredFields, setDocumentText } from "../mutations";
import { listPendingUpdates } from "../persistence";
import { addRowToDocumentStore } from "../rows";
import { openHistoryTestStore as openStore } from "./historyDurability.testFixtures";
import { restoreDocumentStoreContent } from "./restoreContent";

const realNow = Date.now;
let clock = Date.UTC(2030, 0, 1, 12, 0, 0);
const noop = () => undefined;

afterEach(() => {
  Date.now = realNow;
});

/** Each edit commits one minute after the previous one, as its own stop. */
function tick(): void {
  clock += 60_000;
  Date.now = () => clock;
}

async function withDatabase(
  name: string,
  run: (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) => Promise<void>,
): Promise<void> {
  tick();
  const { close, execSql } = await createTestExecSql(name);
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await run(execSql);
  } finally {
    close();
  }
}

async function openHistory(
  execSql: Parameters<typeof openDocumentHistory>[0]["execSql"],
  localId: string,
): Promise<DocumentHistory> {
  const history = await openDocumentHistory({
    documentProjectors: defaultDocumentProjectorRegistry,
    execSql,
    localId,
    persistence: sqlDocumentsPersistence,
  });
  if (!history) throw new Error("expected document history");
  return history;
}

test("restoring a past version writes it back as a new step of history", async () => {
  await withDatabase("restore-note", async (execSql) => {
    const state = await openStore(
      execSql,
      "note",
      sqlDocumentsPersistence,
      "first",
    );
    tick();
    await setDocumentText(state, noop, "first and second");
    const before = await openHistory(execSql, "note");
    tick();

    expect(
      await restoreDocumentStoreContent(state, noop, before.viewAt(0)),
    ).toBe(true);

    // The store shows the restored text, and it is durable and queued to sync.
    expect(state.snapshot.text).toBe("first");
    expect(state.unsavedLocalEdits).toBe(false);
    expect((await listPendingUpdates(state)).length).toBeGreaterThan(0);

    const after = await openHistory(execSql, "note");
    try {
      // Nothing was rewound: the old stops are intact and one was added.
      expect(after.stops).toHaveLength(before.stops.length + 1);
      expect(after.stops.map((stop) => after.viewAt(stop.index).text)).toEqual([
        "first",
        "first and second",
        "first",
      ]);
      expect(after.stops.at(-1)?.committedAt).toBe(clock);
    } finally {
      after.close();
      before.close();
    }

    const reopened = await openStore(execSql, "note", sqlDocumentsPersistence);
    expect(reopened.snapshot.text).toBe("first");
  });
});

test("restoring a structured document brings back its fields and rows", async () => {
  await withDatabase("restore-contact", async (execSql) => {
    const state = await openStore(execSql, "contact", sqlDocumentsPersistence);
    tick();
    await setDocumentStructuredFields(state, noop, "contact", {
      firstName: "Ada",
    });
    tick();
    const rowId = await addRowToDocumentStore(state, noop, {
      street: "1 Analytical Way",
    });
    const withRow = await openHistory(execSql, "contact");
    const target = withRow.viewAt(withRow.stops.length - 1);
    withRow.close();
    tick();
    await setDocumentStructuredFields(state, noop, "contact", {
      firstName: "Augusta",
      nickname: "AAL",
    });
    tick();
    await addRowToDocumentStore(state, noop, { street: "2 Engine Road" });
    tick();

    expect(await restoreDocumentStoreContent(state, noop, target)).toBe(true);

    expect(state.snapshot.structuredFields).toEqual({ firstName: "Ada" });
    expect(
      state.snapshot.rows.map((row) => ({ fields: row.fields, id: row.id })),
    ).toEqual([{ fields: { street: "1 Analytical Way" }, id: rowId }]);
  });
});

test("restoring the content a document already holds saves nothing", async () => {
  await withDatabase("restore-noop", async (execSql) => {
    const state = await openStore(
      execSql,
      "same",
      sqlDocumentsPersistence,
      "unchanged",
    );
    const before = await openHistory(execSql, "same");
    const current = before.viewAt(before.stops.length - 1);
    tick();

    expect(await restoreDocumentStoreContent(state, noop, current)).toBe(true);

    const after = await openHistory(execSql, "same");
    try {
      expect(after.stops).toHaveLength(before.stops.length);
    } finally {
      after.close();
      before.close();
    }
  });
});

test("a restore whose guard expired changes nothing", async () => {
  await withDatabase("restore-guard", async (execSql) => {
    const state = await openStore(
      execSql,
      "guarded",
      sqlDocumentsPersistence,
      "first",
    );
    tick();
    await setDocumentText(state, noop, "first and second");
    const history = await openHistory(execSql, "guarded");
    const target = history.viewAt(0);
    history.close();

    expect(
      await restoreDocumentStoreContent(state, noop, target, {
        stillCurrent: () => false,
      }),
    ).toBe(false);
    expect(state.snapshot.text).toBe("first and second");
  });
});

test("a document that cannot be written refuses a restore", async () => {
  await withDatabase("restore-read-only", async (execSql) => {
    const state = await openStore(
      execSql,
      "read-only",
      sqlDocumentsPersistence,
      "first",
    );
    tick();
    await setDocumentText(state, noop, "first and second");
    const history = await openHistory(execSql, "read-only");
    const target = history.viewAt(0);
    history.close();
    if (!state.record) throw new Error("expected a document record");
    state.record = { ...state.record, effectiveAccessLevel: "read" };

    expect(await restoreDocumentStoreContent(state, noop, target)).toBe(false);
    expect(state.snapshot.text).toBe("first and second");
  });
});
