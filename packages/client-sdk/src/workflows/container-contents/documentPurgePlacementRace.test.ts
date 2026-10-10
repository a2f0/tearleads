import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../test/helpers/withTestExecSql";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence as persistence } from "../../data/persistence/documents/documentsPersistence";
import { purgeLocalContainerDocument } from "./documentPurge";

for (const moved of [false, true]) {
  test(`local purge compares placement at its deletion transaction (${moved})`, async () => {
    await withTestExecSql("purge-placement-race", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await persistence.saveDocument(execSql, {
        id: "local-note",
        documentId: null,
        containerId: "selected",
        accessEpoch: 1,
        documentKind: "note",
        snapshotEndVersion: "",
        text: "Keep restored work",
        title: "Note",
      });
      let deletionAttempts = 0;
      const result = await purgeLocalContainerDocument({
        expectedContainerId: "selected",
        noteId: "local-note",
        persistence: {
          ...persistence,
          deleteDocumentIfMatches: async (
            lockedExecSql,
            expected,
            deleteProjection,
          ) => {
            deletionAttempts += 1;
            expect(expected.containerId).toBe("selected");
            if (moved)
              await lockedExecSql(
                "UPDATE document_projection SET container_id = ? WHERE local_id = ?",
                ["restored", expected.id],
              );
            return persistence.deleteDocumentIfMatches(
              lockedExecSql,
              expected,
              deleteProjection,
            );
          },
        },
        runtime: {
          infra: {
            execSql,
            blobStore: null as never,
            dbStatus: "ready",
            documentProjectors: defaultDocumentProjectorRegistry,
          },
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        },
      });
      expect(deletionAttempts).toBe(1);
      expect(result !== null).toBe(!moved);
      expect(
        (await persistence.loadDocument(execSql, "local-note"))?.containerId ??
          null,
      ).toBe(moved ? "restored" : null);
    });
  });
}
