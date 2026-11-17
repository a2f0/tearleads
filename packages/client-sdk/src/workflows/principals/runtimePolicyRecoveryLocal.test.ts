import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { principalPolicyHead } from "../../../test/helpers/data/principalPolicyFixtures";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { createProjectionCheckpointContext } from "../../data/keyingProjectionVerification/checkpoints/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../data/keyingProjectionVerification/principalPolicy/principalPolicyVerification";
import { PrincipalPolicyBundleRepository } from "../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { cachePrincipalPolicyBundles } from "./policyCache";
import { PrincipalPolicyService } from "./principalPolicyService";

test("offline runtime verification requires protected evidence even with a held full bundle", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await createAuthorityRecoveryFixture(history);
  try {
    await cachePrincipalPolicyBundles({
      execSql: f.options.execSql,
      bundles: [history.directory, history.admin, history.group],
      currentPolicyReader: {
        getCurrentPrincipalPolicy: async (_kind, id) =>
          f.policies.get(id) ?? null,
      },
      organizationId: history.organizationId,
      resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
      reportSecurityIncident: async () => undefined,
    });
    const reference = principalPolicyHead(history.created);
    expect(
      await new PrincipalPolicyBundleRepository(
        f.options.execSql,
      ).loadPrincipalPolicyBundleForReference(reference, null),
    ).not.toBeNull();
    let fullReads = 0;
    const warmer = new PrincipalPolicyService({
      apiClient: createMockApiClient({
        getPrincipalPolicyPages: f.apiClient.getPrincipalPolicyPages.bind(
          f.apiClient,
        ),
        getCurrentPrincipalPolicy: async () => {
          fullReads += 1;
          throw new Error("Offline full fetch");
        },
      }),
      infra: { execSql: f.options.execSql },
      state: { online: false },
      withPrincipalHistoryProtection: (operation) =>
        operation({
          protection: f.options.protection,
          stillCurrent: () => true,
        }),
      resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
      util: {
        reportSecurityIncident: async () => undefined,
      },
    }).createWarmer();
    await expect(
      collectReferencedPrincipalPolicies({
        checkpointContext: createProjectionCheckpointContext(f.options),
        organizationId: history.organizationId,
        principalPolicyCache: new Map(),
        references: [reference],
        resolveUserKey: f.options.resolveTrustedUserIdentity,
        warmReferencedPrincipalPolicies: warmer,
      }),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(fullReads).toBe(0);
    expect(f.requests).toEqual([]);
  } finally {
    f.close();
  }
}, 15_000);
