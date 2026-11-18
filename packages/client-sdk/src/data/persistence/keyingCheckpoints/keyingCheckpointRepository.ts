import type {
  AccessManifestCheckpoint,
  AccessObjectKind,
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
  VerifiedOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  documentPurgeCheckpoints,
  keyingCheckpointTables,
} from "../../sqlite/schema/keyingCheckpointSchema";
import { principalPolicyTables } from "../../sqlite/schema/principalPolicySchema";
import { verifiedManifestBundleTables } from "../../sqlite/schema/verifiedManifestBundleSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  type VerifiedManifestBundleRow,
  verifiedManifestBundleRows,
  writeVerifiedManifestBundlesInTransaction,
} from "../verifiedManifestBundlePersistence";
import type { DocumentPurgeCheckpoint } from "./documentPurgeCheckpointPersistence";
import {
  advanceKeyingCheckpointsInTransaction,
  type KeyingCheckpointAdvanceBatch,
  type KeyingCheckpointBatch,
  keyingCheckpointBatchTables,
  validateKeyingCheckpointsInTransaction,
} from "./keyingCheckpointAdvancePersistence";
import {
  loadAccessManifestCheckpointRow,
  loadPrincipalPolicyCheckpointRow,
} from "./keyingCheckpointPersistence";
import {
  acknowledgeLocallyAuthoredHeadsInTransaction,
  type LocallyAcknowledgedAdvance,
} from "./locallyAcknowledgedCheckpointPersistence";
import { seedOrganizationReplacementCheckpointsInTransaction } from "./organizationReplacementCheckpointPersistence";

/**
 * The durable keying pins projection verification compares against: access
 * manifest, principal policy, and document purge checkpoints, bound to one
 * executor and clock. Each method ensures its tables and runs its own
 * immediate transaction. Work inside a caller's transaction takes the locked
 * handle per call through the `*InTransaction` functions instead.
 */
export class KeyingCheckpointRepository {
  private readonly execSql: ExecSql;
  private readonly now: () => Date;

  constructor(execSql: ExecSql, now: () => Date = () => new Date()) {
    this.execSql = execSql;
    this.now = now;
  }

