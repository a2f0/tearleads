import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import type { ContainerContents } from "../containerContents";
import { createOrganizations } from ".";

test("billing targets follow the current authenticated session", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-explicit-billing-target-test",
  );
  const activeOrganizationId = "active-org";
  const replacementOrganizationId = "replacement-org";
  const requests: Array<{ operation: string; organizationId: string }> = [];
  const apiClient = createMockApiClient({
    createStripeCheckout: async (organizationId) => {
      requests.push({ operation: "checkout", organizationId });
      return null;
    },
    createStripeCheckoutSession: async (organizationId) => {
      requests.push({ operation: "hosted-checkout", organizationId });
      return null;
    },
    getStripeCheckoutOptions: async (organizationId) => {
      requests.push({ operation: "options", organizationId });
      return { data: { options: [] }, ok: true };
    },
    startOrganizationTrial: async (organizationId) => {
      requests.push({ operation: "trial", organizationId });
      return null;
    },
  });
  let workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId: activeOrganizationId, userId: "user-1" },
    execSql,
  });
  const organizations = createOrganizations(
    createInternalRuntimeFixture(() => workflowInput),
    {} as ContainerContents,
  );

  async function runBilling(organizationId?: string) {
    return Promise.all([
      organizations.loadStripeCheckoutOptions(organizationId),
      organizations.createStripeCheckout(organizationId),
      organizations.createStripeCheckoutSession(
        "https://app.test/billing",
        organizationId,
      ),
      organizations.startTrial(organizationId),
    ]);
  }

  try {
    await runBilling(replacementOrganizationId);

    expect(requests).toEqual([
      { operation: "options", organizationId: replacementOrganizationId },
      { operation: "checkout", organizationId: replacementOrganizationId },
      {
        operation: "hosted-checkout",
        organizationId: replacementOrganizationId,
      },
      { operation: "trial", organizationId: replacementOrganizationId },
    ]);

    await expect(runBilling("")).resolves.toEqual([null, null, null, null]);
    expect(requests).toHaveLength(4);

    requests.length = 0;
    await runBilling();
    expect(requests).toEqual([
      { operation: "options", organizationId: activeOrganizationId },
      { operation: "checkout", organizationId: activeOrganizationId },
      { operation: "hosted-checkout", organizationId: activeOrganizationId },
      { operation: "trial", organizationId: activeOrganizationId },
    ]);

    workflowInput = {
      ...workflowInput,
      auth: {
        ...workflowInput.auth,
        organizationId: replacementOrganizationId,
      },
    };
    requests.length = 0;
    await runBilling();
    expect(requests).toEqual([
      { operation: "options", organizationId: replacementOrganizationId },
      { operation: "checkout", organizationId: replacementOrganizationId },
      {
        operation: "hosted-checkout",
        organizationId: replacementOrganizationId,
      },
      { operation: "trial", organizationId: replacementOrganizationId },
    ]);

    for (const auth of [
      { isAuthenticated: false, organizationId: activeOrganizationId },
      { isAuthenticated: true, organizationId: null },
      { isAuthenticated: true, organizationId: "" },
    ]) {
      workflowInput = {
        ...workflowInput,
        auth: { ...workflowInput.auth, ...auth },
      };
      requests.length = 0;
      await expect(runBilling()).resolves.toEqual([null, null, null, null]);
      await expect(runBilling(replacementOrganizationId)).resolves.toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(requests).toEqual([]);
    }
  } finally {
    close();
  }
});
