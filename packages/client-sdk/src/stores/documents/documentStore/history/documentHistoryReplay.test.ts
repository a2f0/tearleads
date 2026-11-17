import { afterEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import {
  type DocumentHistory,
  openDocumentHistory,
} from "../../../../workflows/documents/history/documentHistory";
import { setDocumentStructuredFields, setDocumentText } from "../mutations";
import { persistDocument } from "../persistence";
import {
  addRowToDocumentStore,
  removeRowFromDocumentStore,
  updateRowInDocumentStore,
} from "../rows";
import { openHistoryTestStore as openStore } from "./historyDurability.testFixtures";

const realNow = Date.now;
const START = Date.UTC(2030, 0, 1, 12, 0, 0);
const MINUTE = 60_000;
let clock = START;

afterEach(() => {
  Date.now = realNow;
});

/** Each edit commits one minute after the previous one. */
function tick(): void {
  clock += MINUTE;
  Date.now = () => clock;
}

async function withHistoryDatabase(
  name: string,
  run: (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) => Promise<void>,
): Promise<void> {
  clock = START;
  Date.now = () => clock;
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

test("a note replays every saved edit with the time it was made", async () => {
  await withHistoryDatabase("history-replay-note", async (execSql) => {
    const state = await openStore(
      execSql,
      "note",
      sqlDocumentsPersistence,
      "one",
    );
    tick();
    await setDocumentText(state, () => undefined, "one two");
    tick();
    await setDocumentText(state, () => undefined, "one two three");

    const history = await openHistory(execSql, "note");
    try {
      expect(history.stops.map((stop) => stop.committedAt)).toEqual([
        START,
        START + MINUTE,
        START + 2 * MINUTE,
      ]);
      expect(history.stops.map((stop) => stop.index)).toEqual([0, 1, 2]);
      expect(
        history.stops.map((stop) => history.viewAt(stop.index).text),
      ).toEqual(["one", "one two", "one two three"]);
      expect(history.viewAt(-1).text).toBe("");
      // Stepping backwards shows the same versions.
      expect(history.viewAt(0).text).toBe("one");
      expect(history.viewAt(2).title).toBe(state.snapshot.title);

      expect(history.changeAt(2).text).toEqual({
        start: 7,
        insertedLength: 6,
        removedLength: 0,
      });
      expect(history.changeAt(0).text).toEqual({
        start: 0,
        insertedLength: 3,
        removedLength: 0,
      });
    } finally {
      history.close();
    }
  });
});

test("a structured document replays its fields and rows cell by cell", async () => {
  await withHistoryDatabase("history-replay-rows", async (execSql) => {
    const state = await openStore(execSql, "contact", sqlDocumentsPersistence);
    const noop = () => undefined;
    tick();
    await setDocumentStructuredFields(state, noop, "contact", {
      firstName: "Ada",
    });
    tick();
    const rowId = await addRowToDocumentStore(state, noop, {
      recordType: "postalAddress",
      street: "1 Analytical Way",
    });
    tick();
    await updateRowInDocumentStore(state, noop, rowId, {
      street: "2 Engine Road",
    });
    tick();
    await removeRowFromDocumentStore(state, noop, rowId);

    const history = await openHistory(execSql, "contact");
    try {
      const last = history.stops.length - 1;
      const streets = history.stops.map(
        (stop) =>
          history
            .viewAt(stop.index)
            .rows.map(({ fields: { street } }) => street)[0],
      );
      expect(streets.slice(-3)).toEqual([
        "1 Analytical Way",
        "2 Engine Road",
        undefined,
      ]);
      expect(history.viewAt(last).documentKind).toBe("contact");
      expect(history.viewAt(last).structuredFields).toEqual({
        firstName: "Ada",
      });

      expect(history.changeAt(last).rows).toEqual({
        added: [],
        changed: [],
        removed: [rowId],
      });
      expect(history.changeAt(last - 1).rows).toEqual({
        added: [],
        changed: [{ id: rowId, fields: ["street"] }],
        removed: [],
      });
      expect(history.changeAt(last - 2).rows.added).toEqual([rowId]);
      const fieldStop = history.stops.findIndex((stop) => {
        const { firstName } = history.viewAt(stop.index).structuredFields;
        return firstName === "Ada";
      });
      expect(history.changeAt(fieldStop).fields).toEqual(["firstName"]);
    } finally {
      history.close();
    }
  });
});

test("history replays from a checkpoint and its tail after a restart", async () => {
  await withHistoryDatabase("history-replay-compacted", async (execSql) => {
    const state = await openStore(execSql, "doc", sqlDocumentsPersistence, "a");
    tick();
    await setDocumentText(state, () => undefined, "ab");
    if (!state.doc) throw new Error("expected document");
    // Refresh the checkpoint from the live document, as compaction does. The
    // queued rows stay in the tail, so the two overlap on restore.
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(state.doc),
      localId: "doc",
      snapshot: bytesToBase64(exportFullHistorySnapshot(state.doc)),
      stillCurrent: () => true,
    });
    expect(
      (await sqlDocumentsPersistence.readHistoryTailSize(execSql, "doc"))
        .hasCheckpoint,
    ).toBe(true);
    const reopened = await openStore(execSql, "doc", sqlDocumentsPersistence);
    tick();
    await setDocumentText(reopened, () => undefined, "abc");
    if (!reopened.doc) throw new Error("expected document");
    await persistDocument(reopened, reopened.doc);

    const history = await openHistory(execSql, "doc");
    try {
      expect(
        history.stops.map((stop) => history.viewAt(stop.index).text),
      ).toEqual(["a", "ab", "abc"]);
      expect(history.stops.map((stop) => stop.committedAt)).toEqual([
        START,
        START + MINUTE,
        START + 2 * MINUTE,
      ]);
    } finally {
      history.close();
    }
  });
});

