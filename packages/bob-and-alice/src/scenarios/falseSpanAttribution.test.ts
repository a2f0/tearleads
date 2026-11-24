import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { Device } from "../harness/device";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { documentWrite } from "../harness/transport";
import { type SharedDocument, type User, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  setSystemTime();
  world?.dispose();
  world = null;
});

/** How far past its upload a change's time may be before History says so. */
const CLOCK_AHEAD_NOTICE_MS = 60_000;

interface CreditedRun {
  readonly peerId: string;
  readonly startCounter: number;
  readonly endCounter: number;
  readonly writerUserId: string;
}

interface UploadRun extends CreditedRun {
  readonly createdAt: string;
  readonly updateId: string;
}

/** Every range `device` reads for the document, page by page. */
async function attributionRanges(device: Device, documentId: string) {
  const ranges: UploadRun[] = [];
  let cursor: string | null = null;
  do {
    const page =
      await device.sdk.containerContents.loadDocumentAttributionRanges({
        cursor,
        documentId,
        limit: 500,
      });
    ranges.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ranges;
}

function covering<T extends CreditedRun>(
  runs: readonly T[],
  peerId: string,
  counter: number,
): T[] {
  return runs.filter(
    (run) =>
      run.peerId === peerId &&
      run.startCounter <= counter &&
      counter < run.endCounter,
  );
}

/** Who each source credits with operation `counter` of `peerId`. */
function creditedWith(
  runs: readonly CreditedRun[],
  peerId: string,
  counter: number,
): string[] {
  return covering(runs, peerId, counter).map((run) => run.writerUserId);
}

/** The ids of the updates a device sent after `from` exchanges, in order. */
function sentUpdateIds(device: Device, from: number): string[] {
  return device.transport.history
    .slice(from)
    .flatMap(({ body }) =>
      typeof body === "object" &&
      body !== null &&
      "outgoingUpdates" in body &&
      Array.isArray(body.outgoingUpdates)
        ? body.outgoingUpdates.map((update: { id: string }) => update.id)
        : [],
    );
}

/** The status and code of each write of `documentId` after `from` exchanges. */
function documentWrites(device: Device, documentId: string, from: number) {
  return device.transport.history
    .slice(from)
    .filter(documentWrite(documentId))
    .map(({ errorCode, status }) => ({ errorCode, status }));
}

/**
 * `forger` queues an edit offline and, on the next start, signs it with a
 * declared span that also claims `peerId`'s counters from `next` on, which
 * that peer's writer has not made yet. Returns the forged update's id and
 * the forger's document writes.
 */
async function forgeSpanOnPeer(input: {
  readonly document: SharedDocument;
  readonly forger: Device;
  readonly next: number;
  readonly peerId: string;
  readonly text: string;
  readonly user: User;
  readonly world: World;
}) {
  const { document, forger, next, peerId, world } = input;
  const ref = world.documentRef(document);
  const store = await readDocument(forger, ref);
  if (!store) throw forger.failure("cannot open the document");
  forger.setOnline(false);
  await store.setText(input.text);
  const liar = await world.restartDevice(input.user, forger, false);
  expect(
    await liar.forgeQueuedUpdateSpans(({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ [peerId]: next + 64 }),
      ]),
      start: mergeVersionVectors([
        start,
        encodeVersionVectorCounters({ [peerId]: next }),
      ]),
    })),
  ).toBe(1);
  const sentBefore = liar.transport.history.length;
  liar.setOnline(true);
  await readDocument(liar, ref);
  await liar.idle();
  const [forgedId] = sentUpdateIds(liar, sentBefore);
  if (!forgedId) throw new Error("Expected the forged update to be sent");
  return {
    forgedId,
    writes: documentWrites(liar, document.documentId, sentBefore),
  };
}

