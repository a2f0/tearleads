import type {
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import { principalPolicies, principalPolicyTables } from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

interface PrincipalPolicyRow {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  currentStateJson: string;
  currentPayloadJson: string;
  currentProjectionJson: string;
  currentMemberEnvelopesJson: string;
  previousStatesJson: string;
}

interface SelectedPrincipalPolicyRow {
  principalType: string;
  principalId: string;
  stateHash: string;
  currentStateJson: string;
  currentPayloadJson: string;
  currentProjectionJson: string;
  currentMemberEnvelopesJson: string;
  previousStatesJson: string;
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
    currentMemberEnvelopesJson: row.currentMemberEnvelopesJson,
    previousStatesJson: row.previousStatesJson,
  };
}

function parsePrincipalPolicyBundle(
  row: PrincipalPolicyRow,
): PrincipalPolicyBundleResponse {
  const currentState = JSON.parse(row.currentStateJson);
  const currentPayload = JSON.parse(row.currentPayloadJson);
  const currentProjection = JSON.parse(row.currentProjectionJson);
  const currentMemberEnvelopes = JSON.parse(row.currentMemberEnvelopesJson);
  const previousStates = JSON.parse(row.previousStatesJson);
  const bundle = {
    currentState,
    currentPayload,
    currentProjection,
    currentMemberEnvelopes,
    previousStates,
  };

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

const principalPolicyBundleSelection = {
  principalType: principalPolicies.principalType,
  principalId: principalPolicies.principalId,
  stateHash: principalPolicies.stateHash,
  currentStateJson: principalPolicies.currentStateJson,
  currentPayloadJson: principalPolicies.currentPayloadJson,
  currentProjectionJson: principalPolicies.currentProjectionJson,
  currentMemberEnvelopesJson: principalPolicies.currentMemberEnvelopesJson,
  previousStatesJson: principalPolicies.previousStatesJson,
};

export async function loadPrincipalPolicyBundle(
  execSql: ExecSql,
  principalType: PrincipalStateResponse["principalType"],
  principalId: string,
): Promise<PrincipalPolicyBundleResponse | null> {
  await ensurePrincipalPolicyTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(principalPolicyBundleSelection)
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
    .select(principalPolicyBundleSelection)
    .from(principalPolicies)
    .orderBy(
      asc(principalPolicies.principalType),
      asc(principalPolicies.principalId),
    );

  const bundles: PrincipalPolicyBundleResponse[] = [];

  for (const rawRow of rows) {
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

export async function savePrincipalPolicyBundle(
  execSql: ExecSql,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
): Promise<void> {
  await ensurePrincipalPolicyTables(execSql);

  const nextRow = {
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    stateHash: bundle.currentState.stateHash,
    currentStateJson: JSON.stringify(bundle.currentState),
    currentPayloadJson: JSON.stringify(bundle.currentPayload),
    currentProjectionJson: JSON.stringify(bundle.currentProjection),
    currentMemberEnvelopesJson: JSON.stringify(bundle.currentMemberEnvelopes),
    previousStatesJson: JSON.stringify(bundle.previousStates),
    updatedAt,
  };

  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(principalPolicies)
      .values(nextRow)
      .onConflictDoUpdate({
        target: [
          principalPolicies.principalType,
          principalPolicies.principalId,
        ],
        set: nextRow,
      })
      .run();
  });
}
