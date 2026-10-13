import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { emptyVersionVector, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";

const sort = { key: "name", direction: "asc" } as const;

test("discovered documents stay in Downloads until their content supplies a type", async () => {
  const { execSql, close } = await createTestExecSql(
    "document-hydration-visibility",
  );
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await queries.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        containerId: "root",
        createdAt: "2026-10-13T00:00:00Z",
        documentId: "remote-file",
        linkedContainerIds: ["root", "shared"],
      },
    ]);
    await queries.replaceDocumentLinksBatch([
      { documentId: "remote-file", containerIds: ["root", "shared"] },
    ]);
    for (const containerId of ["root", "shared"]) {
      expect(
        await queries.listContainerDocumentSidebarWindow({
          containerId,
          limit: 1,
          offset: 0,
        }),
      ).toEqual({ rows: [], totalCount: 0 });
      expect(
        await queries.listContainerItemWindow({
          containerId,
          limit: 1,
          offset: 0,
          sort,
        }),
      ).toEqual({ rows: [], totalCount: 0 });
    }
    expect(await queries.loadDocumentSummary("remote-file")).toBeNull();
    expect(await queries.listPendingDownloads()).toEqual([
      {
        localId: "remote-file",
        documentId: "remote-file",
        objectKind: "document",
        title: null,
        reason: "initial",
        lastError: null,
      },
    ]);
    // Sync can still load the shell; only the UI read model hides it.
    const shell = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "remote-file",
    );
    if (!shell) throw new Error("Expected discovery shell");
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...shell,
      documentKind: "photo",
      title: "Holiday.jpg",
      snapshotEndVersion: emptyVersionVector(),
    });
    expect(await queries.loadDocumentSummary("remote-file")).toMatchObject({
      documentKind: "photo",
      title: "Holiday.jpg",
    });
    expect(
      await queries.listContainerDocumentSidebarWindow({
        containerId: "shared",
        limit: 1,
        offset: 0,
      }),
    ).toMatchObject({
      totalCount: 1,
      rows: [{ documentKind: "photo", title: "Holiday.jpg" }],
    });
    expect(await queries.listPendingDownloads()).toEqual([]);
    // A real title matching the former placeholder is still a valid note.
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...shell,
      title: "Syncing document...",
      snapshotEndVersion: emptyVersionVector(),
    });
    expect(await queries.loadDocumentSummary("remote-file")).not.toBeNull();
    await execSql(
      "UPDATE document_projection SET container_id = NULL WHERE local_id = ?",
      ["remote-file"],
    );
    await queries.replaceDocumentLinksBatch([
      { documentId: "remote-file", containerIds: [] },
    ]);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...shell,
      containerId: null,
    });
    expect(
      await queries.listContainerDocumentSidebarWindow({
        containerId: null,
        limit: 10,
        offset: 0,
      }),
    ).toEqual({ rows: [], totalCount: 0 });
    expect(
      await queries.hasOrphanedDocuments({ currentOrganizationId: null }),
    ).toBe(false);
  } finally {
    close();
  }
});

test("cold folders stay hidden until metadata arrives, including genuinely untitled folders", async () => {
  const { execSql, close } = await createTestExecSql(
    "folder-hydration-visibility",
  );
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const doc = await createContainerMetadataDocument("folder");
    const container = {
      id: "folder",
      parentId: "root",
      organizationId: "org",
      metadataDocumentId: "metadata-folder",
      name: "Untitled",
      icon: null,
    };
    const record = {
      id: "folder",
      documentId: "metadata-folder",
      accessEpoch: 1,
      snapshotEndVersion: "",
      metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
    };
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    expect(
      await queries.listContainerItemWindow({
        containerId: "root",
        limit: 10,
        offset: 0,
        sort,
      }),
    ).toEqual({ rows: [], totalCount: 0 });
    expect(await queries.listPendingDownloads()).toMatchObject([
      { objectKind: "container", title: null, reason: "initial" },
    ]);
    await execSql(
      "INSERT INTO document_sync_failures (app_kind, local_id, message, attempted_at) VALUES ('container-metadata', 'folder', 'Connection failed', '2026-10-13')",
    );
    expect(await queries.listPendingDownloads()).toMatchObject([
      { lastError: "Connection failed" },
    ]);
    writeContainerMetadataValue(doc, { name: "Untitled", icon: null });
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      container,
      { ...record, metadataUpdates: bytesToBase64(exportAllUpdates(doc)) },
    );
    expect(
      await queries.listContainerItemWindow({
        containerId: "root",
        limit: 10,
        offset: 0,
        sort,
      }),
    ).toMatchObject({
      totalCount: 1,
      rows: [{ itemKind: "container", name: "Untitled" }],
    });
    expect(await queries.listPendingDownloads()).toEqual([]);
  } finally {
    close();
  }
});
