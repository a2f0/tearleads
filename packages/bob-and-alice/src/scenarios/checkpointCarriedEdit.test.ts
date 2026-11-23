import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// A writer signs a rotation checkpoint that is the only update carrying one of
// its edits, then an ordinary update on top of that edit. Sync applies both,
// so every reader holds the edit. A rotation rebuilt the history from
// ordinary updates alone, so its proof failed on every attempt and no reader
// could unlink the document. It now rebuilds what sync applied, the accepted
// checkpoint included, and a fresh install starts from its baseline.
test("a reader unlinks a document whose edit only a checkpoint carries", async () => {
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
  const store = await readDocument(offline, world.documentRef(document));
  if (!store) throw offline.failure("cannot open the document");
  offline.setOnline(false);
  await store.setText("seed\nalice\n");
  await store.setText("seed\nalice\nchild\n");
  const writer = await world.restartDevice(alice, offline, false);
  expect(await writer.forgeQueuedCheckpoint()).toBeGreaterThan(0);
  writer.setOnline(true);
  await readDocument(writer, world.documentRef(document));
  await writer.idle();

  const synced = "seed\nalice\nchild\n";
  expect(await readText(reader, world.documentRef(document))).toBe(synced);
  await world.unlinkDocument(bob, document, handoff);

  const edited = `${synced}bob\n`;
  await world.editDocument(bob, document, edited, reader);
  const fresh = await world.newDevice(bob);
  expect(await readText(fresh, world.documentRef(document))).toBe(edited);
  expect(await readText(writer, world.documentRef(document))).toBe(edited);
  expectNoSecurityIncidents(world);
}, 240_000);