// A writer signs an update whose declared span claims operations of another
// writer's peer that the other writer has not made yet. The API credits each
// operation to the earliest update whose span covers it, so it would credit
// the other writer's later edit to the false update, and History would bound
// that edit by the false update's upload time. A reader that voided the
// false update credits nobody with those operations, in its per-upload
// ranges (History, Explorer), its compact segments (row writers), and
// Info's contributors alike.
//
// Peer ownership refuses such a span from another user, so the false update
// here comes from the same user's other device: each device writes on its
// own peer, and ownership is per user.
test("a reader credits no void update with another writer's later edit", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");
  await world.editDocument(bob, document, "seed\nbob\n", reader);

  const [bobRun] = (
    await attributionRanges(reader, document.documentId)
  ).filter((run) => run.writerUserId === bob.userId);
  if (!bobRun) throw new Error("Expected a range of Bob's edit");
  const bobPeer = bobRun.peerId;
  const next = bobRun.endCounter;

  // Another user's claim on Bob's next operations is refused outright: Bob
  // owns his peer, so the API never stores it.
  const alicesDevice = alice.devices[0];
  if (!alicesDevice) throw new Error("Expected Alice's device");
  const refused = await forgeSpanOnPeer({
    document,
    forger: alicesDevice,
    next,
    peerId: bobPeer,
    text: "seed\nbob\nalice\n",
    user: alice,
    world,
  });
  expect(refused.writes.length).toBeGreaterThan(0);
  expect(
    refused.writes.every(
      ({ errorCode, status }) =>
        status === 409 && errorCode === "document_sync_peer_owned",
    ),
  ).toBe(true);

  // Bob's other device, on its own peer, makes the same claim. The API
  // stores it, since Bob owns the peer, and every reader voids it.
  const forged = await forgeSpanOnPeer({
    document,
    forger: await world.newDevice(bob),
    next,
    peerId: bobPeer,
    text: "seed\nbob\nother device\n",
    user: bob,
    world,
  });
  expect(forged.writes.at(-1)).toEqual({ errorCode: undefined, status: 200 });
  const forgedId = forged.forgedId;

  // Bob voids it, then makes the operations it claimed two minutes on, as a
  // change of its own in History.
  expect(await readText(reader, world.documentRef(document))).toBe(
    "seed\nbob\n",
  );
  setSystemTime(new Date(Date.now() + 2 * CLOCK_AHEAD_NOTICE_MS));
  await world.editDocument(bob, document, "seed\nbob\nbob again\n", reader);

  const ranges = await attributionRanges(reader, document.documentId);
  expect(ranges.some((run) => run.updateId === forgedId)).toBe(false);
  expect(creditedWith(ranges, bobPeer, next)).toEqual([]);

  const compact =
    await reader.sdk.containerContents.loadDocumentEditAttribution(
      document.documentId,
    );
  expect(compact?.truncated).toBe(false);
  expect(creditedWith(compact?.segments ?? [], bobPeer, next)).toEqual([]);
  expect(creditedWith(compact?.segments ?? [], bobPeer, 0)).toEqual([
    bob.userId,
  ]);

  const localId = await reader.sdk.documents.findLocalIdByDocumentId(
    document.documentId,
  );
  if (!localId) throw new Error("Expected Bob's local record");
  const info = await reader.sdk.containerContents.loadDocumentInfo({
    localId,
    remoteInfoMode: "if-synced",
  });
  expect(info.remoteInfo?.attributionStatus).toBe("available");
  const segments = info.remoteInfo?.attributionSegments ?? [];
  expect(creditedWith(segments, bobPeer, next)).toEqual([]);
  expect(creditedWith(segments, bobPeer, 0)).toEqual([bob.userId]);

  // History dates and credits each change by the range covering its first
  // operation; Info and row writers by the compact segments. They agree on
  // every change. Bob's new change has no range, so no upload-time bound:
  // the void update's upload would date it two minutes early and say Bob's
  // clock ran ahead.
  const history = await reader.sdk.documents.openHistory(localId);
  if (!history) throw new Error("Expected Bob's document history");
  try {
    expect(
      history.stops.filter(
        (stop) => stop.peerId === bobPeer && stop.startCounter === next,
      ),
    ).toHaveLength(1);
    for (const stop of history.stops) {
      const [upload] = covering(ranges, stop.peerId, stop.startCounter);
      if (upload && stop.committedAt !== null) {
        expect(stop.committedAt - Date.parse(upload.createdAt)).toBeLessThan(
          CLOCK_AHEAD_NOTICE_MS,
        );
      }
      const credited = creditedWith(ranges, stop.peerId, stop.startCounter);
      expect(
        creditedWith(compact?.segments ?? [], stop.peerId, stop.startCounter),
      ).toEqual(credited);
      expect(creditedWith(segments, stop.peerId, stop.startCounter)).toEqual(
        credited,
      );
    }
  } finally {
    history.close();
  }
  expectNoSecurityIncidents(world);
}, 240_000);
