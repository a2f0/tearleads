import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationRosterEntries, users } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isCreateOrganizationGroupResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { registerUser } from "../../../test/helpers/registerUser";
import type { SessionEnv } from "../../middleware/session";
import { createRouteApp } from "../../routeApp";

async function registeredActor() {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, actor.userId));
  invariant(row, "expected registered actor organization");
  return { actor, organizationId: row.organizationId };
}

function organizationReadModelEvents(
  events: ReadonlyArray<Record<string, unknown>>,
) {
  return events.filter(
    (event) => Reflect.get(event, "type") === "organization_read_model_changed",
  );
}

test("publishes one committed hint to the active roster audience", async () => {
  const { actor, organizationId } = await registeredActor();
  const activeRecipientUserId = crypto.randomUUID();
  const disabledRecipientUserId = crypto.randomUUID();
  await db.insert(organizationRosterEntries).values([
    {
      organizationId,
      status: "active",
      userId: activeRecipientUserId,
    },
    {
      disabledAt: new Date("2026-07-17T12:00:00.000Z"),
      disabledByUserId: actor.userId,
      organizationId,
      status: "disabled",
      userId: disabledRecipientUserId,
    },
  ]);
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
  });
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor,
    groupId,
    name: "Realtime Readers",
  });

  const response = await app.request(
    `/organizations/${organizationId}/groups`,
    {
      body: JSON.stringify(request),
      headers: {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  expect(response.status).toBe(200);
  expect(isCreateOrganizationGroupResponse(await response.json())).toBe(true);
  const hints = organizationReadModelEvents(publishedEvents);
  expect(hints).toHaveLength(1);
  expect(Reflect.get(hints[0] ?? {}, "organizationId")).toBe(organizationId);
  const origin = Reflect.get(hints[0] ?? {}, "origin");
  invariant(typeof origin === "object" && origin !== null, "expected origin");
  expect(Reflect.get(origin, "userId")).toBe(actor.userId);
  expect(Reflect.get(origin, "sessionId")).toBeString();
  expect(Reflect.get(hints[0] ?? {}, "recipientUserIds")).toEqual(
    [actor.userId, activeRecipientUserId].sort(),
  );
});

test("does not publish a hint for a successful no-op mutation", async () => {
  const { actor, organizationId } = await registeredActor();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
  });

  const response = await app.request(
    `/organizations/${organizationId}/profile`,
    {
      body: JSON.stringify({ profileDocumentId: null }),
      headers: {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      },
      method: "PUT",
    },
  );

  expect(response.status).toBe(200);
  expect(organizationReadModelEvents(publishedEvents)).toEqual([]);
});

test("a hint transport failure does not fail the committed mutation", async () => {
  const { actor, organizationId } = await registeredActor();
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const app = createRouteApp({
    publish: async () => {
      throw new Error("notification transport unavailable");
    },
  });
  const request = await createGroupRequest({
    actor,
    groupId: crypto.randomUUID(),
    name: "Offline Notification",
  });

  try {
    const response = await app.request(
      `/organizations/${organizationId}/groups`,
      {
        body: JSON.stringify(request),
        headers: {
          Authorization: `Bearer ${actor.token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(isCreateOrganizationGroupResponse(await response.json())).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  } finally {
    errorSpy.mockRestore();
  }
});

test("publishes a committed hint after a downstream post-commit error", async () => {
  const { actor, organizationId } = await registeredActor();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const requireAuth: MiddlewareHandler<SessionEnv> = async (c, next) => {
    const now = Date.now();
    c.set("session", {
      id: "post-commit-error-session",
      userId: actor.userId,
      fingerprint: actor.fingerprint,
      createdAt: now,
      ipAddresses: [],
      lastActiveAt: now,
      lastActiveIp: null,
    });
    await next();
    throw new Error("downstream post-commit failure");
  };
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
    requireAuth,
  });
  const request = await createGroupRequest({
    actor,
    groupId: crypto.randomUUID(),
    name: "Committed Before Failure",
  });

  try {
    const response = await app.request(
      `/organizations/${organizationId}/groups`,
      {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    const hints = organizationReadModelEvents(publishedEvents);
    expect(hints).toHaveLength(1);
    expect(Reflect.get(hints[0] ?? {}, "organizationId")).toBe(organizationId);
  } finally {
    errorSpy.mockRestore();
  }
});
