import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  principalPolicyCommits,
} from "@tearleads/api-shared/schema";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { createAtomicEnrollmentFixture } from "../../../test/helpers/atomicGroupEnrollment";
import { createRouteApp } from "../../routeApp";

async function roster(
  fixture: Awaited<ReturnType<typeof createAtomicEnrollmentFixture>>,
) {
  return db
    .select()
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, fixture.organizationId),
        eq(organizationRosterEntries.userId, fixture.member.userId),
      ),
    );
}

test("one commit enrolls a new user in Members and a custom group and replays both receipts", async () => {
  const f = await createAtomicEnrollmentFixture();
  expect(await roster(f)).toEqual([]);
  const response = await f.commit();
  expect(response.status, await response.clone().text()).toBe(200);
  const body: unknown = await response.json();
  invariant(
    isCommitOrganizationGroupPolicyResponse(body),
    "expected compound receipt",
  );
  expect(body.memberPolicy?.currentProjection).toContainEqual({
    userId: f.member.userId,
    role: "member",
  });
  expect(body.groupPolicy.currentProjection).toContainEqual({
    userId: f.member.userId,
    role: "member",
  });
  expect(await roster(f)).toMatchObject([{ status: "active" }]);
  const heads = await f.readHeads();
  const replay = await f.commit();
  expect(replay.status, await replay.clone().text()).toBe(200);
  expect(await replay.json()).toEqual(body);
  expect(await f.readHeads()).toEqual(heads);
}, 20_000);

test("compound enrollment invalidates both group identities only after commit", async () => {
  const f = await createAtomicEnrollmentFixture();
  const events: Record<string, unknown>[] = [];
  const app = createRouteApp({
    publish: async (event) => {
      events.push(event);
    },
  });
  const commit = (request = f.request) =>
    f.commit(request, f.request.groupPolicy.state.principalId, (path, init) =>
      app.request(path, init),
    );
  const refused = await commit({
    ...f.request,
    organizationPolicy: f.staleDirectory,
  });
  expect(refused.status, await refused.clone().text()).toBe(409);
  expect(events).toEqual([]);
  const response = await commit();
  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    events.filter(
      (event) => Reflect.get(event, "type") === "principal_access_changed",
    ),
  ).toEqual([
    {
      type: "principal_access_changed",
      principalType: "group",
      principalId: f.request.groupPolicy.state.principalId,
    },
    {
      type: "principal_access_changed",
      principalType: "group",
      principalId: f.organization.memberGroupId,
    },
  ]);
  const count = events.length;
  expect((await commit()).status).toBe(200);
  expect(events).toHaveLength(count);
}, 20_000);

test("a refused directory rolls back both memberships and the roster enrollment", async () => {
  const f = await createAtomicEnrollmentFixture();
  const receiptsBefore = await db
    .select()
    .from(principalPolicyCommits)
    .where(eq(principalPolicyCommits.organizationId, f.organizationId));
  const response = await f.commit({
    ...f.request,
    organizationPolicy: f.staleDirectory,
  });
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Organization authority descriptor must commit every current group head",
  });
  expect(await f.readHeads()).toEqual(f.before);
  expect(await roster(f)).toEqual([]);
  expect(
    await db
      .select()
      .from(principalPolicyCommits)
      .where(eq(principalPolicyCommits.organizationId, f.organizationId)),
  ).toEqual(receiptsBefore);
  const retry = await f.commit();
  expect(retry.status, await retry.clone().text()).toBe(200);
}, 20_000);

test("the optional enrollment policy must target this organization's Members group", async () => {
  const f = await createAtomicEnrollmentFixture();
  const response = await f.commit({
    ...f.request,
    memberPolicy: f.request.groupPolicy,
  });
  expect(response.status, await response.clone().text()).toBe(400);
  expect(await f.readHeads()).toEqual(f.before);
  expect(await roster(f)).toEqual([]);
}, 20_000);

test("a compound enrollment cannot duplicate its Members policy", async () => {
  const f = await createAtomicEnrollmentFixture();
  const response = await f.commit(
    { ...f.request, groupPolicy: f.request.memberPolicy },
    f.organization.memberGroupId,
  );
  expect(response.status, await response.clone().text()).toBe(400);
  expect(await response.json()).toEqual({
    error: "Members policy is duplicated",
  });
  expect(await f.readHeads()).toEqual(f.before);
  expect(await roster(f)).toEqual([]);
}, 20_000);
