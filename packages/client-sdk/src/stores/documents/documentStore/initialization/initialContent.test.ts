import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import { readStoredDocumentState } from "../../../../data/documents/documentKinds";
import { listDocumentRows } from "../../../../data/documents/documentRowList";
import {
  defaultDocumentsPersistence,
  documentCreateSeedCandidate,
  listPendingDocumentUpdates,
} from "../../../../workflows/documents";
import type { DocumentStoreOpenOptions, DocumentsRuntime } from "../../types";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { createDocumentStore } from "../index";
import { createDocumentStoreState } from "../state";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
  PDF_FIELDS,
  PDF_UPLOAD,
} from "./deferredInitialUpdate.testFixtures";
import { ensureDocumentStoreReady } from "./index";
import { assertInitialContentFitsKind } from "./initialContent";

const ENV_ROWS = [
  { key: "API_URL", value: "https://example.test" },
  { key: "DEBUG", value: "false" },
];

function openStore(input: {
  execSql: DocumentsRuntime["infra"]["execSql"];
  kind: string;
  localId: string;
  options?: DocumentStoreOpenOptions;
}) {
  return createDocumentStore(
    input.localId,
    offlineAttachRuntime({
      blobStore: createMemoryBlobStore(),
      canAttach: true,
      execSql: input.execSql,
    }),
    defaultDocumentsPersistence,
    null,
    "",
    input.kind,
    input.options,
  );
}

/** Decodes every queued update into a fresh peer, as a reader would. */
async function readQueued(
  execSql: DocumentsRuntime["infra"]["execSql"],
  localId: string,
) {
  const queued = await listPendingDocumentUpdates({
    execSql,
    localId,
    persistence: defaultDocumentsPersistence,
  });
  const reader = await createDocument("reader");
  importUpdates(
    reader,
    queued.map((row) => base64ToBytes(row.updateData)),
  );
  const decoded = readStoredDocumentState(reader);
  return {
    attachmentNames: getDocumentAttachments(reader).map((file) => file.name),
    documentKind: decoded.documentKind,
    rows: listDocumentRows(reader).map((row) => row.fields),
    structuredFields: decoded.structuredFields,
    updateCount: queued.length,
  };
}

test("a birth carries initial fields and rows as the document's only update", async () => {
  const { close, execSql } = await createTestExecSql("initial-content-birth");
  try {
    await ensureDeferredBirthSchema(execSql);
    const store = openStore({
      execSql,
      kind: "env_file",
      localId: "imported-env",
      options: {
        initialRows: ENV_ROWS,
        initialStructuredFields: { fileName: ".env", stale: undefined },
      },
    });
    expect(await store.ensureInitialized()).toBe(true);

    expect(await readQueued(execSql, "imported-env")).toEqual({
      attachmentNames: [],
      documentKind: "env_file",
      rows: ENV_ROWS,
      structuredFields: { fileName: ".env" },
      updateCount: 1,
    });
    expect(store.getSnapshot().rows.map((row) => row.fields)).toEqual(ENV_ROWS);
  } finally {
    close();
  }
});

test("seeded fields and rows survive a reload from durable history", async () => {
  const { close, execSql } = await createTestExecSql("initial-content-reload");
  try {
    await ensureDeferredBirthSchema(execSql);
    const created = openStore({
      execSql,
      kind: "env_file",
      localId: "reloaded-env",
      options: {
        initialRows: ENV_ROWS,
        initialStructuredFields: { fileName: ".env" },
      },
    });
    expect(await created.ensureInitialized()).toBe(true);

    const reloaded = openStore({
      execSql,
      kind: "env_file",
      localId: "reloaded-env",
    });
    expect(await reloaded.ensureInitialized()).toBe(true);

    const snapshot = reloaded.getSnapshot();
    expect(snapshot.structuredFields).toMatchObject({ fileName: ".env" });
    expect(snapshot.rows.map((row) => row.fields)).toEqual(ENV_ROWS);
  } finally {
    close();
  }
});

