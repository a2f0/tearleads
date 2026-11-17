import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/workflows/cachedContainerHydrationRuntime";
import { sqlContainerContentsPersistence } from "../../../../data/persistence/container-contents/containerContentsPersistence";
import { createClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../../../data/sqlite/sqlSchema";
import {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "../../metadata/metadataPersistence";
import { hydrateStoredContainerState } from "../../storedContainerState";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "../types";
import { upsertRemoteContainerState } from "./remoteContainerState";
import { remoteContainerChangedSince } from "./remoteContainerTimestamps";

const CREATED = "2026-01-01T00:00:01.000Z";
const RECORDED = "2026-01-01T00:00:02.000Z";

function listedAt(updatedAt: string): RemoteContainer {
  return {
    createdAt: CREATED,
    effectiveAccessLevel: "write",
    id: "container-1",
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "access-1",
    metadataDocumentId: "metadata-1",
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId: "parent-1",
    systemSlot: null,
    updatedAt,
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
async function hydrateListing(updatedAt: string) {
  const { close, execSql } = await openRuntime();
  try {
    const listed = listedAt(updatedAt);
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
        metadataUpdates: "",
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
      requestMetadataRevalidation: async (metadataDocumentId) => {
        calls.push(`owe ${metadataDocumentId}`);
      },
      updateSnapshot: () => {},
    };
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

test("a listing that moved a held container owes its metadata a read before recording the move", async () => {
  const moved = "2026-01-01T00:00:03.000Z";
  expect(await hydrateListing(moved)).toEqual([
    "owe metadata-1",
    `persist ${moved}`,
  ]);
});

test("a listing at the recorded timestamp owes no read", async () => {
  expect(await hydrateListing(RECORDED)).toEqual([`persist ${RECORDED}`]);
});

test("listing timestamps compare at microseconds across fraction widths", () => {
  const changed = (listed: string, recorded: string | null) =>
    remoteContainerChangedSince(listedAt(listed), recorded);
  expect(changed("2026-01-01T00:00:02.000500Z", RECORDED)).toBe(true);
  expect(changed("2026-01-01T00:00:02.000Z", "2026-01-01T00:00:02.000Z")).toBe(
    false,
  );
  expect(changed("2026-01-01T00:00:01.999999Z", RECORDED)).toBe(false);
  expect(changed("2026-01-01T00:00:02Z", "2026-01-01T00:00:02.000Z")).toBe(
    false,
  );
  // Unknown or unreadable evidence owes the read.
  expect(changed(RECORDED, null)).toBe(true);
  expect(changed("not a timestamp", RECORDED)).toBe(true);
});
