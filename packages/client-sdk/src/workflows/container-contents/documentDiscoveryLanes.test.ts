import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { SyncWatermark } from "@tearleads/validators/response";
import type { DiscoveredDocumentInput } from "../../data/documents/documentSummary";
import {
  containerContentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../data/persistence/documents/documentDiscoveryReset";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";
import {
  type ContainerDocumentDiscoveryLane,
  type ContainerDocumentDiscoveryOutcomeHandler,
  discoverContainerDocumentLanes,
} from "./documentDiscoveryLanes";
import type {
  ContainerDocumentLaneLister,
  ListContainerDocumentsResponse,
} from "./documentDiscoveryTypes";

const AT = "2026-10-14T00:00:00.000Z";
const LANES = ["lane-a", "lane-b", "lane-c"] as const;

function cursor(id: string): SyncWatermark {
  return { id, updatedAt: AT };
}

/**
 * A nonempty first listing per lane (`lane-a` spans two pages); a lane resumed
 * from its own final cursor has no further changes.
 */
function page(containerId: string, watermark: SyncWatermark | null) {
  if (watermark?.id === `${containerId}:final`) {
    return { hasMore: false, items: [], nextWatermark: null, tombstones: [] };
  }
  const second = containerId === "lane-a" && watermark?.id === "lane-a:page-1";
  const documentId = `${containerId}:${second ? "doc-2" : "doc-1"}`;
  const response: ListContainerDocumentsResponse = {
    hasMore: containerId === "lane-a" && !second,
    items: [
      {
        createdAt: AT,
        currentAccessEpoch: 1,
        currentAccessStateHash: `head:${documentId}`,
        id: documentId,
        linkedContainerIds: [containerId],
        referencedPrincipals: [],
        updatedAt: AT,
      },
    ],
    nextWatermark: cursor(
      containerId === "lane-a" && !second
        ? "lane-a:page-1"
        : `${containerId}:final`,
    ),
    tombstones: [],
  };
  return response;
}

const requestedCursors: string[] = [];
const listLanes: ContainerDocumentLaneLister = async (lanes) =>
  lanes.map(({ containerId, watermark }) => {
    requestedCursors.push(`${containerId}@${watermark?.id ?? "start"}`);
    return page(containerId, watermark);
  });

interface Harness {
  readonly applied: Array<{ containerId: string; documentIds: string[] }>;
  readonly execSql: ExecSql;
  readonly store: ReturnType<typeof createDocumentDiscoveryEvidenceStore>;
  discover(input?: {
    readonly failUpsertFor?: string;
    readonly onOutcome?: ContainerDocumentDiscoveryOutcomeHandler;
  }): ReturnType<typeof discoverContainerDocumentLanes>;
  savedCursors(): Promise<Array<SyncWatermark | null>>;
}

async function createHarness(execSql: ExecSql): Promise<Harness> {
  const store = createDocumentDiscoveryEvidenceStore(execSql);
  const applied: Harness["applied"] = [];
  const lane = (
    containerId: string,
    failUpsertFor: string | undefined,
  ): ContainerDocumentDiscoveryLane => ({
    ...nullContainerDocumentWatermarks,
    containerId,
    replaceDocumentLinksBatch: async () => {},
    saveContainerDocumentWatermark: async (id, watermark) => {
      await sqlContainerSyncWatermarkPersistence.saveWatermark(
        execSql,
        containerContentsSyncLane(id),
        watermark,
      );
    },
    upsertDiscoveredDocuments: async (
      inputs: ReadonlyArray<DiscoveredDocumentInput>,
    ) => {
      if (containerId === failUpsertFor)
        throw new Error(`local apply failed for ${containerId}`);
      applied.push({
        containerId,
        documentIds: inputs.map((input) => input.documentId),
      });
      return inputs.map((input) => ({
        containerId: input.containerId,
        documentId: input.documentId,
        id: input.documentId,
        title: "doc",
        updatedAt: AT,
      }));
    },
    verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
      "org",
      async (documentId) => ({
        accessEpoch: 1,
        accessStateHash: `head:${documentId}`,
        linkedContainerIds: [documentId.split(":")[0] ?? ""],
        organizationId: "org",
      }),
      async () => 0,
      store,
    ),
  });
  return {
    applied,
    execSql,
    store,
    discover: async (input = {}) =>
      discoverContainerDocumentLanes({
        generation: await store.begin(),
        lanes: LANES.map((id) => lane(id, input.failUpsertFor)),
        listContainerDocumentLanes: listLanes,
        loadContainerDocumentWatermark: (id) =>
          sqlContainerSyncWatermarkPersistence.loadWatermark(
            execSql,
            containerContentsSyncLane(id),
          ),
        onOutcome: input.onOutcome,
      }),
    savedCursors: () =>
      Promise.all(
        LANES.map((id) =>
          sqlContainerSyncWatermarkPersistence.loadWatermark(
            execSql,
            containerContentsSyncLane(id),
          ),
        ),
      ),
  };
}