test("initial content is ignored when the record already exists", async () => {
  const { close, execSql } = await createTestExecSql("initial-content-exists");
  try {
    await ensureDeferredBirthSchema(execSql);
    const created = openStore({
      execSql,
      kind: "env_file",
      localId: "existing-env",
      options: { initialStructuredFields: { fileName: ".env" } },
    });
    expect(await created.ensureInitialized()).toBe(true);

    const reopened = openStore({
      execSql,
      kind: "env_file",
      localId: "existing-env",
      options: {
        initialRows: ENV_ROWS,
        initialStructuredFields: { fileName: "other.env" },
      },
    });
    expect(await reopened.ensureInitialized()).toBe(true);

    expect(await readQueued(execSql, "existing-env")).toMatchObject({
      rows: [],
      structuredFields: { fileName: ".env" },
      updateCount: 1,
    });
    expect(reopened.getSnapshot().rows).toEqual([]);
  } finally {
    close();
  }
});

test("rewriting the seeded fields queues nothing further", async () => {
  const { close, execSql } = await createTestExecSql("initial-content-rewrite");
  try {
    await ensureDeferredBirthSchema(execSql);
    const fields = { firstName: "Ada", lastName: "Lovelace", nickname: "" };
    const store = openStore({
      execSql,
      kind: "contact",
      localId: "new-contact",
      options: { initialStructuredFields: fields },
    });

    // Callers whose record may already exist keep their idempotent write; on
    // a fresh birth that already holds the values, Loro records no operation.
    await store.setStructuredFields("contact", fields);

    expect(await readQueued(execSql, "new-contact")).toMatchObject({
      documentKind: "contact",
      structuredFields: fields,
      updateCount: 1,
    });
  } finally {
    close();
  }
});

test("a deferred birth carries its initial fields with the attach", async () => {
  const { close, execSql } = await createTestExecSql("initial-content-attach");
  try {
    await ensureDeferredBirthSchema(execSql);
    const store = openStore({
      execSql,
      kind: "pdf",
      localId: "imported-pdf",
      options: {
        deferInitialUpdate: true,
        initialStructuredFields: PDF_FIELDS,
      },
    });
    expect(await store.ensureInitialized()).toBe(true);
    expect((await readQueued(execSql, "imported-pdf")).updateCount).toBe(0);

    await store.attachFiles([PDF_UPLOAD]);

    expect(await readQueued(execSql, "imported-pdf")).toEqual({
      attachmentNames: ["report.pdf"],
      documentKind: "pdf",
      rows: [],
      structuredFields: PDF_FIELDS,
      updateCount: 1,
    });
  } finally {
    close();
  }
});

test("initial fields need a structured kind", () => {
  expect(() =>
    assertInitialContentFitsKind(
      { initialStructuredFields: { title: "x" } },
      "note",
    ),
  ).toThrow("Initial structured fields need a structured kind");
  // An empty or all-undefined patch writes nothing, so any kind accepts it.
  expect(() =>
    assertInitialContentFitsKind(
      { initialStructuredFields: { title: undefined } },
      "note",
    ),
  ).not.toThrow();
  expect(() =>
    assertInitialContentFitsKind({ initialRows: ENV_ROWS }, "note"),
  ).not.toThrow();
});

test("a birth with fields and rows is the create's seed", async () => {
  const { close, execSql } = await createTestExecSql("initial-content-seed");
  try {
    await ensureDeferredBirthSchema(execSql);
    const state = createDocumentStoreState(
      "seeded-env",
      offlineAttachRuntime({
        blobStore: createMemoryBlobStore(),
        canAttach: true,
        execSql,
      }),
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
      "",
      "env_file",
    );
    state.initialContent = {
      initialRows: ENV_ROWS,
      initialStructuredFields: { fileName: ".env" },
    };
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    if (!state.doc) throw new Error("Expected an initialized document");

    // One row from empty to the document's version: the first sync pass sends
    // it inside the create request instead of syncing it afterwards.
    const pendingUpdates = await listPendingDocumentUpdates({
      execSql,
      localId: "seeded-env",
      persistence: defaultDocumentsPersistence,
    });
    expect(
      documentCreateSeedCandidate({
        documentVersion: encodeVersionVector(state.doc),
        pendingUpdates,
      }),
    ).toBe(pendingUpdates[0] ?? null);
    expect(pendingUpdates).toHaveLength(1);
  } finally {
    close();
  }
});
