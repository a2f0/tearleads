import type {
  PrincipalPolicyHistoryReferenceProof,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../../keyingProjectionVerification/types";
import { keyingCheckpointTables } from "../../sqlite/schema/keyingCheckpointSchema";
import {
  principalHistoryEvidenceTables,
  principalHistoryPrefixes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../../sqlite/schema/principalHistoryStageSchema";
import { principalPolicyTables } from "../../sqlite/schema/principalPolicySchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  type AcknowledgedPrincipalCurrents,
  assertPublicationScope,
  persistAcknowledgedPrincipalCurrentsInTransaction,
} from "../principalCurrentAcknowledgementPersistence";
import {
  type PrincipalHistoryEvidencePage,
  readPrincipalHistoryReferences,
} from "./principalHistoryEvidencePersistence";
import {
  discardPrincipalHistoryPrefixInTransaction,
  type PrincipalHistoryPrefix,
  principalHistoryPrefixColumns,
  savePrincipalHistoryPrefixInTransaction,
} from "./principalHistoryPrefixPersistence";
import {
  discardPrincipalHistoryStageInTransaction,
  type PrincipalHistoryStage,
  principalHistoryStageColumns,
  savePrincipalHistoryStageInTransaction,
} from "./principalHistoryStagePersistence";

/**
 * Principal history storage bound to one executor and clock: resumable
 * stages, published prefixes, their evidence, and acknowledged currents. Each
 * write ensures its tables and runs its own immediate guarded transaction.
 * Work inside a caller's transaction takes the locked handle per call through
 * the `*InTransaction` functions instead.
 */
export class PrincipalHistoryRepository {
  private readonly execSql: ExecSql;
  private readonly now: () => Date;

  constructor(execSql: ExecSql, now: () => Date = () => new Date()) {
    this.execSql = execSql;
    this.now = now;
  }

  async loadPrincipalHistoryStage(
    id: string,
  ): Promise<PrincipalHistoryStage | null> {
    await ensureSqlTables(this.execSql, principalHistoryStageTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const [row] = await db
      .select(principalHistoryStageColumns)
      .from(principalHistoryStages)
      .where(eq(principalHistoryStages.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Publish accepted entries and index nodes atomically with authenticated progress. */
  async savePrincipalHistoryStage(input: {
    readonly stage: PrincipalHistoryStage;
    readonly evidence: PrincipalHistoryEvidencePage;
    readonly previousProgress: string | null;
    readonly stillCurrent: () => boolean;
  }): Promise<void> {
    const evidence = structuredClone(input.evidence);
    const stage = { ...input.stage, scopeId: evidence.scopeId };
    const previousProgress = input.previousProgress;
    await ensureSqlTables(this.execSql, [
      ...principalHistoryStageTables,
      ...principalHistoryEvidenceTables,
    ]);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const saved = await runtime.guardedTransaction(
      (tx) =>
        savePrincipalHistoryStageInTransaction(
          tx,
          { stage, evidence, previousProgress },
          this.now().getTime(),
        ),
      input.stillCurrent,
      { behavior: "immediate" },
    );
    assertProjectionVerificationCurrent(() => saved.committed);
  }

  async discardPrincipalHistoryStage(
    stage: PrincipalHistoryStage,
    stillCurrent: () => boolean,
  ): Promise<void> {
    await ensureSqlTables(this.execSql, [
      ...principalHistoryStageTables,
      ...principalHistoryEvidenceTables,
    ]);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const discarded = await runtime.guardedTransaction(
      (tx) => discardPrincipalHistoryStageInTransaction(tx, stage),
      stillCurrent,
      { behavior: "immediate" },
    );
    assertProjectionVerificationCurrent(() => discarded.committed);
  }

  async loadPrincipalHistoryPrefix(
    scopeId: string,
  ): Promise<PrincipalHistoryPrefix | null> {
    await ensureSqlTables(this.execSql, principalHistoryEvidenceTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const [prefix] = await db
      .select(principalHistoryPrefixColumns)
      .from(principalHistoryPrefixes)
      .where(eq(principalHistoryPrefixes.scopeId, scopeId))
      .limit(1);
    return prefix ?? null;
  }

  /**
   * Preserve identical completed progress; this sink does not authenticate hints.
   * Callers must discard an unreadable prefix or identify it with rejectedPrefix
   * before publishing a repair of the same head and current artifacts.
   */
  async savePrincipalHistoryPrefix(input: {
    readonly prefix: PrincipalHistoryPrefix;
    readonly indexRootHash: string;
    readonly stillCurrent: () => boolean;
    readonly rejectedPrefix?: PrincipalHistoryPrefix | null;
  }): Promise<void> {
    const prefix = { ...input.prefix };
    const indexRootHash = input.indexRootHash;
    const rejected = input.rejectedPrefix ? { ...input.rejectedPrefix } : null;
    await ensureSqlTables(this.execSql, [
      ...principalHistoryEvidenceTables,
      ...principalHistoryStageTables,
    ]);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const result = await runtime.guardedTransaction(
      (tx) =>
        savePrincipalHistoryPrefixInTransaction(
          tx,
          prefix,
          indexRootHash,
          rejected,
        ),
      input.stillCurrent,
      { behavior: "immediate" },
    );
    assertProjectionVerificationCurrent(() => result.committed);
  }

  /** Invalid hints are disposable, but a losing reader must preserve a newer hint. */
  async discardPrincipalHistoryPrefix(input: {
    readonly prefix: PrincipalHistoryPrefix;
    readonly stillCurrent: () => boolean;
  }): Promise<void> {
    const prefix = { ...input.prefix };
    await ensureSqlTables(this.execSql, principalHistoryEvidenceTables);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const result = await runtime.guardedTransaction(
      (tx) => discardPrincipalHistoryPrefixInTransaction(tx, prefix),
      input.stillCurrent,
      { behavior: "immediate" },
    );
    assertProjectionVerificationCurrent(() => result.committed);
  }

  /**
   * Returns untrusted material, in `versions` order. The caller must verify it
   * against the issued root. Index nodes are read one level at a time for every
   * version and entries in one set read; the first version that fails, in
   * order, throws the error loading it alone would.
   */
  async loadPrincipalHistoryReferences(input: {
    readonly scopeId: string;
    readonly history: VerifiedPrincipalPolicyHistory;
    readonly versions: readonly number[];
  }): Promise<PrincipalPolicyHistoryReferenceProof[]> {
    await ensureSqlTables(this.execSql, principalHistoryEvidenceTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return await readPrincipalHistoryReferences(db, input);
  }

  /** Returns untrusted material. The caller must verify it against the issued root. */
  async loadPrincipalHistoryReference(input: {
    readonly scopeId: string;
    readonly history: VerifiedPrincipalPolicyHistory;
    readonly version: number;
    readonly expectedReference?: ReferencedPrincipalHead | undefined;
  }): Promise<PrincipalPolicyHistoryReferenceProof> {
    const [loaded] = await this.loadPrincipalHistoryReferences({
      ...input,
      versions: [input.version],
    });
    if (!loaded) throw new Error("Principal history reference was not loaded");
    return input.expectedReference
      ? { ...loaded, reference: input.expectedReference }
      : loaded;
  }

  /** Store current artifacts and resumable progress in the same transaction as their pins. */
  async persistAcknowledgedPrincipalCurrents(
    input: AcknowledgedPrincipalCurrents,
  ): Promise<void> {
    const entries = structuredClone(input.entries);
    const retirements = structuredClone(input.retirements ?? []);
    const organizationId = input.organizationId;
    const stillCurrent = input.stillCurrent;
    assertPublicationScope(entries, organizationId);
    assertProjectionVerificationCurrent(stillCurrent);
    await ensureSqlTables(this.execSql, [
      ...principalPolicyTables,
      ...keyingCheckpointTables,
    ]);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const stored = await runtime.guardedTransaction(
      (tx) =>
        persistAcknowledgedPrincipalCurrentsInTransaction(
          tx,
          { organizationId, entries, retirements },
          this.now,
        ),
      stillCurrent,
      { behavior: "immediate" },
    );
    assertProjectionVerificationCurrent(() => stored.committed);
  }
}
