import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatAssignments,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { getDefaultOrganizationId } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";

test("a native tier accepts an over-capacity member without assigning a sync seat", async () => {
  const admin = createTestUser();
  const member = createTestUser();
  await registerUser(admin);
  await authenticate(admin);
  await registerUser(member);
  const organizationId = await getDefaultOrganizationId(admin.userId);
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerProductId: "sync_solo_monthly",
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  await addOrganizationMember({ actor: admin, member, organizationId });
  const [rosterEntry] = await db
    .select({ userId: organizationRosterEntries.userId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(rosterEntry?.userId).toBe(member.userId);
  const assignments = await db
    .select({ userId: organizationBillingSeatAssignments.userId })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(organizationBillingSeatAssignments.organizationId, organizationId),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  expect(assignments.map((assignment) => assignment.userId)).toEqual([
    admin.userId,
  ]);
});
