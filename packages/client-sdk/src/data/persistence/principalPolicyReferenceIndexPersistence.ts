import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, eq, inArray, or } from "drizzle-orm";
import { principalPolicyBundleStates } from "../principalPolicyStates";
import { principalPolicyBundleReferences } from "../sqlite/schema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

type PrincipalPolicyReferenceRow =
  typeof principalPolicyBundleReferences.$inferInsert;

type StoredPrincipalPolicyReference = Pick<
  typeof principalPolicyBundleReferences.$inferSelect,
  | "version"
  | "stateHash"
  | "keyEpoch"
  | "keyFingerprint"
  | "bundleVersion"
  | "bundleStateHash"
>;

const REFERENCE_INSERT_BATCH_SIZE = sqliteInsertBatchSize(
  principalPolicyBundleReferences,
);
// Principal type and id plus the bundle version and state hash bind once.
const REFERENCE_LOOKUP_VERSIONS = sqliteRowsPerStatement(1, 4);

/** The exact six-field match; the lookup already fixes the principal. */
function isSameReference(
  stored: StoredPrincipalPolicyReference,
  row: PrincipalPolicyReferenceRow,
): boolean {
  return (
    stored.version === row.version &&
    stored.stateHash === row.stateHash &&
    stored.keyEpoch === row.keyEpoch &&
    stored.keyFingerprint === row.keyFingerprint
  );
}

/** The table's primary key within one principal. */
function referenceKey(
  row: Pick<
    StoredPrincipalPolicyReference,
    "version" | "stateHash" | "keyEpoch" | "keyFingerprint" | "bundleStateHash"
  >,
): string {
  return JSON.stringify([
    row.version,
    row.stateHash,
    row.keyEpoch,
    row.keyFingerprint,
    row.bundleStateHash,
  ]);
}

/** Rows either equivocation check can match, read before this bundle's writes. */
async function loadStoredReferences(
  tx: ClientSQLiteTransactionScope,
  head: PrincipalPolicyBundleResponse["currentState"],
  versions: readonly number[],
): Promise<StoredPrincipalPolicyReference[]> {
  const stored: StoredPrincipalPolicyReference[] = [];
  for (
    let index = 0;
    index < versions.length;
    index += REFERENCE_LOOKUP_VERSIONS
  ) {
    stored.push(
      ...(await tx
        .select({
          version: principalPolicyBundleReferences.version,
          stateHash: principalPolicyBundleReferences.stateHash,
          keyEpoch: principalPolicyBundleReferences.keyEpoch,
          keyFingerprint: principalPolicyBundleReferences.keyFingerprint,
          bundleVersion: principalPolicyBundleReferences.bundleVersion,
          bundleStateHash: principalPolicyBundleReferences.bundleStateHash,
        })
        .from(principalPolicyBundleReferences)
        .where(
          and(
            eq(
              principalPolicyBundleReferences.principalType,
              head.principalType,
            ),
            eq(principalPolicyBundleReferences.principalId, head.principalId),
            inArray(
              principalPolicyBundleReferences.version,
              versions.slice(index, index + REFERENCE_LOOKUP_VERSIONS),
            ),
            or(
              eq(principalPolicyBundleReferences.bundleVersion, head.version),
              eq(
                principalPolicyBundleReferences.bundleStateHash,
                head.stateHash,
              ),
            ),
          ),
        )),
    );
  }
  return stored;
}

/**
 * Rows written earlier in the same bundle all carry its head, so neither
 * check can match them: each state's outcome depends only on stored rows.
 */
function referenceConflict(
  row: PrincipalPolicyReferenceRow,
  stored: readonly StoredPrincipalPolicyReference[],
): KeyingVerificationError | null {
  const sameReference = stored.filter((candidate) =>
    isSameReference(candidate, row),
  );
  if (
    sameReference.some(
      (candidate) =>
        candidate.bundleVersion === row.bundleVersion &&
        candidate.bundleStateHash !== row.bundleStateHash,
    )
  )
    return new KeyingVerificationError(
      "equivocation",
      "principal policy reference has conflicting bundle heads at one version",
    );
  const indexed = sameReference.find(
    (candidate) => candidate.bundleStateHash === row.bundleStateHash,
  );
  if (indexed && indexed.bundleVersion !== row.bundleVersion)
    return new KeyingVerificationError(
      "equivocation",
      "principal policy reference index conflicts with the bundle head",
    );
  return null;
}

async function insertMissingReferences(
  tx: ClientSQLiteTransactionScope,
  rows: readonly PrincipalPolicyReferenceRow[],
  stored: readonly StoredPrincipalPolicyReference[],
): Promise<void> {
  const present = new Set(stored.map(referenceKey));
  const missing = new Map<string, PrincipalPolicyReferenceRow>();
  for (const row of rows) {
    const key = referenceKey(row);
    if (!present.has(key) && !missing.has(key)) missing.set(key, row);
  }
  const values = [...missing.values()];
  for (
    let index = 0;
    index < values.length;
    index += REFERENCE_INSERT_BATCH_SIZE
  ) {
    await tx
      .insert(principalPolicyBundleReferences)
      .values(values.slice(index, index + REFERENCE_INSERT_BATCH_SIZE))
      .onConflictDoNothing()
      .run();
  }
}

/**
 * Index every state of a verified bundle under its head. Fails in state order
 * with the per-state checks' errors, keeping the states indexed before the
 * first failure.
 */
export async function indexPrincipalPolicyBundleInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
): Promise<void> {
  const head = bundle.currentState;
  const states = principalPolicyBundleStates(bundle);
  const foreignIndex = states.findIndex(
    (state) =>
      state.principalType !== head.principalType ||
      state.principalId !== head.principalId,
  );
  const rows: PrincipalPolicyReferenceRow[] = (
    foreignIndex === -1 ? states : states.slice(0, foreignIndex)
  ).map((state) => ({
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    stateHash: state.stateHash,
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
    bundleVersion: head.version,
    bundleStateHash: head.stateHash,
  }));
  const stored =
    rows.length === 0
      ? []
      : await loadStoredReferences(tx, head, [
          ...new Set(rows.map((row) => row.version)),
        ]);
  let failure: KeyingVerificationError | null = null;
  let accepted = rows.length;
  for (const [index, row] of rows.entries()) {
    failure = referenceConflict(row, stored);
    if (failure) {
      accepted = index;
      break;
    }
  }
  if (!failure && foreignIndex !== -1)
    failure = new KeyingVerificationError(
      "object_mismatch",
      "principal policy bundle reference belongs to another principal",
    );
  await insertMissingReferences(tx, rows.slice(0, accepted), stored);
  if (failure) throw failure;
}
