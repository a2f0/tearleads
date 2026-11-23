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
// does not carry. No version can hold them, so the API refused every rotation
// baseline and no device could unlink the document. A reader that voided the
// update unlinks it: the baseline signs the reader's processed cursor, and
// the API asks it to cover only later updates. A fresh install then starts
// from the baseline and never meets the update.
test("a reader unlinks a document past a false-span update it voided", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const team = await world.createFolder(alice, world.root(alice), "Team");
  const handoff = await world.createFolder(alice, world.root(alice), "Handoff");
  const document = await world.createDocument(alice, team, "seed\n");
  await world.shareWithUser(alice, team, bob);
  await world.shareWithUser(alice, handoff, bob);
  await world.linkDocument(alice, document, handoff);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");
  expect(await readText(reader, world.documentRef(document))).toBe("seed\n");

  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  const liarStore = await readDocument(offline, world.documentRef(document));
  if (!liarStore) throw offline.failure("cannot open the document");
  offline.setOnline(false);
  await liarStore.setText("seed\nalice\n");
  const liar = await world.restartDevice(alice, offline, false);
  expect(
    await liar.forgeQueuedUpdateSpans(({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ "4242": 7 }),
      ]),
      start,
    })),
  ).toBe(1);
  liar.setOnline(true);
  await readDocument(liar, world.documentRef(document));
  await liar.idle();

  expect(await readText(reader, world.documentRef(document))).toBe("seed\n");
  expect(voidReports(reader)).toBe(1);
  await world.unlinkDocument(bob, document, handoff);
  // Rotation judges the raw history again; the void is reported once.
  expect(voidReports(reader)).toBe(1);

  await world.editDocument(bob, document, "seed\nbob\n", reader);
  const fresh = await world.newDevice(bob);
  expect(await readText(fresh, world.documentRef(document))).toBe(
    "seed\nbob\n",
  );
  expect(voidReports(fresh)).toBe(0);
  expect(await readText(liar, world.documentRef(document))).toContain("bob");
  expectNoSecurityIncidents(world);
}, 240_000);
