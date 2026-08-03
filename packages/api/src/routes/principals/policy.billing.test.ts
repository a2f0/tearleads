import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

test("a native tier capacity conflict is returned as a policy 409", async () => {
  const admin = createTestUser();
  const member = createTestUser();
  await registerUser(admin);
  await authenticate(admin);
  await registerUser(member);
  const organizationId = await getDefaultOrganizationId(admin.userId);
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization");
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerProductId: "sync_solo_monthly",
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  const currentState = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentState, "expected Members policy");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const projection = [
    ...currentProjection.map((entry) => ({
      userId: entry.userId,
      role: entry.role,
    })),
    {
      userId: member.userId,
      role: "member" as const,
    },
  ];
  const signedState = await createSignedPrincipalState({
    keyEpoch: currentState.keyEpoch + 1,
    members: projection.map((entry) => ({ userId: entry.userId })),
    prevStateHash: currentState.stateHash,
    principalId: organization.memberGroupId,
    principalType: "group",
    projection,
    signerUserId: admin.userId,
    signerUserKeyFingerprint: admin.fingerprint,
    signingPrivateKey: admin.signing.signingPrivateKey,
    version: currentState.version + 1,
  });

  const response = await routeApp.request(
    `/principals/group/${organization.memberGroupId}/policy`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${admin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        encryptedPayload: signedState.encryptedPayload,
        memberEnvelopes: signedState.memberEnvelopes,
        projection: signedState.projection,
        state: signedState.state,
      }),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: "billing_native_tier_upgrade_required",
    error: "Upgrade the subscription before adding more than 1 member",
  });
  const [rosterEntry] = await db
    .select({ userId: organizationRosterEntries.userId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(rosterEntry).toBeUndefined();
});
