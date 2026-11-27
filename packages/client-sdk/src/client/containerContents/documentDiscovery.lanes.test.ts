import { afterEach, expect, spyOn, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import type { SyncWatermark } from "@tearleads/validators/response";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../data/persistence/documents/documentDiscoveryReset";
import { DatabaseUnavailableError } from "../../data/sqlite/availability/databaseUnavailable";
import { clientSqlTables, containers } from "../../data/sqlite/schema";
import { documentContainerProjection } from "../../data/sqlite/schema/documentProjectionSchema";
import { documents } from "../../data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { laneApi } from "../../workflows/container-contents/documentDiscovery/documentDiscovery.testUtils";
import * as documentLaneDiscovery from "../../workflows/container-contents/documentDiscovery/documentLaneDiscovery";
import * as tombstoneEvidence from "../../workflows/container-contents/tombstones/documentTombstoneEvidence";
import {
  type ContainerDocumentDiscoveryOutcome,
  discoverContainerDocumentLanesForRuntime,
} from "./documentDiscovery";
import * as owedRecordSyncs from "./owedRecordSyncs";

const AT = "2026-10-14T00:00:00.000Z";
const LANES = ["lane-a", "lane-b", "lane-c"] as const;

const restorers: Array<() => void> = [];
afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
});

/** Each lane lists one signed document of its own on its first page. */
function laneApiFor(containerIds: ReadonlyArray<string>) {
  return laneApi(async (containerId, { watermark }) =>
    watermark?.id === `${containerId}:final` ||
    !containerIds.includes(containerId)
      ? { hasMore: false, items: [], nextWatermark: null, tombstones: [] }
      : {
          hasMore: false,
          items: [
            {
              createdAt: AT,
              currentAccessEpoch: 1,
              currentAccessStateHash: `head:${containerId}:doc`,
              updateCount: 0,
              effectiveAccessLevel: "write",
              id: `${containerId}:doc`,
              linkedContainerIds: [containerId],
              referencedPrincipals: [],
              updatedAt: AT,
            },
          ],
          nextWatermark: { id: `${containerId}:final`, updatedAt: AT },
          tombstones: [],
        },
  );
}

/** Signed heads come from a stub; `failFor` makes one lane's verification throw. */
function stubSignedHeads(failFor?: string) {
  const spy = spyOn(
    tombstoneEvidence,
    "createDocumentHeadLinkSetLoader",
  ).mockReturnValue(async (documentId) => {
    const containerId = documentId.replace(/:doc$/u, "");
    if (containerId === failFor)
      throw new Error(`head load failed for ${containerId}`);
    return {
      accessEpoch: 1,
      accessStateHash: `head:${documentId}`,
      linkedContainerIds: [containerId],
      organizationId: "org",
    };
  });
  restorers.push(() => spy.mockRestore());
}

async function createLanes() {
  const native = createNativeTestExecSql();
  await ensureSqlTables(native.execSql, clientSqlTables);
  const { db } = getClientSQLitePersistenceRuntime(native.execSql);
  for (const id of LANES)
    await db.insert(containers).values({
      id,
      organizationId: "org",
      parentId: null,
      metadataDocumentId: `metadata-${id}`,
      localCreatedAt: AT,
      localUpdatedAt: AT,
    });
  const discover = (
    onOutcome?: (outcome: ContainerDocumentDiscoveryOutcome) => Promise<void>,
    logError?: (message: string | Error, cause?: unknown) => void,
  ) => {
    const input = createWorkflowInputFixture({
      apiClient: laneApiFor(LANES) as never,
      execSql: native.execSql,
      ...(logError ? { logError } : {}),
    });
    return discoverContainerDocumentLanesForRuntime({
      onOutcome,
      requests: LANES.map((containerId) => ({ containerId })),
      runtimeService: createInternalRuntimeFixture(() => input),
    });
  };
  const persisted = async () => ({
    cursors: await Promise.all(
      LANES.map(
        (id): Promise<SyncWatermark | null> =>
          new ContainerSyncWatermarkRepository(native.execSql).loadWatermark(
            containerContentsSyncLane(id),
          ),
      ),
    ),
    documentIds: (
      await db.select({ documentId: documents.documentId }).from(documents)
    )
      .flatMap(({ documentId }) => (documentId ? [documentId] : []))
      .sort(),
    links: (
      await db
        .select({
          containerId: documentContainerProjection.containerId,
          documentId: documentContainerProjection.documentId,
        })
        .from(documentContainerProjection)
    )
      .map(({ containerId, documentId }) => `${documentId}@${containerId}`)
      .sort(),
  });
  return { db, discover, native, persisted };
}

