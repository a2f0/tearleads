import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { createSubtreePurgeScope } from "./purgeTreeScope";

for (const failure of ["unavailable", "integrity", "cancelled"]) {
  test(`scope checks preserve error classification (${failure})`, async () => {
    await withTestExecSql("purge-scope-errors", async (execSql) => {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.saveDocument(execSql, {
        id: "local",
        documentId: "remote",
        containerId: "child",
        accessEpoch: 1,
        documentKind: "note",
        snapshotEndVersion: "",
        text: "",
        title: "Note",
      });
      const document = await sqlDocumentsPersistence.loadDocument(
        execSql,
        "local",
      );
      if (!document) throw new Error("Missing document");
      const logs: string[] = [];
      const scope = createSubtreePurgeScope({
        containersById: new Map(),
        rootContainerId: "root",
        resolveProjectionUserKey: async () => null,
        persistence: {
          ...sqlContainerContentsPersistence,
          listUnsyncedMoveIntents: async () => {
            if (failure === "cancelled")
              assertProjectionVerificationCurrent(() => false);
            if (failure === "integrity")
              throw new KeyingVerificationError(
                "object_mismatch",
                "integrity evidence",
              );
            throw new Error("database unavailable");
          },
        },
        runtime: {
          infra: { execSql },
          util: {
            log: (message: string) => {
              logs.push(message);
            },
          },
        } as unknown as ContainerContentsWorkflowRuntime,
      });
      for (const check of [
        () => scope.allowsContainer("child"),
        () =>
          scope.allowsDocument({
            id: document.id,
            documentId: document.documentId,
            containerId: document.containerId,
            title: "Note",
            updatedAt: "2026-10-10T00:00:00.000Z",
          }),
      ]) {
        if (failure === "unavailable") expect(await check()).toBe(false);
        else
          await expect(check()).rejects.toThrow(
            failure === "integrity"
              ? "integrity evidence"
              : "generation expired",
          );
      }
      expect(logs).toHaveLength(failure === "unavailable" ? 2 : 0);
    });
  });
}
