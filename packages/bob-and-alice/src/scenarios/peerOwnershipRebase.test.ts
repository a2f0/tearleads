import { afterEach, expect, test } from "bun:test";
import {
  listVersionVectorSpans,
  type VersionVectorSpan,
} from "@tearleads/loro";
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

const PEER_OWNED = "document_sync_peer_owned";

interface UpdateSpans {
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/**
 * The document's writes `device` made after its first `since` requests, each
 * with the op spans its updates declare.
 */
function documentWrites(device: Device, documentId: string, since: number) {
  return device.transport.history
    .slice(since)
    .filter(documentWrite(documentId))
    .map(({ body, errorCode, status }) => ({
      outcome: { errorCode, status },
      spans: (
        body as { outgoingUpdates: UpdateSpans[] }
      ).outgoingUpdates.flatMap((update) => listVersionVectorSpans(update)),
    }));
}

// Another user commits Alice's first queued update under his own signature
// before Alice sends it, so he owns her record peer up to that update's end.
// Alice's queue extends the peer past it: the API refuses it as another
// user's peer, her device moves its unsent operations onto a fresh peer, and
// its very next write lands. Every reader then holds both edits exactly once.
test("a writer whose record peer another user owns rebases and syncs", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(bob, alice);
  const folder = await world.createFolder(bob, world.root(bob), "Shared");
  const document = await world.createDocument(bob, folder, "seed\n");
  await world.shareWithUser(bob, folder, alice);
  const ref = world.documentRef(document);
  const [aliceDevice] = alice.devices;
  const [bobDevice] = bob.devices;
  if (!aliceDevice || !bobDevice) throw new Error("Expected both devices");
  expect(await readText(aliceDevice, ref)).toBe("seed\n");

  // Alice queues two edits offline on her record peer. An open store keeps
  // the runtime it opened with, so she restarts offline: nothing she queued
  // reaches the API before Bob commits.
  const held = await readDocument(aliceDevice, ref);
  if (!held) throw aliceDevice.failure("cannot open the document");
  aliceDevice.setOnline(false);
  await held.setText("seed\nfirst\n");
  await held.setText("seed\nfirst\nsecond\n");
  const writer = await world.restartDevice(alice, aliceDevice, false);
  const queued = await writer.queuedDocumentUpdates(document.documentId);
  const [first] = queued;
  if (!first) throw new Error("Expected Alice's first queued update");
  const [relayed, ...otherSpans] = listVersionVectorSpans(first);
  if (!relayed || otherSpans.length > 0) {
    throw new Error("Expected the first update on one peer");
  }
  expect(
    queued.some((update) =>
      listVersionVectorSpans(update).some(
        ({ endCounter, peerId }) =>
          peerId === relayed.peerId && endCounter > relayed.endCounter,
      ),
    ),
  ).toBe(true);

  // Bob's modified client relays that first update as his own and commits
  // it, which claims Alice's record peer for Bob up to its end.
  const relay = await world.restartDevice(bob, bobDevice, false);
  await relay.relayQueuedUpdate(document.documentId, first);
  const relaySince = relay.transport.history.length;
  relay.setOnline(true);
  await readDocument(relay, ref);
  await relay.idle();
  expect(
    documentWrites(relay, document.documentId, relaySince).map(
      ({ outcome }) => outcome,
    ),
  ).toEqual([{ errorCode: undefined, status: 200 }]);

  // Alice's queue is refused once, and her very next write sends the rebased
  // queue: nothing waits on another device or a later fetch.
  const writerSince = writer.transport.history.length;
  writer.setOnline(true);
  const store = await readDocument(writer, ref);
  if (!store) throw writer.failure("cannot reopen the document");
  await writer.idle();
  await until(
    async () =>
      (await writer.queuedDocumentUpdates(document.documentId)).length === 0,
    "Alice's queue to drain",
  );
  const writes = documentWrites(writer, document.documentId, writerSince);
  expect(writes.map(({ outcome }) => outcome)).toEqual([
    { errorCode: PEER_OWNED, status: 409 },
    { errorCode: undefined, status: 200 },
  ]);
  const [refused, rebased] = writes;
  if (!refused || !rebased) throw new Error("Expected two writes");
  // The refused write extended Alice's peer past Bob's commit. The retry
  // re-asserts that peer no further than Bob's commit and carries the rest of
  // her edits on a fresh peer.
  const pastBob = ({ endCounter, peerId }: VersionVectorSpan) =>
    peerId === relayed.peerId && endCounter > relayed.endCounter;
  expect(new Set(refused.spans.map(({ peerId }) => peerId))).toEqual(
    new Set([relayed.peerId]),
  );
  expect(refused.spans.some(pastBob)).toBe(true);
  expect(rebased.spans.filter(pastBob)).toEqual([]);
  expect(
    rebased.spans.filter(({ peerId }) => peerId !== relayed.peerId),
  ).not.toHaveLength(0);
  expect(store.getSnapshot().text).toBe("seed\nfirst\nsecond\n");

  // Fresh installs read both edits from the API, once each.
  for (const user of [bob, alice]) {
    const reader = await world.newDevice(user);
    expect(await readText(reader, ref)).toBe("seed\nfirst\nsecond\n");
  }
  expectNoSecurityIncidents(world);
}, 180_000);
