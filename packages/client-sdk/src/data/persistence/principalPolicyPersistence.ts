import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import {
  keyingCheckpointTables,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyCheckpoints,
  principalPolicyTables,
} from "../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import { assertSameHeadPrincipalPolicyBundle } from "./principalPolicyBundleIntegrity";
import {
  recordPrincipalPolicyBundleOrganizationInTransaction,
  recordPrincipalPolicyOrganizationInTransaction,
} from "./principalPolicyOrganizationPersistence";
import { indexPrincipalPolicyBundleInTransaction } from "./principalPolicyReferenceIndexPersistence";
import { storedPrincipalPolicyBundleFromJson } from "./storedPrincipalPolicyBundle";

interface PrincipalPolicyRow {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  currentStateJson: string;
  currentPayloadJson: string;
  currentProjectionJson: string;
  currentGrantsJson: string;
  currentMemberEnvelopesJson: string;
  previousStatesJson: string;
  updatedAt: string;
}

export interface SelectedPrincipalPolicyRow {
  principalType: string;
  principalId: string;
  stateHash: string;
  currentStateJson: string;
  currentPayloadJson: string;
  currentProjectionJson: string;
  currentGrantsJson: string;
  currentMemberEnvelopesJson: string;
  previousStatesJson: string;
  updatedAt: string;
}

interface StoredPrincipalPolicyHead {
  readonly stateHash: string;
  readonly version: number;
}

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateResponse["principalType"] {
  return value === "group" || value === "organization";
}

function parsePrincipalPolicyRow(
  row: SelectedPrincipalPolicyRow,
): PrincipalPolicyRow | null {
  if (!isManagedPrincipalType(row.principalType)) {
    return null;
  }

  return {
    principalType: row.principalType,
    principalId: row.principalId,
    stateHash: row.stateHash,
    currentStateJson: row.currentStateJson,
    currentPayloadJson: row.currentPayloadJson,
    currentProjectionJson: row.currentProjectionJson,
    currentGrantsJson: row.currentGrantsJson,
    currentMemberEnvelopesJson: row.currentMemberEnvelopesJson,
    previousStatesJson: row.previousStatesJson,
    updatedAt: row.updatedAt,
  };
}

function parseStoredPrincipalPolicyHead(
  currentStateJson: string,
): StoredPrincipalPolicyHead | null {
  try {
    const value: unknown = JSON.parse(currentStateJson);
    if (!value || typeof value !== "object") {
      return null;
    }
    const stateHash = Reflect.get(value, "stateHash");
    const version = Reflect.get(value, "version");
    return typeof stateHash === "string" && typeof version === "number"
      ? { stateHash, version }
      : null;
  } catch {
    return null;
  }
}

function parsePrincipalPolicyBundle(
  row: PrincipalPolicyRow,
): PrincipalPolicyBundleResponse {
  const bundle = storedPrincipalPolicyBundleFromJson(row);

  if (!isPrincipalPolicyBundleResponse(bundle)) {
    throw new Error("Stored principal policy bundle is invalid");
  }

  return bundle;
}

export async function ensurePrincipalPolicyTables(
  execSql: ExecSql,
): Promise<void> {
  await ensureSqlTables(execSql, principalPolicyTables);
}

type PrincipalPolicyBundleTable =
  | typeof principalPolicies
  | typeof principalPolicyBundleHistory;

/**
 * The ONE select shape for a stored principal-policy bundle row, over either
 * the mutable-head table or the retained-history table.
 */
export function principalPolicyBundleSelection(
  table: PrincipalPolicyBundleTable,
) {
  return {
    principalType: table.principalType,
    principalId: table.principalId,
    stateHash: table.stateHash,
    currentStateJson: table.currentStateJson,
    currentPayloadJson: table.currentPayloadJson,
    currentProjectionJson: table.currentProjectionJson,
    currentGrantsJson: table.currentGrantsJson,
    currentMemberEnvelopesJson: table.currentMemberEnvelopesJson,
    previousStatesJson: table.previousStatesJson,
    updatedAt: table.updatedAt,
  };
}

export async function loadPrincipalPolicyBundle(
  execSql: ExecSql,
  principalType: PrincipalStateResponse["principalType"],
  principalId: string,
): Promise<PrincipalPolicyBundleResponse | null> {
  await ensurePrincipalPolicyTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(principalPolicyBundleSelection(principalPolicies))
    .from(principalPolicies)
    .where(
      and(
        eq(principalPolicies.principalType, principalType),
        eq(principalPolicies.principalId, principalId),
      ),
    )
    .limit(1);

  const row = rows[0] ? parsePrincipalPolicyRow(rows[0]) : null;
  return row ? parsePrincipalPolicyBundle(row) : null;
}

