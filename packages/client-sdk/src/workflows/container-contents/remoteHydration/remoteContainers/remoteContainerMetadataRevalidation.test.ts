import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/workflows/cachedContainerHydrationRuntime";
import { sqlContainerContentsPersistence } from "../../../../data/persistence/container-contents/containerContentsPersistence";
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
  versionVector: string;
}): RemoteContainer {
  return {
    createdAt: CREATED,
    effectiveAccessLevel: "write",
    id: "container-1",
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "access-1",
    metadataDocumentId: "metadata-1",
    metadataReferencedPrincipals: [],
    metadataVersionVector: input.versionVector,
    organizationId: "organization-1",
    parentId: "parent-1",
    systemSlot: null,
    updatedAt: input.updatedAt,
  };
}

async function openRuntime() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "metadata-revalidation",
  });
  const sqlRuntime = createClientSQLitePersistenceRuntime({
    exec: async (options) => ({
      rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
    }),
  });
  await sqlContainerContentsPersistence.ensureSchema(sqlRuntime.execSql);
  return { close: () => db.close(), execSql: sqlRuntime.execSql };
}

/** Hydrates one listing and returns the host calls in the order they ran. */
async function hydrateListing(
  listing: RemoteContainer,
  heldUpdates: string,
  earlierVersion?: string,
) {
  const { close, execSql } = await openRuntime();
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
    if (earlierVersion !== undefined) {
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
                  metadataVersionVector:
                    pages === 1
                      ? earlierVersion
                      : listing.metadataVersionVector,
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
    await upsertRemoteContainerState({
      containerIdsWithPendingMetadataUpdates: new Set(),
      containerIdsWithPendingStructuralIntents: new Set(),
      host,
      remoteContainer: listed,
      state,
    });
    return calls;
  } finally {
    close();
  }
}

test("a listing whose metadata version the held copy lacks owes a read first", async () => {
  const versions = await metadataVersions();
  // The container timestamp did not move: the version alone reveals the edit.
  expect(
    await hydrateListing(
      listed({ updatedAt: RECORDED, versionVector: versions.peerVersion }),
      versions.heldUpdates,
    ),
  ).toEqual(["owe metadata-1", `persist ${RECORDED}`]);
});

test("a listing the held copy covers owes no read, even after other writes", async () => {
  const versions = await metadataVersions();
  // A write into the folder or a move advanced the timestamp only.
  expect(
    await hydrateListing(
      listed({ updatedAt: LATER, versionVector: versions.heldVersion }),
      versions.heldUpdates,
    ),
  ).toEqual([`persist ${LATER}`]);
  expect(
    await hydrateListing(
      listed({ updatedAt: LATER, versionVector: emptyVersionVector() }),
      versions.heldUpdates,
    ),
  ).toEqual([`persist ${LATER}`]);
});

test("an unreadable listed version owes a read instead of failing the page", async () => {
  const versions = await metadataVersions();
  expect(
    await hydrateListing(
      listed({ updatedAt: LATER, versionVector: "not a version vector" }),
      versions.heldUpdates,
    ),
  ).toEqual(["owe metadata-1", `persist ${LATER}`]);
});

test("a metadata publication between two pages schedules its missing read", async () => {
  const versions = await metadataVersions();
  expect(
    await hydrateListing(
      listed({ updatedAt: RECORDED, versionVector: versions.peerVersion }),
      versions.heldUpdates,
      versions.heldVersion,
    ),
  ).toContain("owe metadata-1");
});
