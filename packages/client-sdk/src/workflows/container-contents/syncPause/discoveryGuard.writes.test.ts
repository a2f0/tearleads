import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence as links } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import {
  clearDocumentDiscoveryEvidenceOnRemoteReset,
  createDocumentDiscoveryEvidenceStore,
} from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../../data/persistence/documents/documentsPersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { guardDocumentDiscoveryWrites } from "./discoveryGuard";

test.each(["documents", "links"] as const)(
  "a queued %s write rechecks its generation after the reset lock releases",
  async (kind) => {
    const { execSql, close } = await createTestExecSql(
      `discovery-${kind}-race`,
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await links.ensureSchema(execSql);
      const evidence = createDocumentDiscoveryEvidenceStore(execSql);
      const generation = await evidence.begin();
      const candidate = {
        accessEpoch: 1,
        containerId: "current",
        createdAt: "2026-01-01T00:00:00.000Z",
        documentId: "document",
        linkedContainerIds: ["current"],
      };
      if (kind === "links") {
        await upsertDiscoveredDocuments(execSql, [candidate]);
        await links.replaceDocumentLinks(execSql, "document", ["current"]);
      }
      const guarded = guardDocumentDiscoveryWrites({
        execSql,
        isPaused: () => false,
        verifyDiscoveredDocuments: async () => ({
          inputs: [],
          commit: async () => true,
          isCurrent: () => evidence.isCurrent(generation),
        }),
      });
      const write = (current: () => Promise<boolean>) =>
        kind === "documents"
          ? guarded.upsertDiscoveredDocuments([candidate], current)
          : guarded.replaceDocumentLinksBatch(
              [
                {
                  accessEpoch: 1,
                  containerIds: ["stale"],
                  documentId: "document",
                },
              ],
              current,
            );
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const cleanup = runSerializedSqlMutation(execSql, async (locked) => {
        await held;
        await getClientSQLitePersistenceRuntime(locked).db.transaction((tx) =>
          clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
            containerIds: ["current"],
            documentIds: [],
          }),
        );
      });
      const stale = write(() => evidence.isCurrent(generation));
      release();
      await cleanup;
      await stale;
      const read = async () =>
        kind === "documents"
          ? (
              await sqlDocumentsPersistence.listDocumentSummaries(execSql)
            ).rows.map((row) => row.documentId)
          : await links.listLinkedContainerIds(execSql, "document");
      expect(await read()).toEqual(kind === "documents" ? [] : ["current"]);
      // Prove these are writable inputs once a new listing is current.
      const next = await evidence.begin();
      await write(() => evidence.isCurrent(next));
      expect(await read()).toEqual(
        kind === "documents" ? ["document"] : ["stale"],
      );
    } finally {
      close();
    }
  },
);
