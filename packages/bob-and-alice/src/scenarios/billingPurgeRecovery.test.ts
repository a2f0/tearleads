import { afterEach, expect, test } from "bun:test";
import { purgeOrganizationForTest } from "@tearleads/api/test-runtime";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { documentWrite } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";
import {
  connectDocumentRealtime,
  recoverAndRepublishDocument,
} from "./billingPurgeRecovery.testUtils";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// End-to-end verification of billing-purge recovery from a stale owner device
// (#3263 / #3293): Alice's personal organization is purged while one of her
// devices lacks Bob's pre-purge edit on Bob's peer P. That stale device
// recovers into a replacement organization (recreating the folder and document
// under their preserved ids with only the seed history), re-invites Bob, and
// re-shares the recovered folder. When Bob writes a dependent edit, the API
// refuses it with `document_sync_dependency_uncommitted`, Bob's device relays
// his lost pre-purge operations under their original peer ids instead of
// duplicating or throwing, and every device converges cleanly.
test("stale-device billing-purge recovery lets a re-shared member relay lost operations without duplication", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);

  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);

  let staleAlice = alice.devices[0];
  const bobDevice = bob.devices[0];
  if (!staleAlice || !bobDevice) throw new Error("Expected original devices");
  const freshAlice = await world.newDevice(alice);
  const ref = world.documentRef(document);
  expect(await readText(staleAlice, ref)).toBe("seed\n");
  expect(await readText(freshAlice, ref)).toBe("seed\n");
  expect(await readText(bobDevice, ref)).toBe("seed\n");
  const staleDocLocalId =
    await staleAlice.sdk.documents.findLocalIdByDocumentId(document.documentId);
  if (!staleDocLocalId) throw new Error("Expected staleAlice's local doc id");
  await staleAlice.idle();
  await freshAlice.idle();
  await bobDevice.idle();

  // `staleAlice` restarts offline before Bob commits his pre-purge edit so no
  // live store is trying to sync against the old organization during recovery.
  const oldOrgId = staleAlice.organizationId;
  staleAlice = await world.reloadDevice(alice, staleAlice, false);
  await world.editDocument(
    bob,
    document,
    "seed\nbob-before-purge\n",
    bobDevice,
  );
  expect(await readText(freshAlice, ref)).toBe("seed\nbob-before-purge\n");
  await freshAlice.idle();

  expect(await purgeOrganizationForTest(oldOrgId)).toEqual({
    claimed: 1,
    failed: 0,
    purged: 1,
  });

  const { ownerDevice, recovered } = await recoverAndRepublishDocument({
    document,
    expectedSeedText: "seed\n",
    folder,
    oldOrgId,
    owner: alice,
    staleDocLocalId,
    staleOwner: staleAlice,
    world,
  });
  staleAlice = ownerDevice;

  await world.addToOrganization(alice, bob, staleAlice);
  await world.shareWithUser(alice, folder, bob, staleAlice);
  await bobDevice.holdFolder(folder.id);

  const bobBefore = bobDevice.transport.history.length;
  const bobStore = await readDocument(bobDevice, ref);
  if (!bobStore) throw bobDevice.failure("cannot open document after re-share");
  await bobStore.setText("seed\nbob-before-purge\nbob-after-recovery\n");
  await until(
    async () =>
      !(
        await bobDevice.sdk.containerContents
          .documentQueries()
          .listPendingWrites()
      ).some((item) => item.remoteId === document.documentId),
    "Bob's relay and post-recovery edit to settle",
  );
  await bobDevice.idle();

  const bobWrites = bobDevice.transport.history
    .slice(bobBefore)
    .filter(documentWrite(document.documentId))
    .map(({ status, errorCode }) => ({ status, errorCode }));
  expect(bobWrites).toContainEqual({
    status: 409,
    errorCode: "document_sync_dependency_uncommitted",
  });
  expect(bobWrites.at(-1)).toEqual({ status: 200, errorCode: undefined });

  const expected = "seed\nbob-before-purge\nbob-after-recovery\n";
  expect(bobStore.getSnapshot().text).toBe(expected);
  expect(await readText(staleAlice, ref)).toBe(expected);

  const freshInReplacement = await world.newDevice(alice);
  freshInReplacement.enterOrganization(recovered.organizationId);
  expect(await readText(freshInReplacement, ref)).toBe(expected);
  expectNoSecurityIncidents(world);
}, 300_000);

