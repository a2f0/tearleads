import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
import { until } from "../harness/until";
import { World } from "../harness/world";
import {
  documentSync,
  largeText,
  observedSyncs,
  servedBaselineSegments,
  unlinkBaselineSegments,
  withoutFirstBaselineSegments,
} from "./baselineGroup.testUtils";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

const CONFLICT = "document_sync_update_id_conflict";
const FAILING_PASSES = 7;

// A device sends its queued write with a pull whose first page serves a
// rotation baseline without its first segment. The reader fails that page
// (#3238), after the API committed the write. The device settles nothing
// from a failed page, so the write stays queued and goes out again on every
// pass. Each resend is encrypted again, so the API refuses the reused update
// id with a conflict, and the pass falls back to a read-only recovery pull,
// which fails on the same page: two requests a pass, and no second commit.
// Once the server serves the baseline whole, the recovery pull settles the
// write by its content.
test("a write sent with a failing first page commits once and settles when the page is whole", async () => {
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
  const { documentId } = document;
  const ref = world.documentRef(document);
  const device = bob.devices[0];
  const owner = alice.devices[0];
  if (!device || !owner) throw new Error("Expected original devices");
  const store = await readDocument(device, ref);
  if (!store) throw device.failure("cannot open the document");
  expect(store.getSnapshot().text).toBe("seed\n");

  // While Bob's device is away, Alice writes a history that takes several
  // segments and unlinks, so her baseline carries operations it lacks.
  device.setOnline(false);
  const history = `seed\n${largeText(5)}`;
  await world.editDocument(alice, document, history);
  await world.unlinkDocument(alice, document, handoff);
  expect(unlinkBaselineSegments(owner.transport.history)).toBeGreaterThan(1);

  await store.setText("seed\nbob\n");
  let withheld = true;
  let failedPages = 0;
  device.transport.rewriteResponses(documentSync(documentId), (body) => {
    if (!withheld || servedBaselineSegments(body) === 0) return body;
    failedPages += 1;
    return withoutFirstBaselineSegments(body);
  });
  const before = observedSyncs(device.transport.history, documentId).length;
  const passes = () =>
    observedSyncs(device.transport.history, documentId).slice(before);
  const pass = () =>
    store
      .requestRemoteSyncAndWait(new AbortController().signal)
      .catch(() => false);
  const queued = async () =>
    (
      await device.sdk.containerContents.documentQueries().listPendingWrites()
    ).filter((item) => item.remoteId === documentId).length;

  device.setOnline(true);
  await until(async () => {
    await pass();
    const refused = passes().filter((sync) => sync.errorCode === CONFLICT);
    return refused.length >= FAILING_PASSES;
  }, "passes that resend the committed write");
  const failing = passes();
  // One request that carried the write was answered, after the device
  // refreshed the projection the unlink made stale. Every later one that
  // carried it was refused, and each refusal was followed by a pull that
  // carried none.
  const writes = failing.filter((sync) => sync.outgoing > 0);
  const committedAt = writes.findIndex((sync) => sync.status === 200);
  expect(committedAt).toBeGreaterThanOrEqual(0);
  expect(writes.slice(committedAt + 1).map((sync) => sync.errorCode)).toEqual(
    writes.slice(committedAt + 1).map(() => CONFLICT),
  );
  expect(
    writes.slice(0, committedAt).map((sync) => sync.errorCode),
  ).not.toContain(CONFLICT);
  expect(writes.length).toBeGreaterThan(FAILING_PASSES);
  for (const [index, sync] of failing.entries()) {
    if (sync.errorCode !== CONFLICT) continue;
    expect(failing[index + 1]).toMatchObject({ outgoing: 0, status: 200 });
  }
  expect(failedPages).toBeGreaterThan(FAILING_PASSES);
  // Nothing settled and nothing was imported, however many passes failed.
  expect(await queued()).toBe(1);
  expect(store.getSnapshot().text).toBe("seed\nbob\n");
  // The other member already reads the write the server committed.
  const committed = await readText(owner, ref);
  if (committed === null) throw owner.failure("cannot read the document");
  expect(committed).toContain("bob\n");
  expect(committed).toContain(history.slice("seed\n".length));

  // The server serves the baseline whole: the recovery pull settles the row.
  withheld = false;
  await until(async () => {
    await pass();
    return (await queued()) === 0;
  }, "the write to settle");
  const settled = passes().slice(failing.length);
  expect(settled.filter((sync) => sync.outgoing > 0)).toEqual([
    expect.objectContaining({ errorCode: CONFLICT, status: 409 }),
  ]);
  await device.idle();
  expect(store.getSnapshot().text).toBe(committed);
  // No write went out again, under its id or a fresh one: one commit.
  await pass();
  expect(
    passes()
      .slice(failing.length + settled.length)
      .filter((sync) => sync.outgoing > 0),
  ).toEqual([]);
  expect(
    passes().filter((sync) => sync.outgoing > 0 && sync.status === 200),
  ).toHaveLength(1);
  const fresh = await world.newDevice(alice);
  expect(await readText(fresh, ref)).toBe(committed);
}, 240_000);
