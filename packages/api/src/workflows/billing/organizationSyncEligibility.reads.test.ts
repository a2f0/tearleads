import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatAssignments,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import {
  assertDocumentSyncBillingAllowed,
  assertOrganizationCanSync,
} from "./organizationSyncEligibility";

test("sync entitlement and open seat use one read without changing refusal order", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  for (const run of [
    () => assertOrganizationCanSync(db, organizationId, owner.userId),
    () =>
      assertDocumentSyncBillingAllowed(db, {
        organizationId,
        userId: owner.userId,
        requireWriteEntitlement: true,
      }),
  ]) {
    const counter = { statements: 0 };
    await withDatabaseStatementCounter(counter, run);
    expect(counter.statements).toBe(1);
  }
  await db
    .update(organizationBillingSeatAssignments)
    .set({ releasedAt: new Date() })
    .where(
      eq(organizationBillingSeatAssignments.organizationId, organizationId),
    );
  await expect(
    assertOrganizationCanSync(db, organizationId, owner.userId),
  ).rejects.toMatchObject({ reason: "sync_seat_unassigned", status: 402 });
  await db
    .update(organizationBilling)
    .set({ status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  await expect(
    assertOrganizationCanSync(db, organizationId, owner.userId),
  ).rejects.toMatchObject({ reason: "billing_inactive", status: 402 });
});
