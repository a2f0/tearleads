import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/workflows/cachedContainerHydrationRuntime";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  CONTAINER_METADATA_APP_KIND,
  sqlContainerContentsPersistence,
} from "../../../../data/persistence/container-contents/containerContentsPersistence";
import { ensureDocumentTables } from "../../../../data/persistence/documents/records";
import { createClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type {
  ExecSql,
  SqlArrayRow,
  SqlRow,
} from "../../../../data/sqlite/sqlSchema";
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
import { upsertRemoteContainerState } from "./remoteContainerState";

const CREATED = "2026-01-01T00:00:01.000Z";
const RECORDED = "2026-01-01T00:00:02.000Z";
const LATER = "2026-01-01T00:00:03.000Z";

/** The held copy has this device's first edit; a peer then edits again. */
async function metadataVersions() {
  const held = await createDocument("metadata-revalidation-held");
  held.getText("text").update("Folder");
  held.commit();
  const peer = await createDocument("metadata-revalidation-peer");
  importUpdates(peer, [exportAllUpdates(held)]);
  peer.getText("text").update("Renamed by a peer");
  peer.commit();
  return {
    heldUpdates: bytesToBase64(exportAllUpdates(held)),
    heldVersion: encodeVersionVector(held),
    peerVersion: encodeVersionVector(peer),
  };
}

function listed(input: {
  updatedAt: string;
  updateCount: number;
}): RemoteContainer {
  return {
    createdAt: CREATED,
    effectiveAccessLevel: "write",
    id: "container-1",
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "access-1",
    metadataDocumentId: "metadata-1",
    metadataReferencedPrincipals: [],
    metadataUpdateCount: input.updateCount,
    organizationId: "organization-1",
    parentId: "parent-1",
    systemSlot: null,
    updatedAt: input.updatedAt,
  };
}

async function openRuntime(onSql: (sql: string) => void) {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "metadata-revalidation",
  });
  const sqlRuntime = createClientSQLitePersistenceRuntime({
    exec: async (options) => {
      onSql(options.sql);
      return {
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      };
    },
  });
  await sqlContainerContentsPersistence.ensureSchema(sqlRuntime.execSql);
  return { close: () => db.close(), execSql: sqlRuntime.execSql };
}

/**
 * The processed cursor a completed metadata pull left: it counted
 * `updateCount` updates and was recorded at `version`.
 */
interface ProcessedCursor {
  readonly updateCount: number;
  readonly version: string;
}

