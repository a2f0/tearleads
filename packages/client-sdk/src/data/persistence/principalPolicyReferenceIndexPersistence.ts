import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { principalPolicyBundleStates } from "../principalPolicyStates";
import { principalPolicyBundleReferences } from "../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

type PrincipalPolicyReferenceRow =
  typeof principalPolicyBundleReferences.$inferInsert;

function exactReferenceWhere(row: PrincipalPolicyReferenceRow) {
  return and(
    eq(principalPolicyBundleReferences.principalType, row.principalType),
    eq(principalPolicyBundleReferences.principalId, row.principalId),
    eq(principalPolicyBundleReferences.version, row.version),
    eq(principalPolicyBundleReferences.stateHash, row.stateHash),
    eq(principalPolicyBundleReferences.keyEpoch, row.keyEpoch),
    eq(principalPolicyBundleReferences.keyFingerprint, row.keyFingerprint),
  );
}

async function assertNoIndexedConflict(
  tx: ClientSQLiteTransactionScope,
  row: PrincipalPolicyReferenceRow,
): Promise<void> {
  const conflicts = await tx
    .select({
      bundleStateHash: principalPolicyBundleReferences.bundleStateHash,
    })
    .from(principalPolicyBundleReferences)
    .where(
      and(
        exactReferenceWhere(row),
        eq(principalPolicyBundleReferences.bundleVersion, row.bundleVersion),
      ),
    );
  if (
    conflicts.some(
      ({ bundleStateHash }) => bundleStateHash !== row.bundleStateHash,
    )
  ) {
    throw new KeyingVerificationError(
      "equivocation",
      "principal policy reference has conflicting bundle heads at one version",
    );
  }
}

export async function indexPrincipalPolicyBundleInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
): Promise<void> {
  const head = bundle.currentState;
  for (const state of principalPolicyBundleStates(bundle)) {
    if (
      state.principalType !== head.principalType ||
      state.principalId !== head.principalId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "principal policy bundle reference belongs to another principal",
      );
    }
    const row: PrincipalPolicyReferenceRow = {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      stateHash: state.stateHash,
      keyEpoch: state.keyEpoch,
      keyFingerprint: state.keyFingerprint,
      bundleVersion: head.version,
      bundleStateHash: head.stateHash,
    };
    await assertNoIndexedConflict(tx, row);
    await tx
      .insert(principalPolicyBundleReferences)
      .values(row)
      .onConflictDoNothing()
      .run();
    const [stored] = await tx
      .select({ bundleVersion: principalPolicyBundleReferences.bundleVersion })
      .from(principalPolicyBundleReferences)
      .where(
        and(
          exactReferenceWhere(row),
          eq(
            principalPolicyBundleReferences.bundleStateHash,
            row.bundleStateHash,
          ),
        ),
      )
      .limit(1);
    if (stored?.bundleVersion !== row.bundleVersion) {
      throw new KeyingVerificationError(
        "equivocation",
        "principal policy reference index conflicts with the bundle head",
      );
    }
  }
}
