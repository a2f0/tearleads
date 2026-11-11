import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { createTestExecSql, createTestUser } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestSingleContainerParentLane,
} from "../../../test/helpers/containerParentLaneQuery";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { routeApp } from "../../routeApp";
import { runOrganizationPurgeMaintenance } from "../../services/billing/organizationPurge";

async function openDevice(
  user: ReturnType<typeof createTestUser>,
  database: Awaited<ReturnType<typeof createTestExecSql>>,
  apiBaseUrl: string,
) {
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: {
      client: {
        exec: async ({ sql, bind, rowMode }) => ({
          rows: await database.execSql(
            sql,
            bind,
            rowMode ? { rowMode } : undefined,
          ),
        }),
      },
      execSql: database.execSql,
      id: "terminal-replay",
    },
    identityProvisioning: "manual",
    logger: { log: () => {}, logError: () => {} },
  });
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: user.kem,
    signingKeyPair: user.signing,
    signingFingerprint: user.fingerprint,
  });
  sdk.session.setContext({
    authToken: user.token,
    isAuthenticated: true,
    userId: user.userId,
  });
  return {
    sdk,
    attempts: () =>
      database.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    close: () => sdk.dispose(),
  };
}

async function membershipIds(userId: string) {
  return (
    await db
      .select({ id: organizationRosterEntries.organizationId })
      .from(organizationRosterEntries)
      .where(eq(organizationRosterEntries.userId, userId))
  )
    .map((row) => row.id)
    .sort();
}

test("lost create releases only after certified purge, across runtime recreation, without an automatic fresh POST", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const requests: CreateOrganizationRequest[] = [];
  const statuses: number[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const isCreate =
        request.method === "POST" &&
        new URL(request.url).pathname === "/organizations";
      if (isCreate) requests.push(await request.clone().json());
      const response = await routeApp.fetch(request);
      if (isCreate) {
        statuses.push(response.status);
        if (requests.length === 1 && response.status === 200)
          return new Response("committed response lost", { status: 503 });
      }
      return response;
    },
  });
  const database = await createTestExecSql("terminal-replay");
  let device = await openDevice(user, database, server.url.origin);
  try {
    expect(await device.sdk.session.createOrganization()).toBeNull();
    expect(statuses).toEqual([200]);
    const first = requests[0];
    invariant(first, "expected lost committed request");
    const before = await membershipIds(user.userId);
    expect(before).toHaveLength(2);
    const discovery = await requestSingleContainerParentLane({
      token: user.token,
    });
    expect(discovery.status).toBe(200);
    expect(
      (await readContainerParentLanePage(discovery)).items.map(
        (item) => item.id,
      ),
    ).toContain(first.rootContainerId);
    const now = new Date("2099-11-10T00:00:00.000Z");
    await db
      .update(organizationBilling)
      .set({
        status: "disabled",
        disabledAt: now,
        purgeAfter: now,
      })
      .where(eq(organizationBilling.organizationId, first.organizationId));
    expect(
      await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
        now,
        organizationIds: [first.organizationId],
      }),
    ).toEqual({ claimed: 1, failed: 0, purged: 1 });
    const [receipt] = await db
      .select({
        response: organizations.provisioningResponse,
        userId: organizations.provisioningUserId,
        requestHash: organizations.provisioningRequestSha256,
      })
      .from(organizations)
      .where(eq(organizations.id, first.organizationId));
    expect(receipt?.response).toBeNull();
    expect(receipt?.userId).toBe(user.userId);
    expect(receipt?.requestHash).toMatch(/^[a-f0-9]{64}$/);
    device.close();
    device = await openDevice(user, database, server.url.origin);
    expect(await device.attempts()).toEqual([
      { organization_id: first.organizationId },
    ]);
    expect(await device.sdk.session.createOrganization()).toBeNull();
    // A refusal ends this invocation. Only the next deliberate call may create.
    expect(requests).toEqual([first, first]);
    expect(await device.attempts()).toEqual([]);
    expect(statuses).toEqual([200, 410]);
    expect(await membershipIds(user.userId)).toEqual(before);
    device.close();
    device = await openDevice(user, database, server.url.origin);
    expect(await device.attempts()).toEqual([]);
    const next = await device.sdk.session.createOrganization();
    invariant(
      next,
      "expected a fresh deliberate create after terminal refusal",
    );
    expect(next.organizationId).not.toBe(first.organizationId);
    expect(requests).toHaveLength(3);
    expect(statuses).toEqual([200, 410, 200]);
    expect(await membershipIds(user.userId)).toHaveLength(3);
  } finally {
    device.close();
    database.close();
    await server.stop(true);
  }
}, 30_000);

for (const unavailable of ["disabled", "deleting"] as const) {
  test(`lost create retains its attempt through reversible ${unavailable} replay refusal`, async () => {
    const user = createTestUser();
    await registerUser(user);
    await authenticate(user);
    const database = await createTestExecSql("reversible-replay");
    const requests: CreateOrganizationRequest[] = [];
    const statuses: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const isCreate =
          request.method === "POST" &&
          new URL(request.url).pathname === "/organizations";
        if (isCreate) requests.push(await request.clone().json());
        const response = await routeApp.fetch(request);
        if (isCreate) {
          statuses.push(response.status);
          if (requests.length === 1 && response.status === 200)
            return new Response("committed response lost", { status: 503 });
        }
        return response;
      },
    });
    let device = await openDevice(user, database, server.url.origin);
    try {
      expect(await device.sdk.session.createOrganization()).toBeNull();
      expect(statuses).toEqual([200]);
      const first = requests[0];
      invariant(first, "expected committed request");
      if (unavailable === "disabled") {
        await db
          .update(organizationRosterEntries)
          .set({ status: "disabled" })
          .where(
            eq(organizationRosterEntries.organizationId, first.organizationId),
          );
      } else {
        await db
          .update(organizationBilling)
          .set({ status: "deleting" })
          .where(eq(organizationBilling.organizationId, first.organizationId));
      }
      expect(await device.sdk.session.createOrganization()).toBeNull();
      expect(await device.attempts()).toEqual([
        { organization_id: first.organizationId },
      ]);
      expect(statuses).toEqual([200, 409]);
      device.close();
      device = await openDevice(user, database, server.url.origin);
      await db
        .update(organizationRosterEntries)
        .set({ status: "active" })
        .where(
          eq(organizationRosterEntries.organizationId, first.organizationId),
        );
      await db
        .update(organizationBilling)
        .set({ status: "local" })
        .where(eq(organizationBilling.organizationId, first.organizationId));
      expect(await device.sdk.session.createOrganization()).toEqual({
        organizationId: first.organizationId,
        containerId: first.rootContainerId,
      });
      expect(requests).toEqual([first, first, first]);
      expect(statuses).toEqual([200, 409, 200]);
      expect(await membershipIds(user.userId)).toHaveLength(2);
      expect(await device.attempts()).toEqual([]);
    } finally {
      device.close();
      database.close();
      await server.stop(true);
    }
  }, 30_000);
}
