import { afterEach, expect, test } from "bun:test";
import { purgeOrganizationForTest } from "@tearleads/api/test-runtime";
import { PurgedOrganizationRecoveryBillingRequiredError } from "@tearleads/client-sdk";
import type { Device } from "../harness/device";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { documentWrite } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

/** Runs the full billing-purge replacement flow, starting a trial when required. */
async function recoverPersonalOrganization(
  device: Device,
  purgedOrganizationId: string,
) {
  const firstAttempt = await device.sdk.session
    .recoverPurgedOrganization(purgedOrganizationId)
    .then(
      (result) => ({ kind: "recovered" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
  if (firstAttempt.kind === "recovered") {
    throw new Error("Expected billing-required error before starting a trial");
  }
  expect(firstAttempt.error).toBeInstanceOf(
    PurgedOrganizationRecoveryBillingRequiredError,
  );
  const billingError =
    firstAttempt.error as PurgedOrganizationRecoveryBillingRequiredError;
  const trial = await device.sdk.organizations.startTrial(
    billingError.replacementOrganizationId,
  );
  expect(trial?.status).toBe("trialing");

  const recovered =
    await device.sdk.session.recoverPurgedOrganization(purgedOrganizationId);
  if (!recovered) throw device.failure("purged organization recovery failed");
  expect(recovered.organizationId).toBe(billingError.replacementOrganizationId);
  expect(recovered.replacedOrganizationId).toBe(purgedOrganizationId);
  return recovered;
}

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

  // The scheduled billing purge deletes the remote organization rows and
  // reserves Alice's container and document ids for her recovery.
  expect(await purgeOrganizationForTest(oldOrgId)).toEqual({
    claimed: 1,
    failed: 0,
    purged: 1,
  });

  // `staleAlice` comes back online, recovers into a replacement organization,
  // and republishes the retained folder and document under their original ids.
  staleAlice.setOnline(true);
  const recovered = await recoverPersonalOrganization(staleAlice, oldOrgId);
  staleAlice = await world.reloadDevice(alice, staleAlice);
  const recoveredTree = await staleAlice.tree();
  await recoveredTree.refresh();
  recoveredTree.requestSync();
  await staleAlice.idle();

  const recoveredDocStore = staleAlice.sdk.documents.open({
    containerId: folder.id,
    localId: staleDocLocalId,
  });
  await recoveredDocStore.ensureInitialized();
  await recoveredDocStore.requestRemoteSyncAndWait(
    new AbortController().signal,
  );
  await staleAlice.idle();
  await until(
    async () =>
      recoveredDocStore.getSnapshot().documentId === document.documentId &&
      !(
        await staleAlice.sdk.containerContents
          .documentQueries()
          .listPendingWrites()
      ).some(
        (item) =>
          item.localId === staleDocLocalId ||
          item.remoteId === document.documentId,
      ),
    "staleAlice's recovered folder and document to republish",
  );
  expect(recoveredDocStore.getSnapshot().text).toBe("seed\n");

  // Re-invite Bob into Alice's replacement organization and re-share the
  // recovered folder. Bob's device follows the founder-signed replacement chain
  // while retaining its pre-purge document history.
  await world.addToOrganization(alice, bob, staleAlice);
  await world.shareWithUser(alice, folder, bob, staleAlice);
  await bobDevice.holdFolder(folder.id);

  // Bob writes an edit depending on his pre-purge operations that `staleAlice`'s
  // seed lacked. The API refuses with `document_sync_dependency_uncommitted`,
  // Bob's device relays the lost operations under their own peer ids, and the
  // retry commits with no duplication.
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

  // A brand-new install in the replacement organization reads the exact
  // non-duplicated text once.
  const freshInReplacement = await world.newDevice(alice);
  freshInReplacement.enterOrganization(recovered.organizationId);
  expect(await readText(freshInReplacement, ref)).toBe(expected);
  expectNoSecurityIncidents(world);
}, 300_000);
