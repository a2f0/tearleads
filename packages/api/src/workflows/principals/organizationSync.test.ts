import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
} from "@tearleads/api-shared/schema";
import { assertPrincipalOrganizationIsSyncEntitled } from "./organizationSync";

test("an entitled organization policy remains writable without a user seat", async () => {
  const organizationId = crypto.randomUUID();
  await db.insert(organizations).values({
    id: organizationId,
    adminGroupId: crypto.randomUUID(),
    memberGroupId: crypto.randomUUID(),
    name: "Seat recovery organization",
  });
  await db.insert(organizationBilling).values({
    organizationId,
    status: "active",
    currentPeriodStartsAt: new Date("2026-08-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2099-09-01T00:00:00.000Z"),
    seatCount: 1,
  });

  await expect(
    assertPrincipalOrganizationIsSyncEntitled(
      db,
      "organization",
      organizationId,
    ),
  ).resolves.toBeUndefined();
});
