import { afterEach, expect, test } from "bun:test";
import type { Device } from "../harness/device";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { until } from "../harness/until";
import { World } from "../harness/world";
import {
  documentSync,
  largeText,
  observedSyncs,
  servedBaselineSegments,
  unlinkBaselineSegments,
  withPageLimit,
} from "./baselineGroup.testUtils";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

/** What one answered sync page of the document served. */
interface ServedPage {
  readonly ordinary: number;
  readonly segments: number;
}

/**
 * Makes `device` ask for the document one update a page from now on, as a
 * device isolating an update does, and records what each page served.
 */
function pageByUpdate(device: Device, documentId: string): ServedPage[] {
  const pages: ServedPage[] = [];
  device.transport.rewriteRequests(documentSync(documentId), withPageLimit(1));
  device.transport.rewriteResponses(documentSync(documentId), (body) => {
    const updates =
      typeof body === "object" && body !== null && "updates" in body
        ? body.updates
        : [];
    const served = Array.isArray(updates) ? updates.length : 0;
    const segments = servedBaselineSegments(body);
    pages.push({ ordinary: served - segments, segments });
    return body;
  });
  return pages;
}

// A rotation baseline is an ordered group of segments (#3238). A reader is
// served them as ordinary updates, over as many pages as they take, and
// holds the server to the whole group: each next index, then the count and
// digest its final segment signs. Here a group of several segments crosses
// page boundaries twice. A fresh install is redirected to the group and
// follows it a segment a page, and the group is the only carrier of every
// edit it reads. A second rotation then reads the raw history, which no
// redirect shortens, a segment a page, and must rebuild exactly what sync
// applied before its unlink goes out.
test("a baseline of several segments is read whole across pages", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const team = await world.createFolder(alice, world.root(alice), "Team");
  const handoff = await world.createFolder(alice, world.root(alice), "Handoff");
  const history = largeText(9);
  const document = await world.createDocument(alice, team, history);
  await world.shareWithUser(alice, team, bob);
  await world.shareWithUser(alice, handoff, bob);
  await world.linkDocument(alice, document, handoff);
  const { documentId } = document;
  const ref = world.documentRef(document);
  const owner = alice.devices[0];
  const reader = bob.devices[0];
  if (!owner || !reader) throw new Error("Expected original devices");

  // Bob's edit is the last operation of the history his unlink rotates.
  const edited = `${history}bob\n`;
  await world.editDocument(bob, document, edited);
  await world.unlinkDocument(bob, document, handoff);
  const segments = unlinkBaselineSegments(reader.transport.history);
  expect(segments).toBeGreaterThan(2);

  // A fresh install: redirected to the group, and served nothing else.
  const fresh = await world.newDevice(alice);
  const freshPages = pageByUpdate(fresh, documentId);
  const freshStore = await readDocument(fresh, ref);
  if (!freshStore) throw fresh.failure("cannot open the document");
  await until(async () => {
    if (freshStore.getSnapshot().text === edited) return true;
    await freshStore
      .requestRemoteSyncAndWait(new AbortController().signal)
      .catch(() => false);
    return false;
  }, "the fresh install to read the baseline");
  const served = freshPages.filter((page) => page.ordinary + page.segments > 0);
  expect(served).toEqual(
    Array.from({ length: segments }, () => ({ ordinary: 0, segments: 1 })),
  );
  // Every page after the first continues the group, and is asked for with
  // no version although the install holds the segments before it by then.
  const continued = observedSyncs(fresh.transport.history, documentId).filter(
    (sync) => sync.pullCursor !== undefined,
  );
  expect(continued.length).toBeGreaterThanOrEqual(segments - 1);
  for (const sync of continued) {
    expect(sync).toMatchObject({ outgoing: 0, status: 200, version: null });
  }
  expect(fresh.errors).toEqual([]);

  // A second rotation, from a device that asks for one update a page. Its
  // raw-history pull is served every update, the first group among them,
  // and the unlink goes out only if the rebuild equals what sync applied.
  const rawPages = pageByUpdate(owner, documentId);
  expect(await readText(owner, ref)).toBe(edited);
  await world.linkDocument(alice, document, handoff);
  const before = observedSyncs(owner.transport.history, documentId).length;
  rawPages.length = 0;
  await world.unlinkDocument(alice, document, handoff);
  const raw = observedSyncs(owner.transport.history, documentId)
    .slice(before)
    .filter((sync) => sync.historyMode === "raw");
  expect(raw.length).toBeGreaterThan(segments);
  for (const sync of raw) {
    expect(sync).toMatchObject({ outgoing: 0, status: 200, version: null });
  }
  expect(rawPages.filter((page) => page.segments > 0)).toEqual(
    Array.from({ length: segments }, () => ({ ordinary: 0, segments: 1 })),
  );
  expect(rawPages.some((page) => page.ordinary === 1)).toBe(true);

  // Every device holds the same text, and a later install starts from the
  // second baseline.
  await world.editDocument(alice, document, `${edited}alice\n`, owner);
  const final = `${edited}alice\n`;
  expect(await readText(reader, ref)).toBe(final);
  expect(await readText(fresh, ref)).toBe(final);
  const later = await world.newDevice(bob);
  expect(await readText(later, ref)).toBe(final);
  expectNoSecurityIncidents(world);
}, 300_000);
