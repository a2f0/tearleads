import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelSnapshot } from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import {
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationUserDetail,
} from "../../../workflows/organizations/localReadModelDetails";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { loadOrganizationReadModelGroupMembers } from "./organizationReadModelMembershipPersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

const CREATED_AT = "2026-07-17T12:00:00.000Z";
const CURRENT_ORGANIZATION_ID = "organization-current";
const STALE_ORGANIZATION_ID = "organization-stale";

async function seedState(input: {
  execSql: ExecSql;
  organizationId: string;
  protocolVersion: number;
}): Promise<void> {
  await input.execSql(
    `INSERT INTO organization_read_model_state
      (organization_id, protocol_version, cursor, profile_document_id, member_group_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      input.protocolVersion,
      `cursor-${input.organizationId}`,
      null,
      `members-${input.organizationId}`,
      CREATED_AT,
    ],
  );
  await input.execSql(
    `INSERT INTO organization_read_model_policy_heads
      (organization_id, principal_type, principal_id, state_hash, state_version,
       key_epoch, key_fingerprint, member_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      "organization",
      input.organizationId,
      `policy-state-${input.organizationId}`,
      1,
      1,
      `policy-key-${input.organizationId}`,
      1,
    ],
  );
  await input.execSql(
    `INSERT INTO organization_read_model_group_memberships
      (organization_id, group_id, state_hash)
     VALUES (?, ?, ?)`,
    [input.organizationId, "group-1", `state-${input.organizationId}`],
  );
  await input.execSql(
    `INSERT INTO organization_read_model_requesters
      (organization_id, user_id, is_org_admin, updated_at)
     VALUES (?, ?, ?, ?)`,
    [input.organizationId, "user-1", 1, CREATED_AT],
  );
  await input.execSql(
    `INSERT INTO organization_read_model_container_grants
      (organization_id, container_id, subject_type, subject_id, sort_order,
       access_level, created_at, depth, is_builtin, metadata_access_epoch,
       metadata_access_state_hash, metadata_document_id, parent_id, updated_at,
       user_id, signing_key_fingerprint, group_id, group_name, organization_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      `container-${input.organizationId}`,
      "user",
      "user-1",
      0,
      "read",
      CREATED_AT,
      1,
      0,
      1,
      `manifest-${input.organizationId}`,
      null,
      null,
      CREATED_AT,
      "user-1",
      "signing-fingerprint-user-1",
      null,
      null,
      null,
    ],
  );
}

async function loadOrganizationIds(
  execSql: ExecSql,
  table:
    | "organization_read_model_container_grants"
    | "organization_read_model_group_memberships"
    | "organization_read_model_policy_heads"
    | "organization_read_model_requesters"
    | "organization_read_model_state",
): Promise<string[]> {
  const rows = await execSql(
    `SELECT organization_id FROM ${table} ORDER BY organization_id`,
    undefined,
    { rowMode: "array" },
  );
  return rows.map((row) => String(row[0]));
}

test("v4 local reads purge every stale v3 authorization projection row", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-stale-version",
  );
  try {
    await loadOrganizationReadModelGroupMembers(
      execSql,
      STALE_ORGANIZATION_ID,
      "group-1",
      "user-1",
    );
    await seedState({
      execSql,
      organizationId: STALE_ORGANIZATION_ID,
      protocolVersion: 3,
    });
    await seedState({
      execSql,
      organizationId: CURRENT_ORGANIZATION_ID,
      protocolVersion: 4,
    });

    const staleRead = {
      currentUserId: "user-1",
      execSql,
      organizationId: STALE_ORGANIZATION_ID,
    };
    await expect(
      loadLocalOrganizationContainerGrants(staleRead),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationUserDetail({ ...staleRead, userId: "user-1" }),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelGroupMembers(
        execSql,
        STALE_ORGANIZATION_ID,
        "group-1",
        "user-1",
      ),
    ).resolves.toBeNull();

    for (const table of [
      "organization_read_model_container_grants",
      "organization_read_model_group_memberships",
      "organization_read_model_policy_heads",
      "organization_read_model_requesters",
      "organization_read_model_state",
    ] as const) {
      await expect(loadOrganizationIds(execSql, table)).resolves.toEqual([
        CURRENT_ORGANIZATION_ID,
      ]);
    }
  } finally {
    close();
  }
});

test("a v4 snapshot replaces v3 local state without translating it", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-v4-strict-reset",
  );
  try {
    await loadOrganizationReadModelProjection(
      execSql,
      STALE_ORGANIZATION_ID,
      "user-1",
    );
    await seedState({
      execSql,
      organizationId: STALE_ORGANIZATION_ID,
      protocolVersion: 3,
    });

    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: null,
        response: organizationReadModelSnapshot(
          STALE_ORGANIZATION_ID,
          "cursor-v4",
        ),
      }),
    ).resolves.toBe("applied");

    await expect(
      loadOrganizationReadModelGroupMembers(
        execSql,
        STALE_ORGANIZATION_ID,
        "group-1",
        "user-1",
      ),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelProjection(
        execSql,
        STALE_ORGANIZATION_ID,
        "user-1",
      ),
    ).resolves.toMatchObject({ cursor: "cursor-v4", protocolVersion: 4 });
  } finally {
    close();
  }
});
