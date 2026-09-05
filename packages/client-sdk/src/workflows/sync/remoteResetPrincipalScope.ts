import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
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
  const [policyRows, retainedRows, ownershipRows] = await Promise.all([
    tx
      .select({
        id: principalPolicies.principalId,
        type: principalPolicies.principalType,
      })
      .from(principalPolicies),
    Promise.all(
      [
        principalPolicyBundleHistory,
        principalPolicyBundleReferences,
        principalPolicyCheckpoints,
      ].map((table) =>
        tx
          .selectDistinct({ id: table.principalId, type: table.principalType })
          .from(table),
      ),
    ),
    tx
      .select({
        organizationId: principalPolicyOrganizations.organizationId,
        principalId: principalPolicyOrganizations.principalId,
        principalType: principalPolicyOrganizations.principalType,
      })
      .from(principalPolicyOrganizations),
  ]);
  const owners = new Map(
    ownershipRows.map((row) => [
      `${row.principalType}\0${row.principalId}`,
      row.organizationId,
    ]),
  );
  for (const row of [...policyRows, ...retainedRows.flat()]) {
    const owner = owners.get(`${row.type}\0${row.id}`);
    if (row.type === "group" && !owner) {
      throw new Error(
        "Unowned group policy cache requires a local database reset before organization purge",
      );
    }
    if (row.type !== "group" && row.type !== "organization") {
      throw new Error("Principal policy cache has an invalid principal type");
    }
    if (
      row.type === "organization" &&
      owner !== undefined &&
      owner !== row.id
    ) {
      throw new Error(
        "Organization policy cache ownership does not match its identity",
      );
    }
  }
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
    if (!row.organizationId) {
      throw new Error(
        "Principal policy cache ownership requires a local database reset",
      );
    }
    if (row.organizationId !== organizationId) continue;
    keys.set(`${row.principalType}\0${row.principalId}`, {
      principalId: row.principalId,
      principalType: row.principalType,
    });
  }
  return { policyRows, principalKeys: [...keys.values()] };
}