export async function loadAllPrincipalPolicyBundles(
  execSql: ExecSql,
): Promise<PrincipalPolicyBundleResponse[]> {
  await ensurePrincipalPolicyTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(principalPolicyBundleSelection(principalPolicies))
    .from(principalPolicies)
    .orderBy(
      asc(principalPolicies.principalType),
      asc(principalPolicies.principalId),
    );
  const historyRows = await db
    .select(principalPolicyBundleSelection(principalPolicyBundleHistory))
    .from(principalPolicyBundleHistory)
    .orderBy(
      asc(principalPolicyBundleHistory.principalType),
      asc(principalPolicyBundleHistory.principalId),
      asc(principalPolicyBundleHistory.stateHash),
    );

  const bundles: PrincipalPolicyBundleResponse[] = [];

  for (const rawRow of [...rows, ...historyRows]) {
    const row = parsePrincipalPolicyRow(rawRow);

    if (!row) {
      continue;
    }

    bundles.push(parsePrincipalPolicyBundle(row));
  }

  return bundles;
}

export async function loadPrincipalPolicyStateHash(
  execSql: ExecSql,
  principalType: PrincipalStateResponse["principalType"],
  principalId: string,
): Promise<string | null> {
  await ensurePrincipalPolicyTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ stateHash: principalPolicies.stateHash })
    .from(principalPolicies)
    .where(
      and(
        eq(principalPolicies.principalType, principalType),
        eq(principalPolicies.principalId, principalId),
      ),
    )
    .limit(1);

  return rows[0]?.stateHash ?? null;
}

function policyBundleRow(
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
): PrincipalPolicyRow {
  return {
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    stateHash: bundle.currentState.stateHash,
    currentStateJson: JSON.stringify(bundle.currentState),
    currentPayloadJson: JSON.stringify(bundle.currentPayload),
    currentProjectionJson: JSON.stringify(bundle.currentProjection),
    currentGrantsJson: JSON.stringify(bundle.currentGrants),
    currentMemberEnvelopesJson: JSON.stringify(bundle.currentMemberEnvelopes),
    previousStatesJson: JSON.stringify(bundle.previousStates),
    updatedAt,
  };
}

function assertNoHeadConflict(
  incoming: StoredPrincipalPolicyHead,
  checkpoint: StoredPrincipalPolicyHead | null,
): void {
  if (
    checkpoint &&
    incoming.version === checkpoint.version &&
    incoming.stateHash !== checkpoint.stateHash
  ) {
    throw new KeyingVerificationError(
      "equivocation",
      "principal policy bundle conflicts with the cached head at one version",
    );
  }
}

async function archiveOlderPolicyBundle(
  tx: ClientSQLiteTransactionScope,
  storedPolicy: SelectedPrincipalPolicyRow | undefined,
  storedHead: StoredPrincipalPolicyHead | null,
  incomingHead: StoredPrincipalPolicyHead,
): Promise<void> {
  if (
    !storedPolicy ||
    !storedHead ||
    storedHead.version >= incomingHead.version
  ) {
    return;
  }
  const archiveRow = parsePrincipalPolicyRow(storedPolicy);
  if (!archiveRow) {
    return;
  }
  try {
    parsePrincipalPolicyBundle(archiveRow);
    await tx
      .insert(principalPolicyBundleHistory)
      .values(archiveRow)
      .onConflictDoNothing()
      .run();
  } catch {
    // A corrupt cache row is replaced, never retained as key material.
  }
}

