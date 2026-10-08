import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createProjectionCheckpointContext } from "../../data/keyingProjectionVerification/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import { cachePrincipalPolicyBundles } from "./policyCache";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

test("offline runtime verification requires protected evidence even with a held full bundle", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await createAuthorityRecoveryFixture(history);
  try {
    await cachePrincipalPolicyBundles({
      execSql: f.options.execSql,
      bundles: [history.directory, history.admin, history.group],
      getCurrentPrincipalPolicy: async (_kind, id) =>
        f.policies.get(id) ?? null,
      organizationId: history.organizationId,
      resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
      reportSecurityIncident: async () => undefined,
    });
    const reference = principalPolicyHead(history.created);
    expect(
      await loadPrincipalPolicyBundleForReference(
        f.options.execSql,
        reference,
        null,
      ),
    ).not.toBeNull();
    let fullReads = 0;
    const warmer = createRuntimePrincipalPolicyWarmer({
      apiClient: createMockApiClient({
        getPrincipalPolicyPages:
          f.options.apiClient.getPrincipalPolicyPages.bind(f.options.apiClient),
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
    });
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
