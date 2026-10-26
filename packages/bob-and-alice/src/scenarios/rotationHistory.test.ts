import { afterEach, expect, test } from "bun:test";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { trace } from "../harness/trace";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// Each kind of subtractive change rotates the folder's key: a group shrink,
// a direct revoke, and a move. Fresh installs afterwards must still read the
// document, and nobody removed may see what was written after they left.
test("fresh devices read a document across mixed key rotations", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  const erin = await world.register("erin");
  for (const member of [bob, carol, dave, erin]) {
    await world.addToOrganization(alice, member);
  }

  const folder = await world.createFolder(alice, world.root(alice), "Project");
  const archive = await world.createFolder(alice, world.root(alice), "Archive");
  const document = await world.createDocument(alice, folder, "v1 alice");
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);
  await world.addToGroup(alice, team, carol);
  await world.shareWithGroup(alice, folder, team, "write");
  await world.shareWithUser(alice, folder, dave);
  await world.editDocument(bob, document, "v2 bob through the group");
  await expectAccess(world, document);

  const epochs = [await world.keyEpoch(alice, folder)];
  const contentEpochs = [await world.contentKeyEpoch(alice, document)];
  await world.removeFromGroup(alice, team, carol);
  epochs.push(await world.keyEpoch(alice, folder));
  await world.editDocument(alice, document, "v3 alice after carol left");
  contentEpochs.push(await world.contentKeyEpoch(alice, document));
  // Checked before the next rotation, which could otherwise hide a leak.
  await expectAccess(world, document);

  await world.revoke(alice, folder, dave);
  epochs.push(await world.keyEpoch(alice, folder));
  // The first write after access shrinks moves the document to a fresh
  // content key; a fresh install making it must first read the history kept
  // under keys that only the current folder key's keyring still opens.
  const bobFresh = await world.newDevice(bob);
  await world.editDocument(bob, document, "v4 bob's fresh install", bobFresh);
  contentEpochs.push(await world.contentKeyEpoch(alice, document));
  await expectAccess(world, document);

  await world.moveFolder(alice, folder, archive);
  epochs.push(await world.keyEpoch(alice, folder));
  trace(`folder epochs ${epochs}; content-key epochs ${contentEpochs}`);
  // Every subtractive step above minted a new folder key, and every shrink
  // a new document content key for the writes after it.
  for (const series of [epochs, contentEpochs]) {
    for (let index = 1; index < series.length; index += 1) {
      expect(series[index]).toBeGreaterThan(series[index - 1] ?? Infinity);
    }
  }

  // Nobody has written since the move, so the document's content key is
  // still wrapped only to the pre-move folder key. A member admitted now
  // holds only the current wrap and must reach that key through the
  // folder's keyring.
  const currentFolderEpoch = epochs.at(-1) ?? 0;
  expect(
    (await world.bundleKeyEpochs(alice, document)).every(
      (epoch) => epoch < currentFolderEpoch,
    ),
  ).toBe(true);
  await world.shareWithUser(alice, folder, erin);
  await world.newDevice(erin);
  await expectAccess(world, document);

  await world.editDocument(alice, document, "v5 alice after the move");
  for (const user of [alice, carol, dave, erin]) {
    await world.newDevice(user);
  }
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 300_000);
