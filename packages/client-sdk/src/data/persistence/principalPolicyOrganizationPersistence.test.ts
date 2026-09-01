import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPrincipalPolicyBundle } from "../../../test/helpers/policyCacheFixtures";
import { principalPolicyOrganizations } from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { savePrincipalPolicyBundle } from "./principalPolicyPersistence";

test("policy cache writes pin organization ownership and reject rebinding", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-organization-ownership",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-08-29T00:00:00.000Z",
      "org-one",
    );
    expect(
      await getClientSQLitePersistenceRuntime(execSql)
        .db.select()
        .from(principalPolicyOrganizations),
    ).toEqual([
      {
        organizationId: "org-one",
        principalId: bundle.currentState.principalId,
        principalType: "group",
      },
    ]);

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        bundle,
        "2026-08-29T00:01:00.000Z",
        "org-two",
      ),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    close();
  }
});
