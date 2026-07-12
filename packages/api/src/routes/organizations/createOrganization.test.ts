import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isCreateOrganizationResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { createRouteApp, routeApp } from "../../routeApp";

async function registeredActor(): Promise<{
  user: TestUser;
  defaultOrganizationId: string;
}> {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return { user, defaultOrganizationId: row.defaultOrganizationId };
}

test("POST /organizations provisions an additional organization for the caller", async () => {
  const { user, defaultOrganizationId } = await registeredActor();

  const body = await createOrganizationRequestBody(user);
  const res = await submitCreateOrganization(user, body);

  expect(res.status).toBe(200);
  const json = await res.json();
  invariant(isCreateOrganizationResponse(json), "expected provisioning body");
  expect(json.userId).toBe(user.userId);
  expect(json.organizationId).toBe(body.organizationId);
  expect(json.organizationId).not.toBe(defaultOrganizationId);
  expect(json.rootContainerId).toBe(body.rootContainerId);
  expect(json.rootMetadataAccessEpoch).toBe(1);
  expect(json.rootMetadataAccessStateHash.length).toBeGreaterThan(0);

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, body.organizationId));
  invariant(org, "expected the new organization row");

  const [roster] = await db
    .select({ status: organizationRosterEntries.status })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, body.organizationId),
        eq(organizationRosterEntries.userId, user.userId),
      ),
    );
  invariant(roster, "expected the caller on the new organization roster");
});

test("POST /organizations notifies the caller's other sessions to discover the new root", async () => {
  const { user } = await registeredActor();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
  });
  const body = await createOrganizationRequestBody(user);

  const res = await app.request("/organizations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  expect(res.status).toBe(200);
  expect(publishedEvents).toHaveLength(1);
  const event = publishedEvents[0];
  expect(Reflect.get(event ?? {}, "type")).toBe("shared_with_you");
  expect(Reflect.get(event ?? {}, "userId")).toBe(user.userId);
  const origin = Reflect.get(event ?? {}, "origin");
  invariant(
    typeof origin === "object" && origin !== null,
    "expected event origin",
  );
  expect(Reflect.get(origin, "userId")).toBe(user.userId);
  expect(Reflect.get(origin, "sessionId")).toBeString();
});

test("POST /organizations succeeds when the realtime discovery hint cannot publish", async () => {
  const { user } = await registeredActor();
  const app = createRouteApp({
    publish: async () => {
      throw new Error("publish transport unavailable");
    },
  });
  const body = await createOrganizationRequestBody(user);

  const res = await app.request("/organizations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  expect(res.status).toBe(200);
});

test("POST /organizations starts the new organization on local billing", async () => {
  const { user } = await registeredActor();

  const body = await createOrganizationRequestBody(user);
  const res = await submitCreateOrganization(user, body);
  expect(res.status).toBe(200);

  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, body.organizationId));
  invariant(billing, "expected a billing row for the new organization");
  expect(billing.status).toBe("local");
});

test("POST /organizations leaves the caller's default organization unchanged", async () => {
  const { user, defaultOrganizationId } = await registeredActor();

  const body = await createOrganizationRequestBody(user);
  const res = await submitCreateOrganization(user, body);
  expect(res.status).toBe(200);

  const [row] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected the user row");
  expect(row.defaultOrganizationId).toBe(defaultOrganizationId);
});

test("POST /organizations rejects provisioning for a different user", async () => {
  const { user } = await registeredActor();

  const body = await createOrganizationRequestBody(user);
  const res = await submitCreateOrganization(user, {
    ...body,
    userId: crypto.randomUUID(),
  });

  expect(res.status).toBe(403);
});

test("POST /organizations requires authentication", async () => {
  const res = await routeApp.request("/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  expect(res.status).toBe(401);
});
