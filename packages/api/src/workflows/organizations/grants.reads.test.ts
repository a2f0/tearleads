import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  containers,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { observeDatabaseSelects } from "../../../test/helpers/observeDatabaseQueries";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { listOrganizationContainerGrantResponsesInTransaction } from "./grants";

test("grant subjects retain their fingerprint without fetching public keys", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const [template] = await db
    .select({ grant: accessManifestContainerGrantProjection })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      containers,
      eq(containers.id, accessManifestContainerGrantProjection.containerId),
    )
    .where(eq(containers.organizationId, organizationId))
    .limit(1);
  if (!template) throw new Error("Missing grant fixture");
  // Exercise the listing projection; this is not an authorization fixture.
  await db.insert(accessManifestContainerGrantProjection).values({
    ...template.grant,
    id: crypto.randomUUID(),
    subjectType: "user",
    subjectId: owner.userId,
  });
  const observed = observeDatabaseSelects(db);
  const grants = await listOrganizationContainerGrantResponsesInTransaction({
    executor: observed.database,
    organizationId,
  });
  expect(
    grants.some(
      (grant) =>
        grant.userId === owner.userId &&
        grant.signingKeyFingerprint === owner.fingerprint,
    ),
  ).toBe(true);
  const userReads = observed.selections.filter(
    (selection) =>
      typeof selection === "object" &&
      selection !== null &&
      Object.values(selection).includes(users.fingerprint),
  );
  expect(userReads).toHaveLength(1);
  expect(Object.keys(userReads[0] as object).sort()).toEqual([
    "signingKeyFingerprint",
    "userId",
  ]);
});
