import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  accessManifestCheckpoints,
  clientSqlTables,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";

for (const cached of [false, true]) {
  for (const organizationId of ["replacement", undefined]) {
    test(`discovery cannot adopt another organization's head (cached=${cached}, scope=${organizationId})`, async () => {
      const { close, execSql } = await createTestExecSql(
        "discovery-organization",
      );
      try {
        await ensureSqlTables(execSql, clientSqlTables);
        const { db } = getClientSQLitePersistenceRuntime(execSql);
        // This is the post-signature boundary: both organizations' heads have
        // valid durable pins, and recovery reused the local object identifiers.
        await db.insert(accessManifestCheckpoints).values(
          ["old", "replacement"].map((org) => ({
            objectKind: "document" as const,
            objectId: "document",
            organizationId: org,
            epoch: 1,
            manifestHash: `${org}-hash`,
            updatedAt: "2026-09-28",
          })),
        );
        let now = 0;
        let calls = 0;
        let head = {
          organizationId: "old",
          accessEpoch: 1,
          accessStateHash: "old-hash",
          linkedContainerIds: ["container"],
        };
        const store = createDocumentDiscoveryEvidenceStore(execSql, () => now);
        if (cached) await store.saveHead("document", head, await store.begin());
        const verify = createDiscoveredDocumentVerifier(
          organizationId,
          async () => {
            calls++;
            return head;
          },
          async () => 0,
          store,
        );
        const candidate = {
          documentId: "document",
          containerId: "container",
          listedContainerIds: ["container"],
          linkedContainerIds: ["container"],
          accessEpoch: 1,
          accessStateHash: "old-hash",
          createdAt: "2026-09-28",
        };
        const refused = await verify(
          [candidate],
          ["container"],
          await store.begin(),
        );
        expect(refused.inputs).toEqual([]);
        expect(await refused.commit()).toBe(false);
        expect(await store.hasPending(["container"])).toBe(true);
        expect(calls).toBe(cached ? 0 : 1);

        now = 15 * 60_000 + 1;
        head = {
          ...head,
          organizationId: "replacement",
          accessStateHash: "replacement-hash",
        };
        const retried = await verify(
          [{ ...candidate, accessStateHash: "replacement-hash" }],
          ["container"],
          await store.begin(),
        );
        expect(retried.inputs).toHaveLength(organizationId ? 1 : 0);
        expect(await retried.commit()).toBe(Boolean(organizationId));
      } finally {
        close();
      }
    });
  }
}