test("a reset between lane applications rejects every later lane's stale listing", async () => {
  const { close, execSql } = await createTestExecSql("discovery-lanes-reset");
  try {
    const harness = await createHarness(execSql);
    let reset = false;
    const outcomes = await harness.discover({
      onOutcome: async (outcome) => {
        if (outcome.containerId !== "lane-a" || reset) return;
        reset = true;
        await getClientSQLitePersistenceRuntime(execSql).db.transaction((tx) =>
          clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
            containerIds: [...LANES],
            documentIds: [],
          }),
        );
      },
    });

    // Lane A applied before the reset; B and C were listed before it too, so
    // their pages are stale and nothing from them may land afterwards.
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? outcome.value?.length : "rejected",
      ),
    ).toEqual([2, undefined, undefined]);
    expect(harness.applied).toEqual([
      { containerId: "lane-a", documentIds: ["lane-a:doc-1", "lane-a:doc-2"] },
    ]);
    expect(await harness.savedCursors()).toEqual([
      cursor("lane-a:final"),
      null,
      null,
    ]);
    expect(await harness.store.hasPending(["lane-b", "lane-c"])).toBe(false);
    expect(
      await harness.store.loadHead("lane-b:doc-1", "head:lane-b:doc-1"),
    ).toBeNull();

    // A fresh generation re-lists B and C from their untouched cursors and
    // applies each from its own page; A resumes from its own final cursor.
    harness.applied.length = 0;
    requestedCursors.length = 0;
    await harness.discover();
    expect(requestedCursors).toEqual([
      "lane-a@lane-a:final",
      "lane-b@start",
      "lane-c@start",
    ]);
    expect(harness.applied).toEqual([
      { containerId: "lane-b", documentIds: ["lane-b:doc-1"] },
      { containerId: "lane-c", documentIds: ["lane-c:doc-1"] },
    ]);
    expect(await harness.savedCursors()).toEqual(
      LANES.map((id) => cursor(`${id}:final`)),
    );
  } finally {
    close();
  }
});

test("a lane whose local apply fails keeps its cursor while healthy lanes advance", async () => {
  const { close, execSql } = await createTestExecSql("discovery-lanes-failure");
  try {
    const harness = await createHarness(execSql);
    requestedCursors.length = 0;
    const outcomes = await harness.discover({ failUpsertFor: "lane-b" });
    // Every first page in one request; only A's continuation follows.
    expect(requestedCursors).toEqual([
      "lane-a@start",
      "lane-b@start",
      "lane-c@start",
      "lane-a@lane-a:page-1",
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(harness.applied).toEqual([
      { containerId: "lane-a", documentIds: ["lane-a:doc-1", "lane-a:doc-2"] },
      { containerId: "lane-c", documentIds: ["lane-c:doc-1"] },
    ]);
    // Each healthy lane stores its own final cursor; B's never advanced.
    expect(await harness.savedCursors()).toEqual([
      cursor("lane-a:final"),
      null,
      cursor("lane-c:final"),
    ]);
    // B's verified candidate stays durably pending for the next pass.
    expect(await harness.store.hasPending(["lane-b"])).toBe(true);
    expect(await harness.store.hasPending(["lane-a", "lane-c"])).toBe(false);

    // Only B is listed from the start again; A and C resume from their own
    // final cursors and have nothing new.
    harness.applied.length = 0;
    requestedCursors.length = 0;
    await harness.discover();
    expect(requestedCursors).toEqual([
      "lane-a@lane-a:final",
      "lane-b@start",
      "lane-c@lane-c:final",
    ]);
    expect(harness.applied).toEqual([
      { containerId: "lane-b", documentIds: ["lane-b:doc-1"] },
    ]);
    expect(await harness.savedCursors()).toEqual(
      LANES.map((id) => cursor(`${id}:final`)),
    );
    expect(await harness.store.hasPending([...LANES])).toBe(false);
  } finally {
    close();
  }
});
