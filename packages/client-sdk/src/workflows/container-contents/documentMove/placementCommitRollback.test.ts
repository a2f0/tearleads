import { expect, test } from "bun:test";
import { createFileBackedSql } from "../../../../test/helpers/fileBackedSql";
import { createPlacementCommitFixture } from "../../../../test/helpers/placementCommit";
import { sqlDocumentContainerProjectionPersistence as links } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { sqlDocumentMoveIntentPersistence as intents } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence as documents } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { relinkDocumentStoreWithCommitSideEffect } from "../../../stores/documents/documentStore/internalRelink";
import { subscribeToPersistedDocuments } from "../../../stores/documents/registry";
import { settleDocumentMoveIntent } from "./documentMoveIntentSettlement";

// Await the worker before invoking Bun's synchronous rejection matcher: the
// matcher otherwise blocks delivery of the worker's failure response.
async function expectRejection(operation: Promise<unknown>, message?: string) {
  const error = await operation.then(
    () => null,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(Error);
  if (message) expect(String(error)).toContain(message);
}

async function snapshot(execSql: ExecSql) {
  return Promise.all(
    [
      "documents",
      "document_projection",
      "document_projection_text",
      "local_intents",
      "document_intent_link_targets",
      "document_container_projection",
    ].map((table) => execSql(`SELECT * FROM ${table} ORDER BY rowid`)),
  );
}

const failures = [
  { operation: "move", table: "local_intents" },
  { operation: "move", table: "document_container_projection" },
  { operation: "link", table: "local_intents" },
  { operation: "link", table: "document_intent_link_targets" },
  { operation: "link", table: "document_container_projection" },
  { operation: "unlink", table: "local_intents" },
  { operation: "unlink", table: "document_intent_link_targets" },
  { operation: "unlink", table: "document_container_projection" },
] as const;

test.each(failures)(
  "%j failure propagates and rolls back the document and all placement effects",
  async ({ operation, table }) => {
    const f = await createPlacementCommitFixture();
    const published: string[] = [];
    const unsubscribe = subscribeToPersistedDocuments(
      f.workflow.state.domainScope,
      ({ id }) => {
        published.push(id);
      },
    );
    try {
      const before = await snapshot(f.db.execSql);
      await f.db.execSql(
        `CREATE TEMP TRIGGER fail_placement BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'placement failure'); END`,
      );
      f.db.statements.length = 0;
      await expectRejection(f[operation](), table);
      expect(f.db.statements).toContain("ROLLBACK");
      expect(f.db.statements).not.toContain("COMMIT");
      expect(await snapshot(f.db.execSql)).toEqual(before);
      expect(published).toEqual([]);
    } finally {
      unsubscribe();
      await f.db.close();
      await f.db.remove();
    }
  },
);

test.each([
  { event: "DELETE", table: "local_intents" },
  { event: "DELETE", table: "document_intent_link_targets" },
  { event: "INSERT", table: "document_container_projection" },
])(
  "settlement %j failure restores both the document and queued intent",
  async ({ event, table }) => {
    const f = await createPlacementCommitFixture();
    try {
      await f.link();
      const [intent] = await intents.listPendingMoveIntents(f.db.execSql);
      if (!intent) throw new Error("Missing queued intent");
      const before = await snapshot(f.db.execSql);
      await f.db.execSql(
        `CREATE TEMP TRIGGER fail_settlement BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'settlement failure'); END`,
      );
      await expectRejection(
        relinkDocumentStoreWithCommitSideEffect(
          f.store,
          {
            localId: "local",
            documentId: f.documentId,
            containerId: "trash",
            accessEpoch: 2,
          },
          (execSql) =>
            settleDocumentMoveIntent({
              execSql,
              intent,
              isCurrent: () => true,
              linkedContainerIds: ["trash"],
              partial: false,
            }),
        ),
      );
      expect(await snapshot(f.db.execSql)).toEqual(before);
    } finally {
      await f.db.close();
      await f.db.remove();
    }
  },
);

test.each([false, true])(
  "settlement retains generation and supersession guards (partial: %s)",
  async (partial) => {
    const f = await createPlacementCommitFixture();
    try {
      await f.move();
      const [intent] = await intents.listPendingMoveIntents(f.db.execSql);
      if (!intent) throw new Error("Missing queued intent");
      const before = await snapshot(f.db.execSql);
      for (const stale of ["generation", "intent"] as const) {
        await expectRejection(
          relinkDocumentStoreWithCommitSideEffect(
            f.store,
            {
              localId: "local",
              documentId: f.documentId,
              containerId: "trash",
              accessEpoch: 2,
            },
            (execSql) =>
              settleDocumentMoveIntent({
                execSql,
                intent:
                  stale === "intent" ? { ...intent, id: "superseded" } : intent,
                isCurrent: () => stale !== "generation",
                linkedContainerIds: ["trash"],
                partial,
              }),
          ),
          stale === "intent" ? "superseded" : "generation changed",
        );
        expect(await snapshot(f.db.execSql)).toEqual(before);
      }
    } finally {
      await f.db.close();
      await f.db.remove();
    }
  },
);

test.each(["move", "link", "unlink", "projection"] as const)(
  "standalone %s retains its own transaction and rollback",
  async (operation) => {
    const f = {
      db: await createFileBackedSql(),
      documentId: "standalone-document",
    };
    const input = {
      documentId: f.documentId,
      localId: "local",
      sourceContainerId: "source-container",
      removedContainerId: "source-container",
      targetContainerId: "trash",
      replaceLinkedContainers: true,
    };
    const run = () => {
      if (operation === "move")
        return intents.enqueueMoveIntent(f.db.execSql, input);
      if (operation === "link")
        return intents.enqueueLinkIntent(f.db.execSql, input);
      if (operation === "unlink")
        return intents.enqueueUnlinkIntent(f.db.execSql, input);
      return links.replaceDocumentLinks(f.db.execSql, f.documentId, ["trash"]);
    };
    try {
      await documents.ensureSchema(f.db.execSql);
      await documents.saveDocument(f.db.execSql, {
        id: "local",
        documentId: f.documentId,
        containerId: "source-container",
        accessEpoch: 1,
        snapshotEndVersion: "",
        text: "",
      });
      await links.replaceDocumentLinks(f.db.execSql, f.documentId, [
        "source-container",
      ]);
      f.db.statements.length = 0;
      await run();
      expect(f.db.statements.filter((sql) => /^begin/i.test(sql))).toHaveLength(
        1,
      );
      expect(
        f.db.statements.filter((sql) => /^commit/i.test(sql)),
      ).toHaveLength(1);
      const before = await snapshot(f.db.execSql);
      const table =
        operation === "projection"
          ? "document_container_projection"
          : operation === "move"
            ? "local_intents"
            : "document_intent_link_targets";
      await f.db.execSql(
        `CREATE TEMP TRIGGER fail_standalone BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'standalone failure'); END`,
      );
      await expectRejection(run(), table);
      expect(await snapshot(f.db.execSql)).toEqual(before);
      expect(
        await documents.loadDocument(f.db.execSql, "local"),
      ).not.toBeNull();
    } finally {
      await f.db.close();
      await f.db.remove();
    }
  },
);
