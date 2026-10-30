import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { principalPolicyOrganizations } from "../../sqlite/schema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

interface PrincipalPolicyOrganizationInput {
  readonly organizationId?: string | undefined;
  readonly principalId: string;
  readonly principalType: PrincipalStateResponse["principalType"];
}

function resolveOrganizationId(
  input: PrincipalPolicyOrganizationInput,
): string {
  if (input.principalType === "organization") {
    if (
      input.organizationId !== undefined &&
      input.organizationId !== input.principalId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "organization policy cache ownership targets another organization",
      );
    }
    return input.principalId;
  }
  if (!input.organizationId) {
    throw new Error("Group policy cache writes require an organization ID");
  }
  return input.organizationId;
}

/** Pins cache ownership in the same transaction as the cached policy state. */
export async function recordPrincipalPolicyOrganizationInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: PrincipalPolicyOrganizationInput,
): Promise<void> {
  const organizationId = resolveOrganizationId(input);
  const wherePrincipal = and(
    eq(principalPolicyOrganizations.principalType, input.principalType),
    eq(principalPolicyOrganizations.principalId, input.principalId),
  );
  const [stored] = await tx
    .select({ organizationId: principalPolicyOrganizations.organizationId })
    .from(principalPolicyOrganizations)
    .where(wherePrincipal)
    .limit(1);
  if (stored && stored.organizationId !== organizationId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "principal policy cache is already owned by another organization",
    );
  }
  await tx
    .insert(principalPolicyOrganizations)
    .values({ ...input, organizationId })
    .onConflictDoNothing()
    .run();
}

// A lookup binds its principal type once.
const OWNER_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 1);
const OWNER_WRITE_BATCH_SIZE = sqliteInsertBatchSize(
  principalPolicyOrganizations,
);

function slices<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

async function loadPrincipalPolicyOrganizations(
  tx: ClientSQLiteTransactionScope,
  inputs: readonly PrincipalPolicyOrganizationInput[],
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const idsByType = new Map<
    PrincipalPolicyOrganizationInput["principalType"],
    Set<string>
  >();
  for (const input of inputs)
    idsByType.set(
      input.principalType,
      (idsByType.get(input.principalType) ?? new Set()).add(input.principalId),
    );
  for (const [principalType, ids] of idsByType)
    for (const batch of slices([...ids], OWNER_LOOKUP_BATCH_SIZE)) {
      const rows = await tx
        .select({
          principalId: principalPolicyOrganizations.principalId,
          organizationId: principalPolicyOrganizations.organizationId,
        })
        .from(principalPolicyOrganizations)
        .where(
          and(
            eq(principalPolicyOrganizations.principalType, principalType),
            inArray(principalPolicyOrganizations.principalId, batch),
          ),
        );
      for (const row of rows)
        owners.set(
          JSON.stringify([principalType, row.principalId]),
          row.organizationId,
        );
    }
  return owners;
}

/**
 * The set form of `recordPrincipalPolicyOrganizationInTransaction`: one read
 * per principal type, the same checks replayed in order (so the first failing
 * input throws the same error), then one multi-row insert of the new owners.
 */
export async function recordPrincipalPolicyOrganizationsInTransaction(
  tx: ClientSQLiteTransactionScope,
  inputs: readonly PrincipalPolicyOrganizationInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  const owners = await loadPrincipalPolicyOrganizations(tx, inputs);
  const inserted: (PrincipalPolicyOrganizationInput & {
    readonly organizationId: string;
  })[] = [];
  for (const input of inputs) {
    const organizationId = resolveOrganizationId(input);
    const key = JSON.stringify([input.principalType, input.principalId]);
    const stored = owners.get(key);
    if (stored !== undefined && stored !== organizationId)
      throw new KeyingVerificationError(
        "object_mismatch",
        "principal policy cache is already owned by another organization",
      );
    if (stored !== undefined) continue;
    owners.set(key, organizationId);
    inserted.push({
      principalType: input.principalType,
      principalId: input.principalId,
      organizationId,
    });
  }
  for (const batch of slices(inserted, OWNER_WRITE_BATCH_SIZE))
    await tx
      .insert(principalPolicyOrganizations)
      .values(batch)
      .onConflictDoNothing()
      .run();
}

export function recordPrincipalPolicyBundleOrganizationInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: { readonly currentState: PrincipalStateResponse },
  organizationId?: string | undefined,
): Promise<void> {
  return recordPrincipalPolicyOrganizationInTransaction(tx, {
    organizationId,
    principalId: bundle.currentState.principalId,
    principalType: bundle.currentState.principalType,
  });
}
