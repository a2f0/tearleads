import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { documentWrite, type ObservedRequest } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function isSyncOf(documentId: string) {
  return (request: ObservedRequest) =>
    request.method === "POST" &&
    request.path.endsWith(`/documents/${documentId}/sync`);
}

// Pausing sync for one organization holds its uploads and downloads while
// preserving local copies, follows the user to their other devices on
// membership refresh, leaves the user's personal organization syncing normally,
// and drains held edits plus remote updates once resumed.
test("pausing sync for an organization holds its traffic across devices without blocking personal sync", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const bobPersonalOrgId = bob.devices[0]?.organizationId;
  if (!bobPersonalOrgId) throw new Error("Expected Bob's personal org");

  await world.addToOrganization(alice, bob);
  const aliceOrgId = alice.devices[0]?.organizationId;
  if (!aliceOrgId) throw new Error("Expected Alice's org");
  const shared = await world.createFolder(alice, world.root(alice), "Shared");
  const sharedDoc = await world.createDocument(alice, shared, "seed\n");
  await world.shareWithUser(alice, shared, bob);

  const aliceDevice = alice.devices[0];
  const bob1 = bob.devices[0];
  if (!aliceDevice || !bob1) throw new Error("Expected original devices");
  const bob2 = await world.newDevice(bob);

  // Both of Bob's devices open device-first scopes and hold the shared document.
  await bob1.openDeviceFirst();
  await bob2.openDeviceFirst();
  await bob1.holdFolder(shared.id);
  await bob2.holdFolder(shared.id);
  const bob1Store = await readDocument(bob1, world.documentRef(sharedDoc));
  const bob2Store = await readDocument(bob2, world.documentRef(sharedDoc));
  if (!bob1Store || !bob2Store) throw new Error("Expected Bob's open stores");
  expect(bob1Store.getSnapshot().text).toBe("seed\n");
  expect(bob2Store.getSnapshot().text).toBe("seed\n");
  await bob1.idle();
  await bob2.idle();

  // Bob pauses Alice's organization on device 1; device 2 inherits the pause.
  expect(
    await bob1.sdk.organizations.memberships.setSyncPaused(aliceOrgId, true),
  ).toMatchObject({
    membership: expect.objectContaining({
      organizationId: aliceOrgId,
      syncPaused: true,
    }),
    status: "updated",
  });
  expect(
    (await bob1.sdk.organizations.memberships.loadPausedOrganizationIds()).has(
      aliceOrgId,
    ),
  ).toBe(true);
  expect(await bob2.sdk.organizations.memberships.refresh()).not.toBeNull();
  expect(
    (await bob2.sdk.organizations.memberships.loadPausedOrganizationIds()).has(
      aliceOrgId,
    ),
  ).toBe(true);

  const bob1BeforePauseWork = bob1.transport.history.length;
  const bob2BeforePauseWork = bob2.transport.history.length;

  // Bob's local edit to the paused organization stays queued with zero sync calls.
  await bob1Store.setText("seed\nbob paused edit\n");
  await bob1.idle();
  expect(
    bob1.transport.history
      .slice(bob1BeforePauseWork)
      .filter(isSyncOf(sharedDoc.documentId)),
  ).toEqual([]);
  expect(
    (
      await bob1.sdk.containerContents.documentQueries().listPendingWrites()
    ).some((item) => item.remoteId === sharedDoc.documentId),
  ).toBe(true);

  // Meanwhile, Bob's own personal organization keeps syncing normally.
  bob1.enterOrganization(bobPersonalOrgId);
  const personalDoc = await world.createDocument(
    bob,
    world.root(bob),
    "personal while org paused",
  );
  bob2.enterOrganization(bobPersonalOrgId);
  expect(await readText(bob2, world.documentRef(personalDoc))).toBe(
    "personal while org paused",
  );
  bob1.enterOrganization(aliceOrgId);
  bob2.enterOrganization(aliceOrgId);

  // Alice edits the shared document; Bob's paused devices neither send nor pull.
  await world.editDocument(alice, sharedDoc, "seed\nalice while paused\n");
  await bob1Store
    .requestRemoteSyncAndWait(new AbortController().signal)
    .catch(() => false);
  await bob2Store
    .requestRemoteSyncAndWait(new AbortController().signal)
    .catch(() => false);
  await bob1.idle();
  await bob2.idle();
  expect(
    bob1.transport.history
      .slice(bob1BeforePauseWork)
      .filter(isSyncOf(sharedDoc.documentId)),
  ).toEqual([]);
  expect(
    bob2.transport.history
      .slice(bob2BeforePauseWork)
      .filter(isSyncOf(sharedDoc.documentId)),
  ).toEqual([]);
  expect(bob1Store.getSnapshot().text).toBe("seed\nbob paused edit\n");
  expect(bob2Store.getSnapshot().text).toBe("seed\n");
  expect(await readText(aliceDevice, world.documentRef(sharedDoc))).toBe(
    "seed\nalice while paused\n",
  );

  // Resuming sync on device 1 drains its held edit and pulls Alice's edit.
  const bob1BeforeResume = bob1.transport.history.length;
  expect(
    await bob1.sdk.organizations.memberships.setSyncPaused(aliceOrgId, false),
  ).toMatchObject({
    membership: expect.objectContaining({
      organizationId: aliceOrgId,
      syncPaused: false,
    }),
    status: "updated",
  });
  await until(
    async () =>
      !(
        await bob1.sdk.containerContents.documentQueries().listPendingWrites()
      ).some((item) => item.remoteId === sharedDoc.documentId),
    "Bob's held edit to drain after resume",
  );
  await bob1.idle();
  expect(
    bob1.transport.history
      .slice(bob1BeforeResume)
      .filter(documentWrite(sharedDoc.documentId))
      .some(({ status }) => status === 200),
  ).toBe(true);

  const mergedOnAlice = await readText(
    aliceDevice,
    world.documentRef(sharedDoc),
  );
  expect(mergedOnAlice).toContain("bob paused edit\n");
  expect(mergedOnAlice).toContain("alice while paused\n");
  expect(await readText(bob1, world.documentRef(sharedDoc))).toBe(
    mergedOnAlice,
  );

  // Device 2 learns of the resume via membership refresh and converges too.
  expect(await bob2.sdk.organizations.memberships.refresh()).not.toBeNull();
  expect(
    (await bob2.sdk.organizations.memberships.loadPausedOrganizationIds()).has(
      aliceOrgId,
    ),
  ).toBe(false);
  expect(await readText(bob2, world.documentRef(sharedDoc))).toBe(
    mergedOnAlice,
  );
  expectNoSecurityIncidents(world);
}, 240_000);
