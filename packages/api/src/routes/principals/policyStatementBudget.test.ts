import { expect, test } from "bun:test";
import {
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { PrincipalPolicyPageResponseSchema } from "@tearleads/validators/response";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  loadOrganizationGroups,
  registerAndAuthenticateUsers,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

function get(actor: TestUser, path: string) {
  return routeApp.request(path, {
    headers: { Authorization: `Bearer ${actor.token}` },
  });
}

/** Prepare any cold history first, so the counted read is the warm one. */
async function warmGet(actor: TestUser, path: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await get(actor, path);
    if (response.status !== 202) return response;
  }
  throw new Error("Fixture preparation did not converge");
}

async function counted(actor: TestUser, path: string) {
  expect((await warmGet(actor, path)).status).toBe(200);
  const counter = { statements: 0 };
  const response = await withDatabaseStatementCounter(counter, () =>
    get(actor, path),
  );
  expect(response.status).toBe(200);
  return counter.statements;
}

test("warm policy, group member, and billing reads stay within their statement budgets", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);

  const organizationPolicy = await counted(
    owner,
    `/principals/organization/${organizationId}/policy`,
  );
  const groupPolicy = await counted(
    owner,
    `/principals/group/${adminGroupId}/policy`,
  );
  const groupMembers = await counted(
    owner,
    `/organizations/${organizationId}/groups/${adminGroupId}/members`,
  );
  const billing = await counted(
    owner,
    `/organizations/${organizationId}/billing`,
  );

  // Measured with PGlite / SQLite (Postgres equals SQLite): organization
  // policy 14 / 16, group policy 16 / 18, group members 22 / 24 and billing
  // 22 / 24 before the policy-read batch; then 12 / 14, 13 / 15, 19 / 21 and
  // 19 / 21 once current heads, the group tombstone and organization lookup,
  // the stored progress hint, and immutable organization rows were each read
  // once per request. Single-entry/artifact and proof-node batching now use
  // 7 / 9, 8 / 10, 13 / 15 and 13 / 15 respectively.
  expect(organizationPolicy).toBeLessThanOrEqual(
    7 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  expect(groupPolicy).toBeLessThanOrEqual(
    8 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  expect(groupMembers).toBeLessThanOrEqual(
    13 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  expect(billing).toBeLessThanOrEqual(
    13 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
});

test("a conditional organization read of the live head stays within its statement budget", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const path = `/principals/organization/${organizationId}/policy`;
  const { currentState } = PrincipalPolicyPageResponseSchema.parse(
    await (await warmGet(owner, path)).json(),
  );
  const unchanged = await counted(
    owner,
    `${path}?ifVersion=${currentState.version}&ifStateHash=${currentState.stateHash}`,
  );

  // PGlite measures five statements. PostgreSQL retains its two transaction-
  // control allowance; that is not a fresh PostgreSQL measurement. The response
  // omits the page, but live authorization and stored-artifact verification run.
  expect(unchanged).toBeLessThanOrEqual(
    5 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
});

test("a warm organization policy page at 65 versions stays within its statement budget", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const path = `/principals/organization/${organizationId}/policy`;
  const initial = PrincipalPolicyPageResponseSchema.parse(
    await (await warmGet(owner, path)).json(),
  );
  await seedLongPrincipalHistory({
    actor: owner,
    policy: initial,
    throughVersion: 65,
  });

  const page = await counted(owner, path);

  // 113 / 115 (PGlite / SQLite; Postgres equals SQLite) while each of the 32
  // cited older entries cost two statements; 49 / 51 once they were read as
  // one set and the transaction reused its stored progress hint. Level-batched
  // proof nodes and pinned artifact handoffs now use 18 / 20.
  expect(page).toBeLessThanOrEqual(
    18 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 30_000);
