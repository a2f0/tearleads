import type {
  PrincipalPolicyCheckpoint,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { asc, desc } from "drizzle-orm";
import { keyingCheckpointTables } from "../../sqlite/schema/keyingCheckpointSchema";
import { principalHistoryEvidenceTables } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  principalPolicyBundles,
  principalPolicyTables,
} from "../../sqlite/schema/principalPolicySchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import type { AcknowledgedPrincipalGrantRetirements } from "../principalContracts/principalGrantRetirementPersistence";
import {
  type PrincipalKeyEnvelopeCandidate,
  selectPrincipalKeyEnvelopeCandidates,
} from "../principalKeys/principalKeyEnvelopeCandidates";
import { selectHeldPrincipalState } from "./heldPrincipalState";
import {
  assertLocallyAcknowledgedPrincipalPolicyBundles,
  type LocallyAcknowledgedPrincipalPolicyBundle,
  type LocallyAcknowledgedPrincipalPolicyBundles,
  type LocallyAcknowledgedPrincipalPolicyStore,
  storeLocallyAcknowledgedPrincipalPolicyBundlesInTransaction,
} from "./locallyAcknowledgedPrincipalPolicyPersistence";
import {
  parseSelectedPrincipalPolicyBundle,
  principalPolicyBundleSelection,
  retainPrincipalPolicyBundleInTransaction,
  wherePrincipalPolicyCurrent,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import {
  assertReferenceShape,
  selectReferencedPrincipalPolicyBundle,
} from "./principalPolicyReferencePersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";
import {
  assertVerifiedPrincipalPolicyBundles,
  persistVerifiedPrincipalPolicyBundlesInTransaction,
  type VerifiedPrincipalPolicyBundleEntry,
} from "./verifiedPrincipalPolicyBundlePersistence";

/**
 * The cached principal policy bundles, current heads and retained epochs, and
 * the member key envelopes they carry, bound to one executor and clock. Each
 * method ensures its tables; each writer runs its own immediate transaction
 * and silently skips a commit its `stillCurrent` refuses. Work inside a
 * caller's transaction takes the locked handle per call through the
 * `*InTransaction` functions instead.
 */
export class PrincipalPolicyBundleRepository {
  private readonly execSql: ExecSql;
  private readonly now: () => Date;

  constructor(execSql: ExecSql, now: () => Date = () => new Date()) {
    this.execSql = execSql;
    this.now = now;
  }

  async ensurePrincipalPolicyTables(): Promise<void> {
    await ensureSqlTables(this.execSql, principalPolicyTables);
  }

  async loadPrincipalPolicyBundle(
    principalType: PrincipalStateResponse["principalType"],
    principalId: string,
  ): Promise<PrincipalPolicyBundleResponse | null> {
    await this.ensurePrincipalPolicyTables();
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const [row] = await db
      .select(principalPolicyBundleSelection)
      .from(principalPolicyBundles)
      .where(wherePrincipalPolicyCurrent({ principalType, principalId }))
      .limit(1);
    return row ? parseSelectedPrincipalPolicyBundle(row) : null;
  }

  /** Current heads first, then retained bundles. */
  async loadAllPrincipalPolicyBundles(): Promise<
    PrincipalPolicyBundleResponse[]
  > {
    await this.ensurePrincipalPolicyTables();
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const rows = await db
      .select(principalPolicyBundleSelection)
      .from(principalPolicyBundles)
      .orderBy(
        desc(principalPolicyBundles.isCurrent),
        asc(principalPolicyBundles.principalType),
        asc(principalPolicyBundles.principalId),
        asc(principalPolicyBundles.stateHash),
      );
    const bundles: PrincipalPolicyBundleResponse[] = [];
    for (const row of rows) {
      const bundle = parseSelectedPrincipalPolicyBundle(row);
      if (bundle) bundles.push(bundle);
    }
    return bundles;
  }

  async loadPrincipalPolicyStateHash(
    principalType: PrincipalStateResponse["principalType"],
    principalId: string,
  ): Promise<string | null> {
    await this.ensurePrincipalPolicyTables();
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const [row] = await db
      .select({ stateHash: principalPolicyBundles.stateHash })
      .from(principalPolicyBundles)
      .where(wherePrincipalPolicyCurrent({ principalType, principalId }))
      .limit(1);
    return row?.stateHash ?? null;
  }

  /** The newest stored bundle containing exactly `reference`, never a guess. */
  async loadPrincipalPolicyBundleForReference(
    reference: ReferencedPrincipalHead,
    checkpoint: PrincipalPolicyCheckpoint | null,
  ): Promise<PrincipalPolicyBundleResponse | null> {
    assertReferenceShape(reference);
    await this.ensurePrincipalPolicyTables();
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectReferencedPrincipalPolicyBundle(db, reference, checkpoint);
  }

  /**
   * A signed state this device stored for exactly `head`: history evidence it
   * verified or acknowledged, or a cached policy bundle chain. It is untrusted;
   * the caller verifies it as it would a served copy, and a miss only means the
   * server sends one.
   */
  async loadHeldPrincipalState(
    head: ReferencedPrincipalHead,
  ): Promise<PrincipalStateResponse | null> {
    await this.ensurePrincipalPolicyTables();
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectHeldPrincipalState(db, head);
  }

  /**
   * Untrusted encrypted key candidates, never authorization evidence. The actual
   * private key must open the requested recipient wrap; the projection verifier
   * separately checks the signed KEK material identity and all policy authority.
   * Read only envelopes for the requested fingerprints, never signed histories.
   */
  async loadPrincipalKeyEnvelopeCandidates(
    fingerprints: readonly string[],
  ): Promise<PrincipalKeyEnvelopeCandidate[]> {
    await ensureSqlTables(this.execSql, [
      ...principalPolicyTables,
      ...principalHistoryEvidenceTables,
    ]);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return selectPrincipalKeyEnvelopeCandidates(db, fingerprints);
  }

  async savePrincipalPolicyBundle(
    bundle: PrincipalPolicyBundleResponse,
    organizationId: string,
    options?: { stillCurrent?: (() => boolean) | undefined } | undefined,
  ): Promise<void> {
    await ensureSqlTables(this.execSql, [
      ...principalPolicyTables,
      ...keyingCheckpointTables,
    ]);
    await this.runImmediate(
      (tx) =>
        writePrincipalPolicyBundleInTransaction(
          tx,
          bundle,
          this.now().toISOString(),
          organizationId,
        ),
      options?.stillCurrent,
    );
  }

  /**
   * Persists each verified full policy bundle together with its durable head.
   * This prevents a crash or bundle-write failure from leaving a checkpoint
   * without the exact same-head payload and member-envelope evidence.
   */
  async persistVerifiedPrincipalPolicyBundlesAtomically(input: {
    readonly entries: readonly VerifiedPrincipalPolicyBundleEntry[];
    readonly organizationId?: string | undefined;
    readonly stillCurrent?: (() => boolean) | undefined;
  }): Promise<void> {
    await assertVerifiedPrincipalPolicyBundles(input.entries);
    await ensureSqlTables(this.execSql, [
      ...principalPolicyTables,
      ...keyingCheckpointTables,
    ]);
    await this.runImmediate(
      (tx) =>
        persistVerifiedPrincipalPolicyBundlesInTransaction(
          tx,
          input,
          this.now().toISOString(),
        ),
      input.stillCurrent,
    );
  }

  /**
   * Retains a just-verified epoch without promoting it to the mutable head.
   * `updatedAt` stays explicit: callers stamp a whole retention walk at once.
   */
  async retainVerifiedPrincipalPolicyBundle(input: {
    readonly bundle: PrincipalPolicyBundleResponse;
    readonly organizationId?: string | undefined;
    readonly policy: VerifiedPrincipalPolicy;
    readonly stillCurrent?: (() => boolean) | undefined;
    readonly updatedAt: string;
  }): Promise<void> {
    await assertBundleMatchesVerifiedPolicy(input);
    await this.ensurePrincipalPolicyTables();
    await this.runImmediate(
      (tx) =>
        retainPrincipalPolicyBundleInTransaction(
          tx,
          input.bundle,
          input.updatedAt,
          input.organizationId,
        ),
      input.stillCurrent,
    );
  }

  /** Atomically pins and caches exact full policy bundles acknowledged by the API. */
  persistLocallyAcknowledgedPrincipalPolicyBundles(
    input: LocallyAcknowledgedPrincipalPolicyBundles,
  ): Promise<void> {
    return this.storeLocallyAcknowledgedPrincipalPolicyBundles({
      ...input,
      placement: "current",
    });
  }

  persistLocallyAcknowledgedPrincipalPolicyBundle(
    input: LocallyAcknowledgedPrincipalPolicyBundle & {
      readonly organizationId?: string | undefined;
      readonly stillCurrent?: (() => boolean) | undefined;
    },
  ): Promise<void> {
    return this.persistLocallyAcknowledgedPrincipalPolicyBundles({
      entries: [input],
      organizationId: input.organizationId,
      stillCurrent: input.stillCurrent,
    });
  }

  /**
   * Seed a provisioning acknowledgement without making genesis current again.
   * The cache writer still checks ownership, equal-version forks and retained
   * same-hash bundle integrity, and preserves any newer cached policy head.
   */
  seedLocallyAcknowledgedPrincipalPolicyBundles(
    input: LocallyAcknowledgedPrincipalPolicyBundles,
  ): Promise<void> {
    return this.storeLocallyAcknowledgedPrincipalPolicyBundles({
      ...input,
      placement: "genesis",
    });
  }

  retainLocallyAcknowledgedPrincipalPolicyBundles(
    input: LocallyAcknowledgedPrincipalPolicyBundles & {
      readonly retiredContainers?:
        | AcknowledgedPrincipalGrantRetirements
        | undefined;
    },
  ): Promise<void> {
    return this.storeLocallyAcknowledgedPrincipalPolicyBundles({
      ...input,
      placement: "history",
    });
  }

  private async storeLocallyAcknowledgedPrincipalPolicyBundles(
    input: LocallyAcknowledgedPrincipalPolicyStore & {
      readonly stillCurrent?: (() => boolean) | undefined;
    },
  ): Promise<void> {
    await assertLocallyAcknowledgedPrincipalPolicyBundles(input.entries);
    await ensureSqlTables(this.execSql, [
      ...principalPolicyTables,
      ...keyingCheckpointTables,
    ]);
    await this.runImmediate(
      (tx) =>
        storeLocallyAcknowledgedPrincipalPolicyBundlesInTransaction(
          tx,
          input,
          this.now().toISOString(),
        ),
      input.stillCurrent,
    );
  }

  /** Guarded when `stillCurrent` is given; a refused commit is not an error. */
  private async runImmediate(
    body: (tx: ClientSQLiteTransactionScope) => Promise<void>,
    stillCurrent: (() => boolean) | undefined,
  ): Promise<void> {
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    if (stillCurrent) {
      await runtime.guardedTransaction(body, stillCurrent, {
        behavior: "immediate",
      });
      return;
    }
    await runtime.transaction(body, { behavior: "immediate" });
  }
}
