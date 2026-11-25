import { expect, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  OrganizationTwoFactorRequiredError,
  withRequestTwoFactorStanding,
} from "../../utils/requestTwoFactorStanding";
import {
  assertDocumentSyncBillingAllowed,
  assertOrganizationCanSync,
  assertOrganizationSyncEndpointAvailable,
} from "./organizationSyncEligibility";

const REQUIRED = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

// The refusal comes before any billing read, so an executor that fails on
// use proves no statement ran for a session the organization refuses.
const unusedExecutor = new Proxy(
  {},
  {
    get() {
      throw new Error("billing was read for a refused session");
    },
  },
) as DatabaseSession;

test("every sync gate refuses a session the organization requires two-factor of", async () => {
  const gates = [
    () => assertOrganizationSyncEndpointAvailable(unusedExecutor, REQUIRED),
    () => assertOrganizationCanSync(unusedExecutor, REQUIRED, USER),
    () =>
      assertDocumentSyncBillingAllowed(unusedExecutor, {
        organizationId: REQUIRED,
        requireWriteEntitlement: false,
        userId: USER,
      }),
  ];
  await withRequestTwoFactorStanding(
    { twoFactorRequiredOrganizationIds: [REQUIRED], twoFactorVerified: false },
    async () => {
      for (const gate of gates) {
        await expect(gate()).rejects.toBeInstanceOf(
          OrganizationTwoFactorRequiredError,
        );
      }
    },
  );
});
