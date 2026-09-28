import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPurgeChainFixture } from "../../../test/helpers/documentPurgeChain";
import { createDomainScope } from "../../data/domainScope";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  disposeDomainSyncCoordinator,
  getDomainSyncCoordinatorSnapshot,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import { createVerifiedRemoteDocumentDeletionHandler } from "./purge";
import {
  registerDocumentSyncLane,
  requestDocumentSyncLaneAndWait,
} from "./syncLane";

test("unavailable purge history leaves its sync lane idle until another request", async () => {
  const fixture = await createPurgeChainFixture();
  const database = await createTestExecSql("purge-unavailable-lane-retry");
  const domainScope = createDomainScope();
  const incidents: unknown[] = [];
  let historyAvailable = false;
  let fetches = 0;
  let deletions = 0;
  try {
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async () => {
          fetches += 1;
          return historyAvailable
            ? fixture.proof
            : { ...fixture.proof, documentManifestPredecessors: [] };
        },
      },
      execSql: database.execSql,
      expectedOrganizationId: fixture.author.organizationId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      onVerifiedDeletion: async ({ commitPurgeProof }) => {
        await commitPurgeProof(database.execSql);
        deletions += 1;
      },
    });
    const lane = registerDocumentSyncLane({
      domainScope,
      localId: "unavailable-history",
      run: () =>
        runWithSecurityIncidentReporting(
          async (error) => {
            incidents.push(error);
          },
          {
            operation: "document.sync",
            objectKind: "document",
            objectId: fixture.proof.documentId,
          },
          () => handler({ documentId: fixture.proof.documentId }),
        ),
    });
    const request = () =>
      requestDocumentSyncLaneAndWait({
        didCompleteRequest: () => deletions === 1,
        domainScope,
        localId: "unavailable-history",
        request: () => lane.requestSync(),
      });

    expect(await request()).toBe(false);
    expect(await waitForDomainSyncCoordinatorToSettle(domainScope)).toBe(true);
    expect(
      getDomainSyncCoordinatorSnapshot(domainScope).lanes[0],
    ).toMatchObject({
      lastAction: "failed",
      requested: false,
      runCount: 1,
    });
    expect(fetches).toBe(1);
    expect(deletions).toBe(0);
    expect(incidents).toEqual([]);

    historyAvailable = true;
    expect(await request()).toBe(true);
    expect(fetches).toBe(2);
    expect(deletions).toBe(1);
    expect(incidents).toEqual([]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    database.close();
  }
});
