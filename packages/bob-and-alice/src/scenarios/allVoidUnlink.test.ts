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

// Every committed update of the document declares an operation its payload
// does not carry, so a reader voids all of them and holds an empty document.
// Its snapshot encodes no history, and before #3194 that meant no baseline:
// the unlink went without one, and the API refused it while any update was
// committed. The reader's baseline is now an empty snapshot that signs its
// processed cursor, so the API weighs only the updates after it. A fresh
// install is redirected past the voids and never meets them.
test("a reader unlinks a document whose every update it voided", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const team = await world.createFolder(alice, world.root(alice), "Team");
  const handoff = await world.createFolder(alice, world.root(alice), "Handoff");
  const document = await world.createDocument(alice, team, "");
  await world.shareWithUser(alice, team, bob);
  await world.shareWithUser(alice, handoff, bob);
  await world.linkDocument(alice, document, handoff);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");
  expect(await readText(reader, world.documentRef(document))).toBe("");

  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  const liarStore = await readDocument(offline, world.documentRef(document));
  if (!liarStore) throw offline.failure("cannot open the document");
  offline.setOnline(false);
  await liarStore.setText("alice\n");
  const liar = await world.restartDevice(alice, offline, false);
  expect(
    await liar.forgeQueuedUpdateSpans(({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ "4242": 7 }),
      ]),
      start,
    })),
  ).toBeGreaterThan(0);
  liar.setOnline(true);
  await readDocument(liar, world.documentRef(document));
  await liar.idle();

  expect(await readText(reader, world.documentRef(document))).toBe("");
  expect(voidReports(reader)).toBeGreaterThan(0);
  const reported = voidReports(reader);
  await world.unlinkDocument(bob, document, handoff);
  // Rotation judges the raw history again; each void is reported once.
  expect(voidReports(reader)).toBe(reported);

  await world.editDocument(bob, document, "bob\n", reader);
  const fresh = await world.newDevice(bob);
  expect(await readText(fresh, world.documentRef(document))).toBe("bob\n");
  expect(voidReports(fresh)).toBe(0);
  expect(await readText(liar, world.documentRef(document))).toContain("bob");

  // A second rotation replays history that holds the empty baseline, and a
  // device installed after it starts from the new baseline.
  await world.linkDocument(bob, document, handoff);
  await world.unlinkDocument(bob, document, handoff);
  expect(voidReports(reader)).toBe(reported);
  expect(await readText(fresh, world.documentRef(document))).toBe("bob\n");
  const later = await world.newDevice(bob);
  expect(await readText(later, world.documentRef(document))).toBe("bob\n");
  expect(voidReports(later)).toBe(0);
  expectNoSecurityIncidents(world);
}, 240_000);
