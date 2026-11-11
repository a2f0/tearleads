import { expect, test } from "bun:test";
import {
  acknowledgePolicy,
  organizationAdoptionFixture,
  signSuccessorPolicy,
} from "../../../../test/helpers/organizationAdoption";
import {
  createPrimingRuntime,
  pinFounder,
} from "../../../../test/helpers/provisionedPrincipalHistoryFixtures";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { createOrganization } from "./createOrganization";

async function historyRows(execSql: ExecSql) {
  const tables = await execSql(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'principal_history%' ORDER BY name",
  );
  const rows: Record<string, unknown> = {};
  for (const { name } of tables) {
    if (typeof name !== "string" || !/^principal_history_[a-z_]+$/.test(name))
      throw new Error("Unexpected history table");
    rows[name] = await execSql(`SELECT * FROM "${name}" ORDER BY rowid`);
  }
  return rows;
}

test("post-adoption history priming never regresses newer verified policies or progress", async () => {
  const fixture = await organizationAdoptionFixture();
  const { execSql, founder, input, policies, request } = fixture;
  try {
    await pinFounder(execSql, founder);
    const runtime = createPrimingRuntime({
      database: { client: input.dbClient, execSql },
      signingFingerprint: founder.signingFingerprint,
    });
    const primeInput = {
      database: input.dbClient,
      isCurrent: () => true,
      organizationId: request.organizationId,
      policies: {
        adminGroup: policies.admin,
        memberGroup: policies.member,
        organization: policies.organization,
      },
      userId: request.userId,
    };
    for (const policy of Object.values(policies))
      await acknowledgePolicy(execSql, request.organizationId, policy);
    await runtime.primer(primeInput);
    expect(runtime.errors).toEqual([]);
    for (const policy of Object.values(policies)) {
      await acknowledgePolicy(
        execSql,
        request.organizationId,
        await signSuccessorPolicy(
          policy,
          founder.signingKeyPair.signingPrivateKey,
        ),
      );
    }
    const checkpoints = await execSql(
      "SELECT * FROM principal_policy_checkpoints ORDER BY principal_id",
    );
    const bundles = await execSql(
      "SELECT * FROM principal_policy_bundles ORDER BY principal_id, state_hash",
    );
    const progress = await historyRows(execSql);
    expect(Object.keys(progress).length).toBeGreaterThan(0);
    expect(
      await createOrganization({
        ...input,
        primeProvisionedState: runtime.primer,
      }),
    ).toEqual(fixture.response);
    expect(
      await execSql(
        "SELECT * FROM principal_policy_checkpoints ORDER BY principal_id",
      ),
    ).toEqual(checkpoints);
    expect(
      await execSql(
        "SELECT * FROM principal_policy_bundles ORDER BY principal_id, state_hash",
      ),
    ).toEqual(bundles);
    expect(await historyRows(execSql)).toEqual(progress);
    expect(
      await execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});
