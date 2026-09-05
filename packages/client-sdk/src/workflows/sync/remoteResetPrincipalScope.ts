import { eq } from "drizzle-orm";
import {
  principalPolicies,
  principalPolicyOrganizations,
} from "../../data/sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";

export interface RemoteResetPrincipalKey {
  readonly principalId: string;
  readonly principalType: "group" | "organization";
}

interface PrincipalRow {
  readonly id: string;
  readonly type: string;
}

/** Current cache writes atomically pin ownership; reset never backfills it. */
export async function loadRemoteResetPrincipalScope(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<{
  readonly policyRows: readonly PrincipalRow[];
  readonly principalKeys: readonly RemoteResetPrincipalKey[];
}> {
  const [policyRows, ownershipRows] = await Promise.all([
    tx
      .select({
        id: principalPolicies.principalId,
        type: principalPolicies.principalType,
      })
      .from(principalPolicies),
    tx
      .select({
        principalId: principalPolicyOrganizations.principalId,
        principalType: principalPolicyOrganizations.principalType,
      })
      .from(principalPolicyOrganizations)
      .where(eq(principalPolicyOrganizations.organizationId, organizationId)),
  ]);
  const keys = new Map<string, RemoteResetPrincipalKey>();
  keys.set(`organization\0${organizationId}`, {
    principalId: organizationId,
    principalType: "organization",
  });
  for (const row of ownershipRows) {
    if (row.principalType !== "group" && row.principalType !== "organization") {
      throw new Error(
        "Principal policy cache ownership has an invalid principal type",
      );
    }
    keys.set(`${row.principalType}\0${row.principalId}`, {
      principalId: row.principalId,
      principalType: row.principalType,
    });
  }
  return { policyRows, principalKeys: [...keys.values()] };
}
