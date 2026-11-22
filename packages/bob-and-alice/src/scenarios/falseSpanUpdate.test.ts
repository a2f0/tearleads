import { afterEach, expect, test } from "bun:test";
import {
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

const VOIDED = "Documents: sync update voided";

function voidReports(device: { errors: readonly { message: unknown }[] }) {
  return device.errors.filter(({ message }) => message === VOIDED).length;
}

// A writer signs an update whose declared span claims operations its payload
// does not carry. The API cannot read the payload and stores it; every
// reader voids it and keeps syncing, so the other writer's edits still land
// everywhere and its own sync never wedges.
test("a reader voids a false-span update and keeps syncing", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");
  expect(await readText(reader, world.documentRef(document))).toBe("seed\n");

  // Alice's edit queues offline; a modified client then forges its span and
  // signs that on the next start.
  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  const liarStore = await readDocument(offline, world.documentRef(document));
  if (!liarStore) throw offline.failure("cannot open the document");
  offline.setOnline(false);
  await liarStore.setText("seed\nalice\n");
  const liar = await world.restartDevice(alice, offline, false);
  const forged = await liar.forgeQueuedUpdateSpans(({ end, start }) => ({
    end: mergeVersionVectors([end, encodeVersionVectorCounters({ "4242": 7 })]),
    start,
  }));
  expect(forged).toBe(1);
  liar.setOnline(true);
  await readDocument(liar, world.documentRef(document));
  await liar.idle();

  // Bob voids it once and his own edits still settle and reach Alice.
  await world.editDocument(bob, document, "seed\nbob\n", reader);
  expect(voidReports(reader)).toBe(1);
  for (let pass = 0; pass < 3; pass += 1) {
    expect(await readText(reader, world.documentRef(document))).toBe(
      "seed\nbob\n",
    );
  }
  expect(voidReports(reader)).toBe(1);
  const aliceText = await readText(liar, world.documentRef(document));
  expect(aliceText).toContain("bob");

  // A fresh install of Bob judges the same served history the same way.
  const freshReader = await world.newDevice(bob);
  expect(await readText(freshReader, world.documentRef(document))).toBe(
    "seed\nbob\n",
  );
  expect(voidReports(freshReader)).toBe(1);
  expectNoSecurityIncidents(world);
}, 180_000);
