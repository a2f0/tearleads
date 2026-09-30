import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPurgeCurrencyFixture } from "../../../test/helpers/documentPurgeCurrency";
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

test("a superseded purge path leaves its sync lane idle without repeated incidents", async () => {
  const database = await createTestExecSql("purge-currency-lane-retry");
  const domainScope = createDomainScope();
  const incidents: unknown[] = [];
  let fetches = 0;
  let deletions = 0;
  try {
    const { fixture, proof, advanceLater } = await createPurgeCurrencyFixture(
      database.execSql,
      0,
    );
    await advanceLater();
    const handler = createVerifiedRemoteDocumentDeletionHandler({
      apiClient: {
        getDocumentPurgeProof: async () => {
          fetches += 1;
          return proof;
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
      localId: "superseded-purge",
      run: () =>
        runWithSecurityIncidentReporting(
          async (error) => {
            incidents.push(error);
          },
          {
            operation: "document.sync",
            objectKind: "document",
            objectId: proof.documentId,
          },
          () => handler({ documentId: proof.documentId }),
        ),
    });
    const request = () =>
      requestDocumentSyncLaneAndWait({
        didCompleteRequest: () => deletions === 1,
        domainScope,
        localId: "superseded-purge",
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

    expect(await request()).toBe(false);
    expect(await waitForDomainSyncCoordinatorToSettle(domainScope)).toBe(true);
    expect(
      getDomainSyncCoordinatorSnapshot(domainScope).lanes[0],
    ).toMatchObject({
      lastAction: "failed",
      requested: false,
      runCount: 2,
    });
    expect(fetches).toBe(2);
    expect(deletions).toBe(0);
    expect(incidents).toEqual([]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    database.close();
  }
});
