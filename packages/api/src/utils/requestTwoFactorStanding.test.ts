import { expect, test } from "bun:test";
import {
  assertOrganizationTwoFactorStanding,
  OrganizationTwoFactorRequiredError,
  withRequestTwoFactorStanding,
} from "./requestTwoFactorStanding";

const REQUIRED = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function standing(twoFactorVerified: boolean) {
  return { twoFactorRequiredOrganizationIds: [REQUIRED], twoFactorVerified };
}

test("an unverified session is refused only where it is required", async () => {
  await withRequestTwoFactorStanding(standing(false), async () => {
    await Promise.resolve();
    expect(() => assertOrganizationTwoFactorStanding(OTHER)).not.toThrow();
    let refused: unknown;
    try {
      assertOrganizationTwoFactorStanding(REQUIRED);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(OrganizationTwoFactorRequiredError);
    expect(refused).toMatchObject({ organizationId: REQUIRED, status: 403 });
  });
});

test("a verified session and work outside a request pass", async () => {
  await withRequestTwoFactorStanding(standing(true), async () => {
    expect(() => assertOrganizationTwoFactorStanding(REQUIRED)).not.toThrow();
  });
  expect(() => assertOrganizationTwoFactorStanding(REQUIRED)).not.toThrow();
});
