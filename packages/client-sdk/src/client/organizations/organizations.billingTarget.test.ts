import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import type { ContainerContents } from "../containerContents";
import { createOrganizations } from ".";

test("replacement billing mutations use their explicit organization target", async () => {
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
  const workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId: activeOrganizationId, userId: "user-1" },
    execSql,
  });
  const organizations = createOrganizations(
    createInternalRuntimeFixture(() => workflowInput),
    {} as ContainerContents,
  );

  try {
    await organizations.loadStripeCheckoutOptions(replacementOrganizationId);
    await organizations.createStripeCheckout(replacementOrganizationId);
    await organizations.createStripeCheckoutSession(
      "https://app.test/billing",
      replacementOrganizationId,
    );
    await organizations.startTrial(replacementOrganizationId);

    expect(requests).toEqual([
      { operation: "options", organizationId: replacementOrganizationId },
      { operation: "checkout", organizationId: replacementOrganizationId },
      {
        operation: "hosted-checkout",
        organizationId: replacementOrganizationId,
      },
      { operation: "trial", organizationId: replacementOrganizationId },
    ]);

    await organizations.loadStripeCheckoutOptions("");
    await organizations.createStripeCheckout("");
    await organizations.createStripeCheckoutSession(
      "https://app.test/billing",
      "",
    );
    await organizations.startTrial("");
    expect(requests).toHaveLength(4);
  } finally {
    close();
  }
});
