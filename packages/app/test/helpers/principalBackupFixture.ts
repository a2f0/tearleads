import {
  clientSQLiteSchema,
  defineSqlTableSchema,
} from "@tearleads/client-sdk/sqlite";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { readBackupDatabase } from "../../src/providers/db/localBackupDatabase";
import type {
  BackupSqlRow,
  BackupTable,
} from "../../src/providers/db/localBackupFormat";

// Shape-only fixtures: cryptographic producer round-trips are exercised separately.
export const backupProjection = [
  {
    userId: "11111111-1111-4111-8111-111111111111",
    role: "admin",
    identityBundleFingerprint: "a".repeat(64),
  },
];
export const backupHead = {
  principalType: "group",
  principalId: "22222222-2222-4222-8222-222222222222",
  version: 1,
  keyEpoch: 1,
  keyFingerprint: "b".repeat(64),
  stateHash: "c".repeat(64),
};
const state = {
  ...backupHead,
  createdAt: "2026-11-11T00:00:00.000Z",
  signedAt: "2026-11-11T00:00:00.000Z",
  encapsulationPublicKey: "key",
  externalAuthority: null,
  grantCount: 0,
  grantRoot: "d".repeat(64),
  memberCount: 1,
  memberEnvelopesRoot: "e".repeat(64),
  membershipMode: "projection",
  membershipRoot: "f".repeat(64),
  payloadCiphertextHash: "a".repeat(64),
  prevStateHash: null,
  projectionRoot: "b".repeat(64),
  signature: "signature",
  signerUserId: backupProjection[0]?.userId,
  signerUserKeyFingerprint: "c".repeat(64),
};
export const backupEntry = { state, projection: backupProjection, grants: [] };
export const backupCurrent = {
  currentState: state,
  currentProjection: backupProjection,
  currentGrants: [],
  currentPayload: {
    principalType: state.principalType,
    principalId: state.principalId,
    stateHash: state.stateHash,
    createdAt: state.createdAt,
    cipherSuite: "aes-256-gcm",
    ciphertext: "ciphertext",
    ciphertextHash: state.payloadCiphertextHash,
  },
  currentMemberEnvelopes: {
    principalType: state.principalType,
    principalId: state.principalId,
    stateHash: state.stateHash,
    epoch: 1,
    envelopes: [],
  },
};
export const backupPolicyRequest = {
  state,
  projection: backupProjection,
  grants: [],
  memberEnvelopes: [],
  encryptedPayload: {
    cipherSuite: "aes-256-gcm",
    ciphertext: "ciphertext",
    ciphertextHash: state.payloadCiphertextHash,
  },
};

export async function identityBackupTable(
  name:
    | "principalPolicyBundles"
    | "principalHistoryPrefixes"
    | "principalHistoryStages"
    | "principalHistoryEntries"
    | "principalMutationJournal"
    | "organizationProvisioningAttempts",
  overrides: BackupSqlRow = {},
): Promise<BackupTable> {
  const db = createNativeTestExecSql();
  try {
    await db.execSql(defineSqlTableSchema(clientSQLiteSchema[name]).createSql);
    const table = (await readBackupDatabase({ execSql: db.execSql })).tables[0];
    if (!table) throw new Error("Missing fixture schema");
    const values: BackupSqlRow = {
      identity_bundle_format: 1,
      current_state_json: JSON.stringify(state),
      current_projection_json: JSON.stringify(backupProjection),
      current_grants_json: "[]",
      current_member_envelopes_json: JSON.stringify(
        backupCurrent.currentMemberEnvelopes,
      ),
      current_payload_json: JSON.stringify(backupCurrent.currentPayload),
      previous_states_json: JSON.stringify([backupEntry]),
      head_json: JSON.stringify(backupHead),
      current_json: JSON.stringify(backupCurrent),
      entry_json: JSON.stringify(backupEntry),
      progress: "authenticated-opaque-progress",
      root_hash: null,
      is_current: 1,
      version: 1,
      after_version: 0,
      complete: 0,
      touched_at: 0,
      creation_intent: null,
      serialized_request: JSON.stringify({
        kind: "organization",
        groupId: null,
        request: backupPolicyRequest,
      }),
      serialized_artifacts: JSON.stringify({
        initialAdminGroup: {
          groupId: backupHead.principalId,
          initialGroupPolicy: backupPolicyRequest,
        },
        initialMemberGroup: {
          groupId: backupHead.principalId,
          initialGroupPolicy: backupPolicyRequest,
        },
        initialOrganizationPolicy: backupPolicyRequest,
      }),
      ...overrides,
    };
    return {
      ...table,
      rows: [
        Object.fromEntries(
          table.columns.map((column) => [
            column,
            values[column] ?? (column in values ? null : "fixture"),
          ]),
        ),
      ],
    };
  } finally {
    db.close();
  }
}
