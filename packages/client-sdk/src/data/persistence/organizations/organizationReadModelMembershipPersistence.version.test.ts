import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { loadOrganizationReadModelGroupMembers } from "./organizationReadModelMembershipPersistence";

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
    `INSERT INTO organization_read_model_group_memberships
      (organization_id, group_id, state_hash)
     VALUES (?, ?, ?)`,
    [input.organizationId, "group-1", `state-${input.organizationId}`],
  );
}

async function loadOrganizationIds(
  execSql: ExecSql,
  table:
    | "organization_read_model_group_memberships"
    | "organization_read_model_state",
): Promise<string[]> {
  const rows = await execSql(
    `SELECT organization_id FROM ${table} ORDER BY organization_id`,
    undefined,
    { rowMode: "array" },
  );
  return rows.map((row) => String(row[0]));
}

test("stale membership loads purge only the outdated organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-stale-version",
  );
  try {
    await loadOrganizationReadModelGroupMembers(
      execSql,
      STALE_ORGANIZATION_ID,
      "group-1",
    );
    await seedState({
      execSql,
      organizationId: STALE_ORGANIZATION_ID,
      protocolVersion: 1,
    });
    await seedState({
      execSql,
      organizationId: CURRENT_ORGANIZATION_ID,
      protocolVersion: 2,
    });

    await expect(
      loadOrganizationReadModelGroupMembers(
        execSql,
        STALE_ORGANIZATION_ID,
        "group-1",
      ),
    ).resolves.toBeNull();

    for (const table of [
      "organization_read_model_group_memberships",
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
