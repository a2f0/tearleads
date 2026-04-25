import type {
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { SqlRow } from "./sqlSchema";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  type SqlTableSchema,
} from "./sqlSchema";

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

const principalPolicyTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "principal_policies",
    createSql: `
      CREATE TABLE IF NOT EXISTS principal_policies (
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        current_state_json TEXT NOT NULL,
        current_payload_json TEXT NOT NULL,
        current_projection_json TEXT NOT NULL,
        current_member_envelopes_json TEXT NOT NULL,
        previous_states_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_type, principal_id)
      )
    `,
  },
];

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateResponse["principalType"] {
  return value === "group" || value === "organization";
}

function parsePrincipalPolicyRow(row: SqlRow): PrincipalPolicyRow | null {
  const principalType = readSqlRowValue(row, "principal_type");
  const principalId = readSqlRowValue(row, "principal_id");
  const stateHash = readSqlRowValue(row, "state_hash");
  const currentStateJson = readSqlRowValue(row, "current_state_json");
  const currentPayloadJson = readSqlRowValue(row, "current_payload_json");
  const currentProjectionJson = readSqlRowValue(row, "current_projection_json");
  const currentMemberEnvelopesJson = readSqlRowValue(
    row,
    "current_member_envelopes_json",
  );
  const previousStatesJson = readSqlRowValue(row, "previous_states_json");

  if (
    typeof principalType !== "string" ||
    !isManagedPrincipalType(principalType) ||
    typeof principalId !== "string" ||
    typeof stateHash !== "string" ||
    typeof currentStateJson !== "string" ||
    typeof currentPayloadJson !== "string" ||
    typeof currentProjectionJson !== "string" ||
    typeof currentMemberEnvelopesJson !== "string" ||
    typeof previousStatesJson !== "string"
  ) {
    return null;
  }

  return {
    principalType,
    principalId,
    stateHash,
    currentStateJson,
    currentPayloadJson,
    currentProjectionJson,
    currentMemberEnvelopesJson,
    previousStatesJson,
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

export async function loadPrincipalPolicyBundle(
  execSql: ExecSql,
  principalType: PrincipalStateResponse["principalType"],
  principalId: string,
): Promise<PrincipalPolicyBundleResponse | null> {
  await ensurePrincipalPolicyTables(execSql);
  const rows = await execSql(
    `
      SELECT
        principal_type,
        principal_id,
        state_hash,
        current_state_json,
        current_payload_json,
        current_projection_json,
        current_member_envelopes_json,
        previous_states_json
      FROM principal_policies
      WHERE principal_type = :principalType AND principal_id = :principalId
      LIMIT 1
    `,
    {
      ":principalType": principalType,
      ":principalId": principalId,
    },
  );

  const row = rows[0] ? parsePrincipalPolicyRow(rows[0]) : null;
  return row ? parsePrincipalPolicyBundle(row) : null;
}

export async function loadAllPrincipalPolicyBundles(
  execSql: ExecSql,
): Promise<PrincipalPolicyBundleResponse[]> {
  await ensurePrincipalPolicyTables(execSql);
  const rows = await execSql(
    `
      SELECT
        principal_type,
        principal_id,
        state_hash,
        current_state_json,
        current_payload_json,
        current_projection_json,
        current_member_envelopes_json,
        previous_states_json
      FROM principal_policies
      ORDER BY principal_type, principal_id
    `,
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
  const rows = await execSql(
    `
      SELECT state_hash
      FROM principal_policies
      WHERE principal_type = :principalType AND principal_id = :principalId
      LIMIT 1
    `,
    {
      ":principalType": principalType,
      ":principalId": principalId,
    },
  );

  const stateHash = readSqlRowValue(rows[0] ?? {}, "state_hash");
  return typeof stateHash === "string" ? stateHash : null;
}

export async function savePrincipalPolicyBundle(
  execSql: ExecSql,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      `
        INSERT INTO principal_policies (
          principal_type,
          principal_id,
          state_hash,
          current_state_json,
          current_payload_json,
          current_projection_json,
          current_member_envelopes_json,
          previous_states_json,
          updated_at
        )
        VALUES (
          :principalType,
          :principalId,
          :stateHash,
          :currentStateJson,
          :currentPayloadJson,
          :currentProjectionJson,
          :currentMemberEnvelopesJson,
          :previousStatesJson,
          :updatedAt
        )
        ON CONFLICT(principal_type, principal_id) DO UPDATE SET
          state_hash = excluded.state_hash,
          current_state_json = excluded.current_state_json,
          current_payload_json = excluded.current_payload_json,
          current_projection_json = excluded.current_projection_json,
          current_member_envelopes_json = excluded.current_member_envelopes_json,
          previous_states_json = excluded.previous_states_json,
          updated_at = excluded.updated_at
      `,
      {
        ":principalType": bundle.currentState.principalType,
        ":principalId": bundle.currentState.principalId,
        ":stateHash": bundle.currentState.stateHash,
        ":currentStateJson": JSON.stringify(bundle.currentState),
        ":currentPayloadJson": JSON.stringify(bundle.currentPayload),
        ":currentProjectionJson": JSON.stringify(bundle.currentProjection),
        ":currentMemberEnvelopesJson": JSON.stringify(
          bundle.currentMemberEnvelopes,
        ),
        ":previousStatesJson": JSON.stringify(bundle.previousStates),
        ":updatedAt": updatedAt,
      },
    );
  });
}