  async loadAccessManifestCheckpoint(
    objectKind: AccessObjectKind,
    organizationId: string,
    objectId: string,
  ): Promise<AccessManifestCheckpoint | null> {
    await ensureSqlTables(this.execSql, keyingCheckpointTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const row = await loadAccessManifestCheckpointRow(db, {
      objectKind,
      organizationId,
      objectId,
    });
    return row ? { objectKind, objectId, organizationId, ...row } : null;
  }

  async loadPrincipalPolicyCheckpoint(
    principalType: ManagedPrincipalKind,
    principalId: string,
  ): Promise<PrincipalPolicyCheckpoint | null> {
    await ensureSqlTables(this.execSql, keyingCheckpointTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const row = await loadPrincipalPolicyCheckpointRow(db, {
      principalType,
      principalId,
    });
    return row ? { principalType, principalId, ...row } : null;
  }

  async loadDocumentPurgeCheckpoint(
    documentId: string,
  ): Promise<DocumentPurgeCheckpoint | null> {
    await ensureSqlTables(this.execSql, keyingCheckpointTables);
    const [row] = await getClientSQLitePersistenceRuntime(this.execSql)
      .db.select({
        documentId: documentPurgeCheckpoints.documentId,
        documentManifestHash: documentPurgeCheckpoints.documentManifestHash,
        organizationId: documentPurgeCheckpoints.organizationId,
        purgeEventHash: documentPurgeCheckpoints.purgeEventHash,
      })
      .from(documentPurgeCheckpoints)
      .where(eq(documentPurgeCheckpoints.documentId, documentId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Re-checks verified candidates against durable pins without advancing
   * them; only the verified bundles' citation rows are written.
   */
  async validateKeyingCheckpointsAtomically(
    batch: KeyingCheckpointBatch,
  ): Promise<void> {
    const bundleRows = await this.prepareBatch(batch);
    const verifiedAt = this.now().toISOString();
    const validate = (tx: ClientSQLiteTransactionScope) =>
      validateKeyingCheckpointsInTransaction(tx, batch, bundleRows, verifiedAt);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    if (batch.stillCurrent) {
      await runtime.guardedTransaction(validate, batch.stillCurrent, {
        behavior: "immediate",
      });
      return;
    }
    await runtime.transaction(validate, { behavior: "immediate" });
  }

  /** Advances the complete verified batch in one immediate transaction. */
  async advanceKeyingCheckpointsAtomically(
    batch: KeyingCheckpointAdvanceBatch,
  ): Promise<void> {
    const bundleRows = await this.prepareBatch(batch);
    const updatedAt = this.now().toISOString();
    const advance = (tx: ClientSQLiteTransactionScope) =>
      advanceKeyingCheckpointsInTransaction(tx, batch, bundleRows, updatedAt);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    if (batch.stillCurrent) {
      await runtime.guardedTransaction(advance, batch.stillCurrent, {
        behavior: "immediate",
      });
      return;
    }
    await runtime.transaction(advance, { behavior: "immediate" });
  }

  /**
   * Whether the heads committed; false only when `stillCurrent` turned false.
   * A head's authored bundle, when its acknowledgement matched, is stored for
   * citation in the same transaction, so it commits only with its pin.
   */
  async advanceLocallyAcknowledgedAccessManifestHeadsAtomically(
    advance: LocallyAcknowledgedAdvance,
  ): Promise<boolean> {
    const bundleRows = await verifiedManifestBundleRows(
      advance.heads.flatMap(({ checkpoint, servedBundle }) =>
        servedBundle ? [{ bundle: servedBundle, checkpoint }] : [],
      ),
    );
    await ensureSqlTables(this.execSql, [
      ...keyingCheckpointTables,
      ...(bundleRows.length > 0 ? verifiedManifestBundleTables : []),
    ]);
    const updatedAt = this.now().toISOString();
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const acknowledge = async (tx: ClientSQLiteTransactionScope) => {
      await acknowledgeLocallyAuthoredHeadsInTransaction(
        tx,
        advance,
        updatedAt,
      );
      await writeVerifiedManifestBundlesInTransaction(
        tx,
        bundleRows,
        updatedAt,
      );
    };
    if (advance.stillCurrent) {
      return (
        await runtime.guardedTransaction(acknowledge, advance.stillCurrent, {
          behavior: "immediate",
        })
      ).committed;
    }
    await runtime.transaction(acknowledge, { behavior: "immediate" });
    return true;
  }

  /** Seeds a replacement organization's genesis pins; false if superseded. */
  async persistOrganizationReplacementCheckpoints(input: {
    readonly authorization: VerifiedOrganizationReplacementAuthorization;
    readonly stillCurrent?: (() => boolean) | undefined;
  }): Promise<boolean> {
    await ensureSqlTables(this.execSql, [
      ...principalPolicyTables,
      ...keyingCheckpointTables,
    ]);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const result = await runtime.guardedTransaction(
      (tx) =>
        seedOrganizationReplacementCheckpointsInTransaction(
          tx,
          input.authorization,
          this.now().toISOString(),
        ),
      input.stillCurrent ?? (() => true),
      { behavior: "immediate" },
    );
    return result.committed;
  }

  /**
   * Digests the verified bundles and ensures every table the batch touches,
   * all before its transaction begins.
   */
  private async prepareBatch(
    batch: KeyingCheckpointBatch,
  ): Promise<VerifiedManifestBundleRow[]> {
    const bundleRows = await verifiedManifestBundleRows(
      batch.verifiedBundles ?? [],
    );
    await ensureSqlTables(
      this.execSql,
      keyingCheckpointBatchTables(batch, bundleRows),
    );
    return bundleRows;
  }
}
