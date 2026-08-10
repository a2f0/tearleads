import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../../test/helpers/policyCacheFixtures";
import { trustedUserIdentityFromResponse } from "../../../../test/helpers/trustedUserIdentity";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import { loadVerifiedGroupSharePrincipalPolicy } from "./sharePrincipalPolicy";

test("expected group-head verification reuses an exact local bundle without a policy GET", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-exact-local",
  );
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    let policyGetCount = 0;

    const verified = await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: async () => {
          policyGetCount += 1;
          return bundle;
        },
      }),
      execSql,
      expectedGroupHead: referencedPrincipalStateFromBundle(bundle),
      groupId: bundle.currentState.principalId,
      organizationId: "organization-1",
      resolveTrustedUserIdentity: async () =>
        trustedUserIdentityFromResponse(signerKeyResponse),
    });

    expect(verified.bundle).toEqual(bundle);
    expect(policyGetCount).toBe(0);
  } finally {
    close();
  }
});

test("expected group-head verification fetches once when the local head is wrong", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-wrong-local",
  );
  try {
    const { bundle: cachedBundle } = await createPrincipalPolicyBundle();
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-07-18T00:00:00Z",
    );
    let policyGetCount = 0;

    const verified = await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: async () => {
          policyGetCount += 1;
          return bundle;
        },
      }),
      execSql,
      expectedGroupHead: referencedPrincipalStateFromBundle(bundle),
      groupId: bundle.currentState.principalId,
      organizationId: "organization-1",
      resolveTrustedUserIdentity: async () =>
        trustedUserIdentityFromResponse(signerKeyResponse),
    });

    expect(verified.bundle).toEqual(bundle);
    expect(policyGetCount).toBe(1);
  } finally {
    close();
  }
});

test("generic group-share policy planning remains network-fresh", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-share-policy-network-fresh",
  );
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    let policyGetCount = 0;

    await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: createMockApiClient({
        getCurrentPrincipalPolicy: async () => {
          policyGetCount += 1;
          return bundle;
        },
      }),
      execSql,
      groupId: bundle.currentState.principalId,
      organizationId: "organization-1",
      resolveTrustedUserIdentity: async () =>
        trustedUserIdentityFromResponse(signerKeyResponse),
    });

    expect(policyGetCount).toBe(1);
  } finally {
    close();
  }
});
