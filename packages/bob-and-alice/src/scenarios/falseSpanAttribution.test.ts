import { afterEach, expect, test } from "bun:test";
import {
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { Device } from "../harness/device";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

interface CreditedRun {
  readonly peerId: string;
  readonly startCounter: number;
  readonly endCounter: number;
  readonly writerUserId: string;
}

/** Every range `device` reads for the document, page by page. */
async function attributionRanges(device: Device, documentId: string) {
  const ranges: (CreditedRun & { readonly updateId: string })[] = [];
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

/** Who each source credits with operation `counter` of `peerId`. */
function creditedWith(
  runs: readonly CreditedRun[],
  peerId: string,
  counter: number,
): string[] {
  return runs
    .filter(
      (run) =>
        run.peerId === peerId &&
        run.startCounter <= counter &&
        counter < run.endCounter,
    )
    .map((run) => run.writerUserId);
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

// A writer signs an update whose declared span claims operations of another
// writer's peer that the other writer has not made yet. The API credits each
// operation to the earliest update whose span covers it, so it credits the
// other writer's later edit to the false update, and History would bound
// that edit by the false update's upload time. A reader that voided the
// false update credits nobody with those operations, in its per-upload
// ranges (History, Explorer), its compact segments (row writers), and
// Info's contributors alike.
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

  // Alice's edit queues offline; a modified client then claims Bob's next
  // operations in its span and signs that on the next start.
  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  const liarStore = await readDocument(offline, world.documentRef(document));
  if (!liarStore) throw offline.failure("cannot open the document");
  offline.setOnline(false);
  await liarStore.setText("seed\nbob\nalice\n");
  const liar = await world.restartDevice(alice, offline, false);
  expect(
    await liar.forgeQueuedUpdateSpans(({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ [bobPeer]: next + 64 }),
      ]),
      start: mergeVersionVectors([
        start,
        encodeVersionVectorCounters({ [bobPeer]: next }),
      ]),
    })),
  ).toBe(1);
  const sentBefore = liar.transport.history.length;
  liar.setOnline(true);
  await readDocument(liar, world.documentRef(document));
  await liar.idle();
  const [forgedId] = sentUpdateIds(liar, sentBefore);
  if (!forgedId) throw new Error("Expected the forged update to be sent");

  // Bob voids it, then makes the operations it claimed.
  expect(await readText(reader, world.documentRef(document))).toBe(
    "seed\nbob\n",
  );
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
  expectNoSecurityIncidents(world);
}, 240_000);