async function writePrincipalPolicyBundle(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
  nextRow: PrincipalPolicyRow,
  incomingHead: StoredPrincipalPolicyHead,
): Promise<void> {
  const wherePrincipal = and(
    eq(principalPolicies.principalType, nextRow.principalType),
    eq(principalPolicies.principalId, nextRow.principalId),
  );
  const [storedPolicy] = await tx
    .select(principalPolicyBundleSelection(principalPolicies))
    .from(principalPolicies)
    .where(wherePrincipal)
    .limit(1);
  const [durableCheckpoint] = await tx
    .select({
      stateHash: principalPolicyCheckpoints.stateHash,
      version: principalPolicyCheckpoints.version,
    })
    .from(principalPolicyCheckpoints)
    .where(
      and(
        eq(principalPolicyCheckpoints.principalType, nextRow.principalType),
        eq(principalPolicyCheckpoints.principalId, nextRow.principalId),
      ),
    )
    .limit(1);
  const storedHead = storedPolicy
    ? parseStoredPrincipalPolicyHead(storedPolicy.currentStateJson)
    : null;
  if (
    storedPolicy &&
    storedHead?.version === incomingHead.version &&
    storedHead.stateHash === incomingHead.stateHash
  ) {
    assertSameHeadPrincipalPolicyBundle(storedPolicy, nextRow);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
    return;
  }
  const [retainedPolicy] = await tx
    .select(principalPolicyBundleSelection(principalPolicyBundleHistory))
    .from(principalPolicyBundleHistory)
    .where(
      and(
        eq(principalPolicyBundleHistory.principalType, nextRow.principalType),
        eq(principalPolicyBundleHistory.principalId, nextRow.principalId),
        eq(principalPolicyBundleHistory.stateHash, nextRow.stateHash),
      ),
    )
    .limit(1);
  if (retainedPolicy) {
    assertSameHeadPrincipalPolicyBundle(retainedPolicy, nextRow);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
  }
  const effectiveHead =
    durableCheckpoint &&
    (!storedHead || durableCheckpoint.version >= storedHead.version)
      ? durableCheckpoint
      : storedHead;
  assertNoHeadConflict(incomingHead, storedHead);
  assertNoHeadConflict(incomingHead, durableCheckpoint ?? null);
  if (effectiveHead && incomingHead.version < effectiveHead.version) {
    return;
  }

  await archiveOlderPolicyBundle(tx, storedPolicy, storedHead, incomingHead);
  await tx
    .insert(principalPolicies)
    .values(nextRow)
    .onConflictDoUpdate({
      target: [principalPolicies.principalType, principalPolicies.principalId],
      set: nextRow,
    })
    .run();
  await tx
    .delete(principalPolicyBundleHistory)
    .where(
      and(
        eq(principalPolicyBundleHistory.principalType, nextRow.principalType),
        eq(principalPolicyBundleHistory.principalId, nextRow.principalId),
        eq(principalPolicyBundleHistory.stateHash, nextRow.stateHash),
      ),
    )
    .run();
  await indexPrincipalPolicyBundleInTransaction(tx, bundle);
}

export async function writePrincipalPolicyBundleInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  await recordPrincipalPolicyBundleOrganizationInTransaction(
    tx,
    bundle,
    organizationId,
  );
  await writePrincipalPolicyBundle(
    tx,
    bundle,
    policyBundleRow(bundle, updatedAt),
    bundle.currentState,
  );
}

export async function assertPrincipalPolicyBundleStoredInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
): Promise<void> {
  const expected = policyBundleRow(bundle, bundle.currentState.createdAt);
  const [stored] = await tx
    .select(principalPolicyBundleSelection(principalPolicies))
    .from(principalPolicies)
    .where(
      and(
        eq(principalPolicies.principalType, expected.principalType),
        eq(principalPolicies.principalId, expected.principalId),
      ),
    )
    .limit(1);
  if (!stored) {
    throw new Error("Verified principal policy bundle was not persisted");
  }
  assertSameHeadPrincipalPolicyBundle(stored, expected);
}

export async function retainPrincipalPolicyBundleInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  const row = policyBundleRow(bundle, updatedAt);
  await recordPrincipalPolicyOrganizationInTransaction(tx, {
    organizationId,
    principalId: row.principalId,
    principalType: row.principalType,
  });
  const [current] = await tx
    .select(principalPolicyBundleSelection(principalPolicies))
    .from(principalPolicies)
    .where(
      and(
        eq(principalPolicies.principalType, row.principalType),
        eq(principalPolicies.principalId, row.principalId),
      ),
    )
    .limit(1);
  if (current?.stateHash === row.stateHash) {
    assertSameHeadPrincipalPolicyBundle(current, row);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
    return;
  }
  const [retained] = await tx
    .select(principalPolicyBundleSelection(principalPolicyBundleHistory))
    .from(principalPolicyBundleHistory)
    .where(
      and(
        eq(principalPolicyBundleHistory.principalType, row.principalType),
        eq(principalPolicyBundleHistory.principalId, row.principalId),
        eq(principalPolicyBundleHistory.stateHash, row.stateHash),
      ),
    )
    .limit(1);
  if (retained) {
    assertSameHeadPrincipalPolicyBundle(retained, row);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
    return;
  }
  await tx.insert(principalPolicyBundleHistory).values(row).run();
  await indexPrincipalPolicyBundleInTransaction(tx, bundle);
}

export async function savePrincipalPolicyBundle(
  execSql: ExecSql,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
  organizationId?: string | undefined,
  options?: { stillCurrent?: (() => boolean) | undefined } | undefined,
): Promise<void> {
  await ensureSqlTables(execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
  ]);

  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const save = (tx: ClientSQLiteTransactionScope) =>
    writePrincipalPolicyBundleInTransaction(
      tx,
      bundle,
      updatedAt,
      organizationId,
    );
  if (options?.stillCurrent) {
    await runtime.guardedTransaction(save, options.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(save, { behavior: "immediate" });
}
