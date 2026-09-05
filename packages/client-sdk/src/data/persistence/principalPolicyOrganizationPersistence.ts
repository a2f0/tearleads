import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { principalPolicyOrganizations } from "../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

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
