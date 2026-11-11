import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationRosterEntries,
  users,
} from "@tearleads/api-shared/schema";
import {
  createMemoryBlobStore,
  defaultContainerContentsPersistence,
  Tearleads,
} from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql, createTestUser } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { isCreateOrganizationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestSingleContainerParentLane,
} from "../../../test/helpers/containerParentLaneQuery";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function makeDevice(
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
      id: "ordinary-create-device",
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
  return sdk;
}

async function serverOrganizationIds(userId: string) {
  return (
    await db
      .select({ organizationId: organizationRosterEntries.organizationId })
      .from(organizationRosterEntries)
      .where(eq(organizationRosterEntries.userId, userId))
  )
    .map((row) => row.organizationId)
    .sort();
}

test("ordinary create retries a lost committed response into the same device organization", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const database = await createTestExecSql("ordinary-create-lost-response");
  const requests: CreateOrganizationRequest[] = [];
  const committed: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const isCreate =
        request.method === "POST" &&
        new URL(request.url).pathname === "/organizations";
      if (isCreate) requests.push(await request.clone().json());
      const response = await routeApp.fetch(request);
      if (isCreate && response.status !== 200) {
        throw new Error(
          `Create failed: ${response.status} ${await response.text()}`,
        );
      }
      if (isCreate && response.status === 200) {
        committed.push(await response.clone().json());
        if (committed.length === 1) {
          // The real transaction has committed; discard its successful body.
          return new Response("response lost after server commit", {
            status: 503,
          });
        }
      }
      return response;
    },
  });
  let sdk = await makeDevice(user, database, server.url.origin);
  const options = { organizationProfileName: "Retry workspace" };
  try {
    expect(await sdk.session.createOrganization(options)).toBeNull();
    const first = committed[0];
    invariant(isCreateOrganizationResponse(first), "expected committed create");
    const serverIdsAfterLoss = await serverOrganizationIds(user.userId);
    expect(serverIdsAfterLoss).toHaveLength(2); // registration plus this create
    expect(
      await defaultContainerContentsPersistence.containerExists(
        database.execSql,
        first.rootContainerId,
      ),
    ).toBe(false);
    const [billing] = await db
      .select({ status: organizationBilling.status })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, first.organizationId));
    expect(billing?.status).toBe("local");
    // Read-only discovery remains available on local billing. No retry or
    // billing transition is needed to discover the committed root.
    const discovery = await requestSingleContainerParentLane({
      token: user.token,
    });
    expect(discovery.status).toBe(200);
    const page = await readContainerParentLanePage(discovery);
    expect(page.items.map((container) => container.id)).toContain(
      user.rootContainerId,
    );
    expect(page.items.map((container) => container.id)).toContain(
      first.rootContainerId,
    );
    const store = sdk.containerContents.openTree();
    store.updateRuntime(sdk.containerContents.workflowRuntime());
    const deadline = Date.now() + 10_000;
    while (!store.getSnapshot().ready) {
      if (Date.now() > deadline)
        throw new Error("Root store did not initialize");
      await Bun.sleep(10);
    }
    expect(await store.refreshRootLane()).toBe(true);
    expect(
      store
        .getSnapshot()
        .nodes.find((node) => node.id === first.rootContainerId),
    ).toMatchObject({ organizationId: first.organizationId, name: "/" });
    expect(
      (await sdk.organizations.listLocalOrganizations()).find(
        (organization) => organization.organizationId === first.organizationId,
      ),
    ).toMatchObject({
      organizationId: first.organizationId,
      rootContainerId: first.rootContainerId,
    });
    expect(requests).toHaveLength(1);

    // The root is usable before the create acknowledgement is recovered. A
    // local rename extends the synced metadata and queues an uncommitted edit.
    expect(
      await store.renameContainer(first.rootContainerId, "Later name"),
    ).toMatchObject({ name: "Later name" });
    sdk.dispose();
    const rootBeforeRetry =
      await defaultContainerContentsPersistence.loadContainerMetadataState(
        database.execSql,
        first.rootContainerId,
      );
    invariant(rootBeforeRetry?.record, "expected hydrated root metadata");
    expect(rootBeforeRetry.container.name).toBe("Later name");
    expect(rootBeforeRetry.record.metadataUpdates.length).toBeGreaterThan(0);
    const pendingBeforeRetry =
      await defaultContainerContentsPersistence.listPendingUpdates(
        database.execSql,
        first.rootContainerId,
      );
    expect(pendingBeforeRetry.length).toBeGreaterThan(0);

    // Recreate the runtime: the retry must not depend on an in-memory closure.
    sdk = await makeDevice(user, database, server.url.origin);
    const retry = await sdk.session.createOrganization(options);
    expect(await serverOrganizationIds(user.userId)).toEqual(
      serverIdsAfterLoss,
    );
    expect(retry).toEqual({
      organizationId: first.organizationId,
      containerId: first.rootContainerId,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(committed[1]).toEqual(first);
    expect(
      await database.execSql(
        "SELECT id, organization_id FROM containers WHERE id = ?",
        [first.rootContainerId],
      ),
    ).toEqual([
      { id: first.rootContainerId, organization_id: first.organizationId },
    ]);

    expect(
      await defaultContainerContentsPersistence.loadContainerMetadataState(
        database.execSql,
        first.rootContainerId,
      ),
    ).toEqual(rootBeforeRetry);
    expect(
      await defaultContainerContentsPersistence.listPendingUpdates(
        database.execSql,
        first.rootContainerId,
      ),
    ).toEqual(pendingBeforeRetry);

    // A completed operation is not a name reservation: deliberate repeats work.
    const next = await sdk.session.createOrganization(options);
    const nextRequest = requests[2];
    invariant(nextRequest, "expected a new deliberate create request");
    expect(next).toEqual({
      organizationId: nextRequest.organizationId,
      containerId: nextRequest.rootContainerId,
    });
    expect(next?.organizationId).not.toBe(first.organizationId);
    expect(await serverOrganizationIds(user.userId)).toHaveLength(3);
  } finally {
    sdk.dispose();
    database.close();
    await server.stop(true);
  }
}, 30_000);