test("the live document keeps editing while its history is open", async () => {
  await withHistoryDatabase("history-replay-live", async (execSql) => {
    const state = await openStore(
      execSql,
      "live",
      sqlDocumentsPersistence,
      "before",
    );
    const history = await openHistory(execSql, "live");
    try {
      history.viewAt(0);
      tick();
      await setDocumentText(state, () => undefined, "before and after");

      expect(state.doc?.isDetached()).toBe(false);
      expect(state.snapshot.text).toBe("before and after");
      // The capture does not move; a new one sees the later edit.
      expect(history.stops).toHaveLength(1);
      const later = await openHistory(execSql, "live");
      try {
        expect(later.viewAt(later.stops.length - 1).text).toBe(
          "before and after",
        );
        expect(later.versionAt(later.stops.length - 1)).toEqual([
          {
            counter: (later.stops.at(-1)?.endCounter ?? 0) - 1,
            peerId: later.stops.at(-1)?.peerId ?? "",
          },
        ]);
      } finally {
        later.close();
      }
    } finally {
      history.close();
    }
  });
});

test("a document without durable history has none to open", async () => {
  await withHistoryDatabase("history-replay-missing", async (execSql) => {
    expect(
      await openDocumentHistory({
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
        localId: "never-created",
        persistence: sqlDocumentsPersistence,
      }),
    ).toBeNull();
  });
});

test("a closed or out-of-range history refuses to replay", async () => {
  await withHistoryDatabase("history-replay-closed", async (execSql) => {
    await openStore(execSql, "closing", sqlDocumentsPersistence, "text");
    const history = await openHistory(execSql, "closing");
    expect(() => history.viewAt(1)).toThrow(RangeError);
    expect(() => history.changeAt(-1)).toThrow(RangeError);
    history.close();
    history.close();
    expect(() => history.viewAt(0)).toThrow("Document history is closed.");
  });
});