// Preserved pre-purge peer ownership (#3263, Residual 1): even when Alice's
// stale copy carries a partial prefix of Bob's peer P, recreating the document
// restores Bob as the owner of P instead of letting Alice's seed hijack it.
// Bob therefore relays his missing tail and extends P directly without parking
// or rebasing onto a fresh peer.
test("stale recreation carrying a partial prefix of Bob's peer preserves Bob's ownership without parking", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);

  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);

  let staleAlice = alice.devices[0];
  const bobDevice = bob.devices[0];
  if (!staleAlice || !bobDevice) throw new Error("Expected original devices");
  const ref = world.documentRef(document);
  await world.editDocument(bob, document, "seed\nbob-1\n", bobDevice);
  expect(await readText(staleAlice, ref)).toBe("seed\nbob-1\n");
  const staleDocLocalId =
    await staleAlice.sdk.documents.findLocalIdByDocumentId(document.documentId);
  if (!staleDocLocalId) throw new Error("Expected staleAlice's local doc id");
  await staleAlice.idle();
  await bobDevice.idle();

  // `staleAlice` goes offline holding only bob-1; Bob then commits bob-2.
  const oldOrgId = staleAlice.organizationId;
  staleAlice = await world.reloadDevice(alice, staleAlice, false);
  await world.editDocument(bob, document, "seed\nbob-1\nbob-2\n", bobDevice);
  await bobDevice.idle();

  expect(await purgeOrganizationForTest(oldOrgId)).toEqual({
    claimed: 1,
    failed: 0,
    purged: 1,
  });

  const { ownerDevice, recovered } = await recoverAndRepublishDocument({
    document,
    expectedSeedText: "seed\nbob-1\n",
    folder,
    oldOrgId,
    owner: alice,
    staleDocLocalId,
    staleOwner: staleAlice,
    world,
  });
  staleAlice = ownerDevice;

  await world.addToOrganization(alice, bob, staleAlice);
  await world.shareWithUser(alice, folder, bob, staleAlice);
  await bobDevice.holdFolder(folder.id);

  const bobBefore = bobDevice.transport.history.length;
  const bobStore = await readDocument(bobDevice, ref);
  if (!bobStore) throw bobDevice.failure("cannot open document after re-share");
  await bobStore.setText("seed\nbob-1\nbob-2\nbob-3\n");
  await until(
    async () =>
      !(
        await bobDevice.sdk.containerContents
          .documentQueries()
          .listPendingWrites()
      ).some((item) => item.remoteId === document.documentId),
    "Bob's relay and continuation on his preserved peer to settle",
  );
  await bobDevice.idle();

  const bobWrites = bobDevice.transport.history
    .slice(bobBefore)
    .filter(documentWrite(document.documentId))
    .map(({ status, errorCode }) => ({ status, errorCode }));
  expect(bobWrites).not.toContainEqual({
    status: 409,
    errorCode: "document_sync_peer_owned",
  });
  expect(bobWrites.at(-1)).toEqual({ status: 200, errorCode: undefined });

  const expected = "seed\nbob-1\nbob-2\nbob-3\n";
  expect(bobStore.getSnapshot().text).toBe(expected);
  expect(await readText(staleAlice, ref)).toBe(expected);
  const freshInReplacement = await world.newDevice(alice);
  freshInReplacement.enterOrganization(recovered.organizationId);
  expect(await readText(freshInReplacement, ref)).toBe(expected);
  expectNoSecurityIncidents(world);
}, 300_000);

