import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/workflows/cachedContainerHydrationRuntime";
import { sqlContainerContentsPersistence } from "../../../../data/persistence/container-contents/containerContentsPersistence";
import {
  ContainerSyncWatermarkRepository,
  containerParentSyncLane,
} from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { createClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../../../data/sqlite/sqlSchema";
import { testContainerMetadataWriter } from "../../metadata/metadata.testFixtures";
import {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "../../metadata/metadataPersistence";
import { hydrateStoredContainerState } from "../../storedContainerState";
import { hydrateRemoteContainers } from "../index";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "../types";

const CREATED = "2026-01-01T00:00:01.000Z";
const RECORDED = "2026-01-01T00:00:02.000Z";
const LATER = "2026-01-01T00:00:03.000Z";
const SAVED_ROOT_WATERMARK = { id: "root-saved", updatedAt: RECORDED };
const ROOT_WATERMARK_SQL = "container_sync_watermarks";

const FOLDER: RemoteContainer = {
  createdAt: CREATED,
  effectiveAccessLevel: "write",
  id: "container-1",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-1",
  metadataDocumentId: "metadata-1",
  metadataReferencedPrincipals: [],
  // A document write republished the row; the folder's metadata is unread.
  metadataUpdateCount: 0,
  organizationId: "organization-1",
  // Granted directly, so the root lane serves it; its parent is not held.
  parentId: "parent-1",
  systemSlot: null,
  updatedAt: LATER,
};

type Lane = ListContainerParentLanesRequest["lanes"][number];

/**
 * Crawls a tree that holds `FOLDER`, which the root lane serves; that lane
 * has a saved watermark. `serve` answers each lane with the rows it holds past the
 * requested watermark. Returns the order of the durable steps.
 */
async function crawl(
  options: { readonly resetRootLaneWatermark?: boolean },
  serve: (lane: Lane) => ReadonlyArray<RemoteContainer>,
) {
  const steps: string[] = [];
  let crawling = false;
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "document-lane-debt",
  });
  const { execSql } = createClientSQLitePersistenceRuntime({
    exec: async (statement) => {
      if (
        crawling &&
        statement.sql.includes(ROOT_WATERMARK_SQL) &&
        /^\s*INSERT/iu.test(statement.sql)
      ) {
        steps.push("save watermark");
      }
      return {
        rows: execDatabaseStatement(db, statement) as Array<
          SqlRow | SqlArrayRow
        >,
      };
    },
  });
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "write",
        icon: null,
        id: FOLDER.id,
        metadataDocumentId: FOLDER.metadataDocumentId,
        name: "Folder",
        organizationId: FOLDER.organizationId,
        parentId: FOLDER.parentId,
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-1",
        documentId: FOLDER.metadataDocumentId,
        id: FOLDER.id,
        lastCommitLsn: "0/16B3748",
        metadataUpdates: "",
        snapshotEndVersion: "",
      },
      {
        localUpdatedAt: RECORDED,
        serverTimestamps: { createdAt: CREATED, updatedAt: RECORDED },
      },
    );
    const watermarks = new ContainerSyncWatermarkRepository(execSql);
    await watermarks.saveWatermark(
      containerParentSyncLane(null),
      SAVED_ROOT_WATERMARK,
    );
    const stored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        FOLDER.id,
      );
    if (!stored) throw new Error("Expected the held container");
    const held = await hydrateStoredContainerState({
      execSql,
      persistence: sqlContainerContentsPersistence,
      storedContainer: stored,
      writer: testContainerMetadataWriter,
    });
    const state = {
      containersById: new Map<string, ContainerState>([[FOLDER.id, held]]),
      persistence: sqlContainerContentsPersistence,
      runtime: cachedContainerHydrationRuntime([FOLDER], execSql),
    } as RemoteContainerHydrationState;
    const requests: Lane[][] = [];
    state.runtime.apiClient.listContainerParentLanes = async ({ lanes }) => {
      requests.push([...lanes]);
      return {
        results: lanes.map((lane) => ({
          laneId: lane.laneId,
          page: {
            hasMore: false,
            items: serve(lane).map((item) => ({ ...item, depth: 0 })),
            nextWatermark: {
              id: `next-${lane.watermark?.id ?? "from-start"}`,
              updatedAt: LATER,
            },
            tombstones: [],
          },
        })),
      };
    };
    const host: RemoteContainerHydrationHost = {
      async persistContainerState(candidate, patch, _view, saveOptions) {
        steps.push(`apply ${candidate.container.id}`);
        const persisted = await persistContainerMetadataStateFromRuntime({
          metadataState: candidate,
          patch,
          persistence: sqlContainerContentsPersistence,
          runtime: state.runtime,
          saveOptions,
        });
        if (!persisted) return { status: "missing" };
        candidate.container = persisted.container;
        installContainerMetadataRecord(candidate, persisted.record);
        return { record: persisted.record, status: "persisted" };
      },
      requestDocumentLaneListings: async (containerIds) => {
        steps.push(`owe ${containerIds.join(",") || "nothing"}`);
      },
      updateSnapshot: () => {},
    };

    crawling = true;
    await hydrateRemoteContainers({ ...options, host, state });
    crawling = false;

    return {
      requests,
      rootWatermark: await watermarks.loadWatermark(
        containerParentSyncLane(null),
      ),
      steps,
    };
  } finally {
    db.close();
  }
}

test("a served row owes its container's document lane before it is applied or passed", async () => {
  const { rootWatermark, steps } = await crawl({}, (lane) =>
    lane.parentId === null ? [FOLDER] : [],
  );

  // The root lane served the folder's row; the folder's own child lane, also
  // listed, served nothing and owes nothing.
  expect(steps.filter((step) => step !== "owe nothing")).toEqual([
    "owe container-1",
    "apply container-1",
    "save watermark",
    "save watermark",
  ]);
  expect(rootWatermark?.id).toBe("next-root-saved");
});

test("a lane that serves nothing owes nothing", async () => {
  const { steps } = await crawl({}, () => []);

  expect(steps.filter((step) => step.startsWith("owe "))).toEqual([
    "owe nothing",
    "owe nothing",
  ]);
});

test("the root lane's membership listing owes nothing and saves no cursor", async () => {
  const { requests, rootWatermark, steps } = await crawl(
    { resetRootLaneWatermark: true },
    // From its watermark the root lane has nothing new. From no watermark it
    // serves every root container it holds, moved or not.
    (lane) =>
      lane.parentId === null && lane.watermark === null ? [FOLDER] : [],
  );

  // One request lists the root lane twice: from its watermark, and from none.
  expect(
    requests[0]?.map((lane) => [lane.parentId, lane.watermark?.id ?? null]),
  ).toEqual([
    [null, "root-saved"],
    [null, null],
    ["container-1", null],
  ]);
  // The membership listing still applies the row it was served.
  expect(steps).toContain("apply container-1");
  expect(steps.filter((step) => step.startsWith("owe "))).toEqual([
    "owe nothing",
    "owe nothing",
  ]);
  // The cursor is the one the listing from the watermark returned.
  expect(rootWatermark?.id).toBe("next-root-saved");
});

test("a root container that moved is owed by the listing from the watermark", async () => {
  const { steps } = await crawl({ resetRootLaneWatermark: true }, (lane) =>
    lane.parentId === null ? [FOLDER] : [],
  );

  expect(steps.filter((step) => step.startsWith("owe "))).toEqual([
    "owe container-1",
    "owe nothing",
  ]);
  expect(steps.indexOf("owe container-1")).toBeLessThan(
    steps.indexOf("apply container-1"),
  );
});
