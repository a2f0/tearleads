import { expect, spyOn, test } from "bun:test";
import { type ApiDatabase, db } from "@tearleads/api-shared/postgres";
import { principalStatePayloads } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { OrganizationPolicyHistoryResponseSchema } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { requireDirectOrganizationAccess } from "../../workflows/organizations/access";
import { runGetOrganizationPolicyHistoryWorkflow } from "../../workflows/organizations/policyHistory";

function getHistory(
  actor: TestUser,
  organizationId: string,
  stateHash: string,
) {
  return routeApp.request(
    `/organizations/${organizationId}/policy-history?${new URLSearchParams({ stateHash })}`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
}

test("history returns exact existing evidence without plaintext names, including deleted groups", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const groupId = crypto.randomUUID();
  const creation = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: owner,
          groupId,
          name: "Confidential team name",
          includeActorAsAdmin: false,
        }),
      ),
    },
  );
  expect(creation.status, await creation.clone().text()).toBe(200);
  const target = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!target) throw new Error("Expected organization policy");
  const deleted = await deleteGroupRequest({
    actor: owner,
    groupId,
    organizationId,
  });
  expect(deleted.status, await deleted.clone().text()).toBe(200);
  const deletedPayloads = await db
    .select()
    .from(principalStatePayloads)
    .where(eq(principalStatePayloads.principalId, groupId));
  expect(deletedPayloads).toHaveLength(0);
  const before = await db
    .select()
    .from(principalStatePayloads)
    .where(eq(principalStatePayloads.principalId, organizationId));
  const response = await getHistory(owner, organizationId, target.stateHash);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const raw = await response.text();
  expect(raw).not.toContain("Confidential team name");
  const body = OrganizationPolicyHistoryResponseSchema.parse(JSON.parse(raw));
  expect(body.stateHash).toBe(target.stateHash);
  expect(body.organizationPayloads).toHaveLength(2);
  expect(
    body.groups.find((group) => group.currentState.principalId === groupId)
      ?.currentState.version,
  ).toBe(1);
  expect(
    body.groups.every(
      (group) =>
        !("currentPayload" in group) && !("currentMemberEnvelopes" in group),
    ),
  ).toBe(true);
  const after = await db
    .select()
    .from(principalStatePayloads)
    .where(eq(principalStatePayloads.principalId, organizationId));
  expect(after).toEqual(before);
  let historySelects = 0;
  const countedDb: ApiDatabase = {
    ...db,
    transaction: (operation) =>
      db.transaction(async (tx) => {
        const select = spyOn(tx, "select");
        try {
          await requireDirectOrganizationAccess({
            executor: tx,
            organizationId,
            userId: owner.userId,
          });
          const accessSelects = select.mock.calls.length;
          select.mockClear();
          const result = await operation(tx);
          historySelects = select.mock.calls.length - accessSelects;
          return result;
        } finally {
          select.mockRestore();
        }
      }),
  };
  await runGetOrganizationPolicyHistoryWorkflow(countedDb, {
    organizationId,
    requesterUserId: owner.userId,
    stateHash: target.stateHash,
  });
  expect(historySelects).toBeLessThanOrEqual(5);
});

test("organization members may read history while outsiders and unauthenticated requests are refused", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, member, outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });
  const state = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!state) throw new Error("Expected organization policy");
  expect(
    (await getHistory(member, organizationId, state.stateHash)).status,
  ).toBe(200);
  expect(
    (await getHistory(outsider, organizationId, state.stateHash)).status,
  ).toBe(403);
  expect(
    (
      await routeApp.request(
        `/organizations/${organizationId}/policy-history?stateHash=x`,
      )
    ).status,
  ).toBe(401);
  expect((await getHistory(owner, organizationId, "unknown")).status).toBe(400);
  expect(
    (
      await routeApp.request(
        `/organizations/${organizationId}/policy-history`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      )
    ).status,
  ).toBe(400);
});

test("a requested organization head excludes later group membership versions", async () => {
  const owner = createTestUser();
  const laterMember = createTestUser();
  await registerAndAuthenticate(owner, laterMember);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const before = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!before) throw new Error("Expected organization policy");
  const original = OrganizationPolicyHistoryResponseSchema.parse(
    await (await getHistory(owner, organizationId, before.stateHash)).json(),
  );
  await addMemberGroupUser({
    actor: owner,
    memberUserId: laterMember.userId,
    organizationId,
  });
  const historical = OrganizationPolicyHistoryResponseSchema.parse(
    await (await getHistory(owner, organizationId, before.stateHash)).json(),
  );
  expect(historical).toEqual(original);
  expect(
    historical.groups
      .flatMap((group) => group.currentProjection)
      .some((member) => member.userId === laterMember.userId),
  ).toBe(false);
  const current = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!current) throw new Error("Expected current organization policy");
  const latest = OrganizationPolicyHistoryResponseSchema.parse(
    await (await getHistory(owner, organizationId, current.stateHash)).json(),
  );
  expect(
    latest.groups
      .flatMap((group) => group.currentProjection)
      .some((member) => member.userId === laterMember.userId),
  ).toBe(true);
});