async function recordCursor(
  execSql: ExecSql,
  listing: RemoteContainer,
  cursor: ProcessedCursor,
) {
  await ensureDocumentTables(execSql);
  await execSql(
    `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
       through_update_id, through_update_count, through_version, judge)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      CONTAINER_METADATA_APP_KIND,
      listing.id,
      listing.metadataDocumentId,
      "update-through",
      cursor.updateCount,
      cursor.version,
      documentVerdictJudge(),
    ],
  );
}

/**
 * Hydrates one listing and returns the host calls in the order they ran.
 * `supersededAtCursorRead` supersedes the hydration as it reads the cursor.
 */
async function hydrateListing(
  listing: RemoteContainer,
  heldUpdates: string,
  cursor: ProcessedCursor | null,
  earlierUpdateCount?: number,
  supersededAtCursorRead = false,
) {
  let hydrating = false;
  let superseded = false;
  const { close, execSql } = await openRuntime((sql) => {
    if (hydrating && supersededAtCursorRead) {
      superseded ||= sql.includes("document_sync_progress");
    }
  });
  try {
    const listed = listing;
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "write",
        icon: null,
        id: listed.id,
        metadataDocumentId: listed.metadataDocumentId,
        name: "Folder",
        organizationId: listed.organizationId,
        parentId: listed.parentId,
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-1",
        documentId: listed.metadataDocumentId,
        id: listed.id,
        lastCommitLsn: "0/16B3748",
        metadataUpdates: heldUpdates,
        snapshotEndVersion: "",
      },
      {
        localUpdatedAt: RECORDED,
        serverTimestamps: { createdAt: CREATED, updatedAt: RECORDED },
      },
    );
    const stored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        listed.id,
      );
    if (!stored) throw new Error("Expected the held container");
    if (cursor !== null) await recordCursor(execSql, listed, cursor);
    const held = await hydrateStoredContainerState({
      execSql,
      persistence: sqlContainerContentsPersistence,
      storedContainer: stored,
      writer: testContainerMetadataWriter,
    });
    const state = {
      containersById: new Map<string, ContainerState>([[listed.id, held]]),
      persistence: sqlContainerContentsPersistence,
      runtime: cachedContainerHydrationRuntime([listed], execSql),
    } as RemoteContainerHydrationState;
    const calls: string[] = [];
    const host: RemoteContainerHydrationHost = {
      async persistContainerState(candidate, patch, _view, saveOptions) {
        calls.push(`persist ${saveOptions?.serverTimestamps?.updatedAt}`);
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
      requestMetadataRevalidation: async ({ documentId }) => {
        calls.push(`owe ${documentId}`);
      },
      updateSnapshot: () => {},
    };
    if (earlierUpdateCount !== undefined) {
      let pages = 0;
      state.runtime.apiClient.listContainerParentLanes = async ({ lanes }) => ({
        results: lanes.map(({ laneId }) => {
          pages++;
          return {
            laneId,
            page: {
              hasMore: pages === 1,
              nextWatermark: { id: String(pages), updatedAt: RECORDED },
              tombstones: [],
              items: [
                {
                  ...listed,
                  depth: 1,
                  metadataUpdateCount:
                    pages === 1
                      ? earlierUpdateCount
                      : listing.metadataUpdateCount,
                },
              ],
            },
          };
        }),
      });
      await hydrateRemoteContainers({ state, host, parentIds: [null] });
      expect(pages).toBe(2);
      return calls;
    }
    hydrating = true;
    await upsertRemoteContainerState({
      containerIdsWithPendingMetadataUpdates: new Set(),
      containerIdsWithPendingStructuralIntents: new Set(),
      host,
      isCurrent: () => !superseded,
      remoteContainer: listed,
      state,
    });
    expect(superseded).toBe(supersededAtCursorRead);
    return calls;
  } finally {
    close();
  }
}

test("a listing that counts more updates than this device processed owes a read first", async () => {
  const versions = await metadataVersions();
  const cursor = { updateCount: 1, version: versions.heldVersion };
  // The container timestamp did not move: the count alone reveals the edit.
  expect(
    await hydrateListing(
      listed({ updatedAt: RECORDED, updateCount: 2 }),
      versions.heldUpdates,
      cursor,
    ),
  ).toEqual(["owe metadata-1", `persist ${RECORDED}`]);
});

test("a listing the processed cursor covers owes no read, even after other writes", async () => {
  const versions = await metadataVersions();
  // A write into the folder or a move advanced the timestamp only. The held
  // copy lacks the second update, which the pull voided: this device judged
  // it, so the listing's count is covered all the same.
  for (const updateCount of [1, 2]) {
    expect(
      await hydrateListing(
        listed({ updatedAt: LATER, updateCount }),
        versions.heldUpdates,
        { updateCount: 2, version: versions.heldVersion },
      ),
    ).toEqual([`persist ${LATER}`]);
  }
});

test("without a cursor the held copy may send, only an empty document is covered", async () => {
  const versions = await metadataVersions();
  const listing = listed({ updatedAt: LATER, updateCount: 1 });
  expect(await hydrateListing(listing, versions.heldUpdates, null)).toEqual([
    "owe metadata-1",
    `persist ${LATER}`,
  ]);
  // A cursor recorded at a version the held copy no longer covers.
  expect(
    await hydrateListing(listing, versions.heldUpdates, {
      updateCount: 2,
      version: versions.peerVersion,
    }),
  ).toEqual(["owe metadata-1", `persist ${LATER}`]);
  expect(
    await hydrateListing(
      listed({ updatedAt: LATER, updateCount: 0 }),
      versions.heldUpdates,
      null,
    ),
  ).toEqual([`persist ${LATER}`]);
});

test("a metadata publication between two pages schedules its missing read", async () => {
  const versions = await metadataVersions();
  expect(
    await hydrateListing(
      listed({ updatedAt: RECORDED, updateCount: 2 }),
      versions.heldUpdates,
      { updateCount: 1, version: versions.heldVersion },
      1,
    ),
  ).toContain("owe metadata-1");
});

test("a hydration superseded while it reads the cursor owes no read", async () => {
  const versions = await metadataVersions();
  const calls = await hydrateListing(
    listed({ updatedAt: RECORDED, updateCount: 2 }),
    versions.heldUpdates,
    { updateCount: 1, version: versions.heldVersion },
    undefined,
    true,
  );
  expect(calls).not.toContain("owe metadata-1");
});
