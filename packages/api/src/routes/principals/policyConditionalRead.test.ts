import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalMembershipProjection } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  isPrincipalPolicyPageResponse,
  isPrincipalPolicyUnchangedResponse,
  PrincipalPolicyPageResponseSchema,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  loadOrganizationGroups,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { requestAfterPrincipalPreparation } from "../../../test/helpers/principalPreparationRequest";
import { routeApp } from "../../routeApp";

function get(actor: TestUser, path: string) {
  return requestAfterPrincipalPreparation(path, {
    headers: { Authorization: `Bearer ${actor.token}` },
  });
}

async function currentHead(actor: TestUser, path: string) {
  const response = await get(actor, path);
  expect(response.status, await response.clone().text()).toBe(200);
  const { currentState } = PrincipalPolicyPageResponseSchema.parse(
    await response.json(),
  );
  return currentState;
}

function conditional(path: string, version: number, stateHash: string) {
  return `${path}?ifVersion=${version}&ifStateHash=${stateHash}`;
}

test("a conditional discovery read naming the live head returns that head alone", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  for (const path of [
    `/principals/organization/${organizationId}/policy`,
    `/principals/group/${adminGroupId}/policy`,
  ]) {
    const head = await currentHead(owner, path);
    const response = await get(
      owner,
      conditional(path, head.version, head.stateHash),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      unchanged: true,
      head: {
        principalType: head.principalType,
        principalId: head.principalId,
        version: head.version,
        stateHash: head.stateHash,
        keyEpoch: head.keyEpoch,
        keyFingerprint: head.keyFingerprint,
      },
    });

    // Any other head, older or forged, gets today's full first page.
    for (const named of [
      conditional(path, head.version + 1, head.stateHash),
      conditional(path, head.version, "0".repeat(64)),
    ]) {
      const page = await (await get(owner, named)).json();
      expect(isPrincipalPolicyUnchangedResponse(page)).toBe(false);
      expect(isPrincipalPolicyPageResponse(page)).toBe(true);
      expect(page.currentState.stateHash).toBe(head.stateHash);
    }
  }
});

test("a conditional discovery read keeps live authorization and verification", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  const path = `/principals/group/${adminGroupId}/policy`;
  const head = await currentHead(owner, path);
  const named = conditional(path, head.version, head.stateHash);

  const denied = await get(outsider, named);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({
    error: "Principal policy access denied",
  });

  await db
    .update(principalMembershipProjection)
    .set({ role: "member" })
    .where(eq(principalMembershipProjection.principalId, adminGroupId));
  const tampered = await get(owner, named);
  expect(tampered.status).toBe(409);
  expect(await tampered.json()).toEqual({
    error:
      "Stored principal policy failed integrity verification: principal policy projection root does not match projection",
  });
});

test("a conditional discovery read names one whole unpinned head", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const path = `/principals/organization/${organizationId}/policy`;
  const hash = "a".repeat(64);
  for (const query of [
    "ifVersion=1",
    `ifStateHash=${hash}`,
    `ifVersion=0&ifStateHash=${hash}`,
    `ifVersion=1&ifStateHash=${hash}&stateHash=${hash}`,
    `ifVersion=1&ifStateHash=${hash}&afterVersion=0`,
  ]) {
    const response = await routeApp.request(`${path}?${query}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status, query).toBe(400);
  }
});