// Permanent park + pull-only live reads + owner-authorized member restore
// (#3263, Residuals 1, 2, 3): Bob writes an edit that Carol pulls while Alice's
// stale device is offline, and Bob's device never returns. After purge and
// stale recreation, Carol's dependent edit parks behind Bob's preserved peer
// ownership (she cannot hijack Bob's peer). While parked, Carol still receives
// Alice's live remote edits via pull-only sync. When Alice enables bounded
// member restore via `allowPeerRestore(docId, true)`, Carol wakes on the
// realtime hint, restores Bob's lost operations without claiming Bob's peer,
// and all devices converge cleanly with zero duplication.
test("parked member keeps pulling live remote edits and unblocks when owner calls allowPeerRestore", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  await world.addToOrganization(alice, bob);
  await world.addToOrganization(alice, carol);

  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);
  await world.shareWithUser(alice, folder, carol);

  let staleAlice = alice.devices[0];
  const bobDevice = bob.devices[0];
  const carolDevice = carol.devices[0];
  if (!staleAlice || !bobDevice || !carolDevice) {
    throw new Error("Expected original devices");
  }
  const ref = world.documentRef(document);
  expect(await readText(staleAlice, ref)).toBe("seed\n");
  expect(await readText(bobDevice, ref)).toBe("seed\n");
  expect(await readText(carolDevice, ref)).toBe("seed\n");
  const staleDocLocalId =
    await staleAlice.sdk.documents.findLocalIdByDocumentId(document.documentId);
  if (!staleDocLocalId) throw new Error("Expected staleAlice's local doc id");
  await staleAlice.idle();
  await bobDevice.idle();
  await carolDevice.idle();

  // `staleAlice` goes offline; Bob commits a pre-purge edit that Carol pulls,
  // then Bob's device goes permanently offline.
  const oldOrgId = staleAlice.organizationId;
  staleAlice = await world.reloadDevice(alice, staleAlice, false);
  await world.editDocument(bob, document, "seed\nbob-lost\n", bobDevice);
  expect(await readText(carolDevice, ref)).toBe("seed\nbob-lost\n");
  await carolDevice.idle();
  bobDevice.setOnline(false);

  expect(await purgeOrganizationForTest(oldOrgId)).toEqual({
    claimed: 1,
    failed: 0,
    purged: 1,
  });

  const { ownerDevice, recovered, recoveredDocStore } =
    await recoverAndRepublishDocument({
      document,
      expectedSeedText: "seed\n",
      folder,
      oldOrgId,
      owner: alice,
      staleDocLocalId,
      staleOwner: staleAlice,
      world,
    });
  staleAlice = ownerDevice;

  // Re-invite Carol only (Bob's device is permanently gone).
  await world.addToOrganization(alice, carol, staleAlice);
  await world.shareWithUser(alice, folder, carol, staleAlice);
  await carolDevice.holdFolder(folder.id);

  // Carol writes an edit depending on Bob's lost pre-purge operation. Because
  // Bob's peer ownership was preserved across the purge and allow_member_restore
  // defaults to false, Carol relays Bob's ops, receives 409 peer_owned, and parks.
  const carolStore = await readDocument(carolDevice, ref);
  if (!carolStore) {
    throw carolDevice.failure("cannot open document after re-share");
  }
  const carolSocket = await connectDocumentRealtime({
    device: carolDevice,
    folderId: folder.id,
    store: carolStore,
  });
  const aliceSocket = await connectDocumentRealtime({
    device: staleAlice,
    folderId: folder.id,
    store: recoveredDocStore,
  });
  try {
    await carolStore.setText("seed\nbob-lost\ncarol-after\n");
    await until(
      async () =>
        (
          await carolDevice.sdk.containerContents
            .documentQueries()
            .listPendingWrites()
        ).some(
          (item) =>
            item.remoteId === document.documentId &&
            item.operations.some((operation) =>
              operation.lastError?.includes("another user now owns"),
            ),
        ),
      "Carol's write to park behind Bob's preserved peer ownership",
    );

    // While Carol is parked, Alice makes a live remote edit. Carol's pull-only
    // sync pass still receives Alice's edit live without unparking her writes.
    await recoveredDocStore.setText("seed\nalice-live\n");
    await until(
      async () =>
        !(
          await staleAlice.sdk.containerContents
            .documentQueries()
            .listPendingWrites()
        ).some((item) => item.remoteId === document.documentId),
      "Alice's live edit to settle",
    );
    await until(
      async () => carolStore.getSnapshot().text.includes("alice-live"),
      "parked Carol to receive Alice's live remote edit via pull-only sync",
    );
    // Carol's own edit is still parked in the write queue.
    expect(
      (
        await carolDevice.sdk.containerContents
          .documentQueries()
          .listPendingWrites()
      ).some((item) => item.remoteId === document.documentId),
    ).toBe(true);

    // Non-owner Carol cannot enable member restore herself.
    expect(
      await carolDevice.sdk.documents.allowPeerRestore(
        document.documentId,
        true,
      ),
    ).toBeNull();

    // Personal org owner Alice enables bounded member restore. The server emits
    // `document.peer_restore_allowed`, waking Carol automatically.
    const allowed = await staleAlice.sdk.documents.allowPeerRestore(
      document.documentId,
      true,
    );
    expect(allowed).toEqual({
      allowMemberRestore: true,
      documentId: document.documentId,
      updatedPeerCount: expect.any(Number),
    });
    expect(allowed?.updatedPeerCount).toBeGreaterThanOrEqual(1);

    await until(
      async () =>
        !(
          await carolDevice.sdk.containerContents
            .documentQueries()
            .listPendingWrites()
        ).some((item) => item.remoteId === document.documentId),
      "Carol to wake on peer_restore_allowed and settle her queued writes",
    );
    await carolDevice.idle();
    await staleAlice.idle();

    await until(
      async () => recoveredDocStore.getSnapshot().text.includes("carol-after"),
      "Alice to pull Carol's restored history and post-recovery edit",
    );

    const carolText = carolStore.getSnapshot().text;
    const aliceText = recoveredDocStore.getSnapshot().text;
    expect(aliceText).toBe(carolText);
    for (const snippet of ["seed", "bob-lost", "alice-live", "carol-after"]) {
      expect(aliceText.split(snippet).length - 1).toBe(1);
    }

    const freshInReplacement = await world.newDevice(alice);
    freshInReplacement.enterOrganization(recovered.organizationId);
    expect(await readText(freshInReplacement, ref)).toBe(aliceText);
    expectNoSecurityIncidents(world);
  } finally {
    carolSocket.close();
    aliceSocket.close();
  }
}, 300_000);
