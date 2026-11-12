import {
  createNativeTestExecSql,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { ContainerKekWireLevel } from "@tearleads/validators/response";
import { advanceKeyingCheckpointsAtomically } from "../../src/data/persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence";
import type { VerifiedManifestBundle } from "../../src/data/persistence/verifiedManifestBundlePersistence";
import {
  containerTables,
  localIntentTables,
} from "../../src/data/sqlite/schema";
import { containers } from "../../src/data/sqlite/schema/containerSchema";
import {
  documentContainerProjectionTables,
  documentProjectionTables,
} from "../../src/data/sqlite/schema/documentProjectionSchema";
import { verifiedManifestBundleTables } from "../../src/data/sqlite/schema/verifiedManifestBundleSchema";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../../src/data/sqlite/sqlSchema";

export const ORGANIZATION = "organization-1";
export const NOW = "2026-01-01T00:00:00.000Z";
export const hash = (index: number) => index.toString(16).padStart(64, "0");

export function entry(
  objectId: string,
  epoch: number,
  index: number,
  objectKind = "container",
  organizationId = ORGANIZATION,
) {
  return {
    bundle: {
      event: { body: { epoch }, event: { objectId }, eventHash: `e${epoch}` },
      manifest: { objectId, epoch },
      manifestHash: hash(index),
      state: { epoch },
    },
    checkpoint: { objectKind, organizationId, objectId, epoch },
  };
}

export function level(containerId: string): ContainerKekWireLevel {
  return {
    accessManifestHash: hash(100),
    containerId,
    containerKeyEpoch: 1,
    containerKeyEpochId: `${containerId}-epoch-1`,
    containerManifestHistory: [hash(100)],
    keyEpoch: { containerId, epoch: 1 },
    keyEpochHash: hash(200),
    keyring: null,
    keyTargetHash: hash(300),
    parentContainerKeyEpochId: null,
    recipientTargets: [{ principalId: "user-1" }],
    wraps: [{ recipient: "user-1", envelope: "wrap-1" }],
  };
}

export function remember(
  execSql: ExecSql,
  verifiedBundles: readonly VerifiedManifestBundle[],
) {
  return advanceKeyingCheckpointsAtomically({
    access: [],
    policies: [],
    execSql,
    verifiedBundles,
  });
}

export async function citationDatabase(engine: "native" | "wasm" = "native") {
  const native =
    engine === "wasm"
      ? await createTestExecSql("citation-reads")
      : createNativeTestExecSql();
  const statements: {
    sql: string;
    bind: Parameters<ExecSql>[1];
    rows: number;
  }[] = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      const rows = await native.execSql(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      statements.push({ sql, bind, rows: rows?.length ?? 0 });
      return { rows };
    },
  });
  await ensureSqlTables(execSql, [
    ...containerTables,
    ...localIntentTables,
    ...documentProjectionTables,
    ...documentContainerProjectionTables,
    ...verifiedManifestBundleTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return {
    ...native,
    execSql,
    db,
    statements,
    container: (
      id: string,
      parentId: string | null = null,
      organizationId = ORGANIZATION,
      metadataDocumentId: string | null = null,
    ) =>
      db
        .insert(containers)
        .values({
          id,
          parentId,
          organizationId,
          metadataDocumentId,
          localCreatedAt: NOW,
          localUpdatedAt: NOW,
        })
        .run(),
    plans: async () =>
      Promise.all(
        statements.map(async ({ sql, bind }) => ({
          sql,
          bind,
          plan: await native.execSql(`EXPLAIN QUERY PLAN ${sql}`, bind),
        })),
      ),
  };
}
