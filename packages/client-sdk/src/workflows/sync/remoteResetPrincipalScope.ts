import {
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
} from "../../data/sqlite/organizationReadModelSchema";
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

interface PrincipalOwnershipRow extends PrincipalRow {
  readonly organizationId: string;
}

function principalKey(principalType: string, principalId: string): string {
  return `${principalType}\0${principalId}`;
}

function addPrincipalKey(
  keys: Map<string, RemoteResetPrincipalKey>,
  principalType: string,
  principalId: string,
): void {
  if (principalType !== "group" && principalType !== "organization") return;
  keys.set(principalKey(principalType, principalId), {
    principalId,
    principalType,
  });
}

function addOwnershipCandidate(
  candidates: Map<string, Set<string>>,
  row: PrincipalOwnershipRow,
): void {
  const key = principalKey(row.type, row.id);
  const organizations = candidates.get(key) ?? new Set<string>();
  organizations.add(row.organizationId);
  candidates.set(key, organizations);
}

function deriveLegacyOwnershipRows(input: {
  readonly cacheRows: readonly PrincipalRow[];
  readonly groupRows: readonly PrincipalOwnershipRow[];
  readonly ownershipRows: readonly PrincipalOwnershipRow[];
  readonly policyHeadRows: readonly PrincipalOwnershipRow[];
}): PrincipalOwnershipRow[] {
  const candidates = new Map<string, Set<string>>();
  for (const row of input.groupRows) addOwnershipCandidate(candidates, row);
  for (const row of input.policyHeadRows)
    addOwnershipCandidate(candidates, row);

  const existing = new Map(
    input.ownershipRows.map((row) => [principalKey(row.type, row.id), row]),
  );
  const rows = new Map<string, PrincipalOwnershipRow>();
  for (const row of input.cacheRows) {
    if (row.type !== "group" && row.type !== "organization") continue;
    const key = principalKey(row.type, row.id);
    const organizations =
      row.type === "organization"
        ? new Set([row.id])
        : (candidates.get(key) ?? new Set());
    if (organizations.size > 1) {
      throw new Error("Legacy principal policy cache has ambiguous ownership");
    }
    const organizationId = organizations.values().next().value;
    if (!organizationId) continue;
    const stored = existing.get(key);
    if (stored && stored.organizationId !== organizationId) {
      throw new Error(
        "Principal policy cache ownership conflicts with local state",
      );
    }
    if (!stored) {
      rows.set(key, { ...row, organizationId });
    }
  }
  return [...rows.values()];
}

async function loadPrincipalRows(tx: ClientSQLiteTransactionScope) {
  const [
    policyRows,
    policyHistoryRows,
    policyReferenceRows,
    policyCheckpointRows,
    ownershipRows,
    groupRows,
    policyHeadRows,
  ] = await Promise.all([
    tx
      .select({
        id: principalPolicies.principalId,
        type: principalPolicies.principalType,
      })
      .from(principalPolicies),
    tx
      .select({
        id: principalPolicyBundleHistory.principalId,
        type: principalPolicyBundleHistory.principalType,
      })
      .from(principalPolicyBundleHistory),
    tx
      .select({
        id: principalPolicyBundleReferences.principalId,
        type: principalPolicyBundleReferences.principalType,
      })
      .from(principalPolicyBundleReferences),
    tx
      .select({
        id: principalPolicyCheckpoints.principalId,
        type: principalPolicyCheckpoints.principalType,
      })
      .from(principalPolicyCheckpoints),
    tx
      .select({
        id: principalPolicyOrganizations.principalId,
        organizationId: principalPolicyOrganizations.organizationId,
        type: principalPolicyOrganizations.principalType,
      })
      .from(principalPolicyOrganizations),
    tx
      .select({
        id: organizationReadModelGroups.groupId,
        organizationId: organizationReadModelGroups.organizationId,
      })
      .from(organizationReadModelGroups)
      .then((rows) => rows.map((row) => ({ ...row, type: "group" }))),
    tx
      .select({
        id: organizationReadModelPolicyHeads.principalId,
        organizationId: organizationReadModelPolicyHeads.organizationId,
        type: organizationReadModelPolicyHeads.principalType,
      })
      .from(organizationReadModelPolicyHeads),
  ]);
  return {
    cacheRows: [
      ...policyRows,
      ...policyHistoryRows,
      ...policyReferenceRows,
      ...policyCheckpointRows,
    ],
    groupRows,
    ownershipRows,
    policyHeadRows,
    policyRows,
  };
}

/** Backfill legacy cache ownership, then select only the requested org. */
export async function loadRemoteResetPrincipalScope(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<{
  readonly policyRows: readonly PrincipalRow[];
  readonly principalKeys: readonly RemoteResetPrincipalKey[];
}> {
  const rows = await loadPrincipalRows(tx);
  const derivedOwnershipRows = deriveLegacyOwnershipRows(rows);
  if (derivedOwnershipRows.length > 0) {
    await tx
      .insert(principalPolicyOrganizations)
      .values(
        derivedOwnershipRows.map((row) => ({
          organizationId: row.organizationId,
          principalId: row.id,
          principalType: row.type,
        })),
      )
      .onConflictDoNothing()
      .run();
  }
  const ownershipRows = [...rows.ownershipRows, ...derivedOwnershipRows];
  const keys = new Map<string, RemoteResetPrincipalKey>();
  addPrincipalKey(keys, "organization", organizationId);
  for (const row of rows.groupRows) {
    if (row.organizationId === organizationId) {
      addPrincipalKey(keys, row.type, row.id);
    }
  }
  for (const row of rows.policyHeadRows) {
    if (row.organizationId === organizationId) {
      addPrincipalKey(keys, row.type, row.id);
    }
  }
  for (const row of ownershipRows) {
    if (row.organizationId === organizationId) {
      addPrincipalKey(keys, row.type, row.id);
    }
  }
  return { policyRows: rows.policyRows, principalKeys: [...keys.values()] };
}