for (const loseCommittedResponse of [false, true]) {
  test(`ordinary create retains exact artifacts after a real 400 (prior committed loss: ${loseCommittedResponse})`, async () => {
    const user = createTestUser();
    await registerUser(user);
    await authenticate(user);
    const database = await createTestExecSql("ordinary-create-rejection");
    const requests: CreateOrganizationRequest[] = [];
    const statuses: number[] = [];
    const rejectedRequestNumber = loseCommittedResponse ? 2 : 1;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        if (
          request.method !== "POST" ||
          new URL(request.url).pathname !== "/organizations"
        )
          return routeApp.fetch(request);
        requests.push(await request.clone().json());
        const reject = requests.length === rejectedRequestNumber;
        if (reject) {
          await db
            .update(users)
            .set({
              signingPublicKey: bytesToBase64(
                generateSigningSeedAndKeyPair().signingPublicKey,
              ),
            })
            .where(eq(users.id, user.userId));
        }
        try {
          // A real validation rejection proves no commit by THIS request,
          // not that an earlier request for the same intent never committed.
          const response = await routeApp.fetch(request);
          statuses.push(response.status);
          if (loseCommittedResponse && requests.length === 1) {
            invariant(response.status === 200, "expected committed create");
            return new Response("response lost", { status: 503 });
          }
          return response;
        } finally {
          if (reject)
            await db
              .update(users)
              .set({
                signingPublicKey: bytesToBase64(user.signing.signingPublicKey),
              })
              .where(eq(users.id, user.userId));
        }
      },
    });
    let sdk = await makeDevice(user, database, server.url.origin);
    try {
      if (loseCommittedResponse) {
        expect(await sdk.session.createOrganization()).toBeNull();
        expect(await serverOrganizationIds(user.userId)).toHaveLength(2);
      }
      expect(await sdk.session.createOrganization()).toBeNull();
      expect(statuses).toEqual(loseCommittedResponse ? [200, 400] : [400]);
      expect(await serverOrganizationIds(user.userId)).toHaveLength(
        loseCommittedResponse ? 2 : 1,
      );
      const first = requests[0];
      invariant(first, "expected captured request");
      expect(
        await database.execSql(
          "SELECT organization_id FROM organization_provisioning_attempts",
        ),
      ).toEqual([{ organization_id: first.organizationId }]);
      sdk.dispose();
      sdk = await makeDevice(user, database, server.url.origin);
      expect(await sdk.session.createOrganization()).toEqual({
        organizationId: first.organizationId,
        containerId: first.rootContainerId,
      });
      expect(statuses).toEqual(
        loseCommittedResponse ? [200, 400, 200] : [400, 200],
      );
      expect(
        requests.every(
          (request) => JSON.stringify(request) === JSON.stringify(first),
        ),
      ).toBe(true);
      expect(await serverOrganizationIds(user.userId)).toHaveLength(2);
      expect(
        await database.execSql(
          "SELECT organization_id FROM organization_provisioning_attempts",
        ),
      ).toEqual([]);
    } finally {
      sdk.dispose();
      database.close();
      await server.stop(true);
    }
  }, 30_000);
}