test("runtime lanes listed before a reset persist nothing after it", async () => {
  stubSignedHeads();
  const { db, discover, native, persisted } = await createLanes();
  try {
    let reset = false;
    await discover(async (outcome) => {
      if (outcome.containerId !== "lane-a" || reset) return;
      reset = true;
      await db.transaction((tx) =>
        clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
          containerIds: [...LANES],
          documentIds: [],
        }),
      );
    });

    // Lane A completed before the reset. B and C were listed in the same
    // pre-reset request, so their documents, links and cursors never land.
    expect(await persisted()).toEqual({
      cursors: [{ id: "lane-a:final", updatedAt: AT }, null, null],
      documentIds: ["lane-a:doc"],
      links: ["lane-a:doc@lane-a"],
    });

    // The next generation lists B and C from their untouched cursors.
    await discover();
    expect(await persisted()).toEqual({
      cursors: LANES.map((id) => ({ id: `${id}:final`, updatedAt: AT })),
      documentIds: LANES.map((id) => `${id}:doc`),
      links: LANES.map((id) => `${id}:doc@${id}`),
    });
  } finally {
    native.close();
  }
});

test("a runtime lane whose verification fails leaves healthy lanes applied", async () => {
  stubSignedHeads("lane-b");
  const { discover, native, persisted } = await createLanes();
  try {
    const outcomes = await discover();

    expect(
      outcomes.map(({ containerId, status }) => [containerId, status]),
    ).toEqual([
      ["lane-a", "fulfilled"],
      ["lane-b", "rejected"],
      ["lane-c", "fulfilled"],
    ]);
    // Each healthy lane holds its own cursor and document; B holds neither.
    expect(await persisted()).toEqual({
      cursors: [
        { id: "lane-a:final", updatedAt: AT },
        null,
        { id: "lane-c:final", updatedAt: AT },
      ],
      documentIds: ["lane-a:doc", "lane-c:doc"],
      links: ["lane-a:doc@lane-a", "lane-c:doc@lane-c"],
    });
  } finally {
    native.close();
  }
});

test("a lane request that cannot be settled is reported unless the database closed", async () => {
  stubSignedHeads();
  const { discover, native } = await createLanes();
  try {
    await documentLaneDiscovery.requestDocumentLaneListings(native.execSql, [
      "lane-a",
      "lane-b",
    ]);
    const failure = new Error("settle failed");
    const spy = spyOn(
      documentLaneDiscovery,
      "settleOwedDocumentLaneListing",
    ).mockImplementation(async (_execSql, owed) => {
      throw owed.containerId === "lane-a"
        ? new DatabaseUnavailableError("database closed")
        : failure;
    });
    restorers.push(() => spy.mockRestore());
    const logged: unknown[] = [];

    const outcomes = await discover(undefined, (message, error) => {
      logged.push([message, error]);
    });

    // Each listing applied all the same; only lane b's failure is news.
    expect(outcomes.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(logged).toEqual([["Document lane request settle failed", failure]]);
  } finally {
    native.close();
  }
});

test("an owed read that cannot be requested is reported unless the database closed", async () => {
  stubSignedHeads();
  const { db, discover, native } = await createLanes();
  try {
    // Lanes a and b list a document this device holds under an older head,
    // so each listing owes its record a read.
    for (const id of ["lane-a", "lane-b"]) {
      await db.insert(documents).values({
        appKind: "documents",
        contentKeyBundle: JSON.stringify({ linkSetManifestHash: "head:old" }),
        documentId: `${id}:doc`,
        localId: `local-${id}`,
        updatedAt: AT,
      });
    }
    const failure = new Error("owed read request failed");
    const spy = spyOn(
      owedRecordSyncs,
      "requestRegisteredDocumentRemoteSyncs",
    ).mockImplementation(async (_domainScope, _execSql, documentIds) => {
      throw documentIds.includes("lane-a:doc")
        ? new DatabaseUnavailableError("database closed")
        : failure;
    });
    restorers.push(() => spy.mockRestore());
    const logged: unknown[] = [];

    const outcomes = await discover(undefined, (message, error) => {
      logged.push([message, error]);
    });
    await Promise.resolve();

    // The listings applied all the same; only lane b's failure is news.
    expect(outcomes.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(spy.mock.calls.map(([, , documentIds]) => documentIds)).toEqual([
      ["lane-a:doc"],
      ["lane-b:doc"],
    ]);
    expect(logged).toEqual([
      ["Owed document reads were not requested", failure],
    ]);
  } finally {
    native.close();
  }
});
