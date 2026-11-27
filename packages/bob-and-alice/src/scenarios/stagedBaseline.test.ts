import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import type { Exchange } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";
import { largeText } from "./baselineGroup.testUtils";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

/** The answered stage requests of `documentId`, as `METHOD suffix`. */
function stageCalls(history: readonly Exchange[], documentId: string) {
  const prefix = `/documents/${documentId}/baseline-stages`;
  return history
    .filter(({ path, status }) => path.includes(prefix) && status === 200)
    .map(({ method, path }) => {
      const [, suffix = ""] = path.split(prefix);
      return `${method} ${suffix.replace(/^\/[^/]+/u, "/{id}")}`.trim();
    });
}

function unlinks(history: readonly Exchange[], documentId: string) {
  return history.filter(
    ({ method, path, status }) =>
      method === "POST" &&
      path.endsWith(`/documents/${documentId}/unlink`) &&
      status !== undefined,
  );
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? Reflect.get(body, name)
    : undefined;
}

// A document whose history is larger than one request could not rotate
// (#3238): its unlink was refused for its size, so no member could unlink,
// move or purge-unlink it. The SDK now uploads every segment of the baseline
// but the final one to a stage, and the unlink carries the final segment
// and names the stage.
//
// Here the rotator's unlink is held at the network just before it commits,
// and another member writes meanwhile. The API refuses the unlink, because
// the staged group stops short of that write. The rotator proves its history
// again, stages a tail segment behind what is already uploaded, and commits.
// A fresh install then reads the whole document from that one baseline.
test("a baseline too large for one request is staged, takes a tail after a racing write, and is read whole", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const team = await world.createFolder(alice, world.root(alice), "Team");
  const handoff = await world.createFolder(alice, world.root(alice), "Handoff");
  // Two writes, each of which fits a sync request, whose history together is
  // past 16 MiB once it is base64 inside its envelopes.
  const opening = largeText(7);
  const history = `${opening}${largeText(6)}`;
  const document = await world.createDocument(alice, team, opening);
  await world.editDocument(alice, document, history);
  await world.shareWithUser(alice, team, bob);
  await world.shareWithUser(alice, handoff, bob);
  await world.linkDocument(alice, document, handoff);
  const { documentId } = document;
  const ref = world.documentRef(document);
  const writer = alice.devices[0];
  const rotator = bob.devices[0];
  if (!writer || !rotator) throw new Error("Expected original devices");
  // Bob's device pulls the document before it writes to it, so his edit is
  // a line and not the whole text again: one update of this text would not
  // fit a sync request.
  const held = await readDocument(rotator, ref);
  if (!held) throw rotator.failure("cannot open the document");
  await until(async () => {
    if (held.getSnapshot().text === history) return true;
    await held
      .requestRemoteSyncAndWait(new AbortController().signal)
      .catch(() => false);
    return false;
  }, "the rotator to hold the document");
  // Bob's edit is the last operation of the history his unlink first proves.
  const edited = `${history}bob\n`;
  await world.editDocument(bob, document, edited);

  // Bob's unlink waits at the network with its baseline already staged.
  const commit = rotator.transport.hold(
    "before-request",
    ({ method, path }) =>
      method === "POST" && path.endsWith(`/documents/${documentId}/unlink`),
  );
  const unlinking = world.unlinkDocument(bob, document, handoff);
  await commit.wait();
  const stagedFirst = stageCalls(rotator.transport.history, documentId);
  expect(stagedFirst[0]).toBe("POST");
  const firstSegments = stagedFirst.filter((call) =>
    call.startsWith("PUT /{id}/segments/"),
  );
  // The history is several segments, and all but the final one are staged.
  expect(firstSegments.length).toBeGreaterThan(2);
  expect(firstSegments).toEqual(
    firstSegments.map((_, index) => `PUT /{id}/segments/${index}`),
  );

  // Alice writes while the rotator's final segment waits.
  const raced = `${edited}alice wrote while bob rotated\n`;
  await world.editDocument(alice, document, raced, writer);
  commit.release();
  await unlinking;

  // The first unlink was refused as stale and the second committed. Both
  // carried one segment and named the same stage: nothing was sent whole.
  const sent = unlinks(rotator.transport.history, documentId);
  expect(sent.map(({ errorCode, status }) => [status, errorCode])).toEqual([
    [409, "document_unlink_rotation_baseline_stale"],
    [200, undefined],
  ]);
  const stageIds = sent.map(({ body }) => field(body, "baselineStageId"));
  expect(stageIds[0]).toBeString();
  expect(stageIds[1]).toBe(stageIds[0]);
  for (const { body } of sent) {
    expect(field(body, "rotationBaseline")).toHaveLength(1);
  }
  // After the refusal the stage was read and kept: no second stage, no
  // segment uploaded twice, and no header signed again. The tail, what the
  // re-proven history holds past the staged segments, went behind them; it
  // is small here, so all of it is the new final segment.
  const stagedAfter = stageCalls(rotator.transport.history, documentId).slice(
    stagedFirst.length,
  );
  expect(stagedAfter[0]).toBe("GET /{id}");
  expect(stagedAfter).not.toContain("POST");
  expect(stagedAfter.filter((call) => call.startsWith("PUT"))).toEqual(
    stagedAfter
      .filter((call) => call.startsWith("PUT"))
      .map((_, index) => `PUT /{id}/segments/${firstSegments.length + index}`),
  );
  const [refused, committed] = sent.map(({ body }) => {
    const [final] = [field(body, "rotationBaseline")].flat();
    return final;
  });
  expect(field(committed, "id")).not.toBe(field(refused, "id"));
  const finalIndex = field(committed, "baselineSegmentIndex");
  expect(finalIndex).toBeGreaterThanOrEqual(firstSegments.length);
  expect(field(committed, "baselineSegmentCount")).toBe(Number(finalIndex) + 1);

  // A fresh install has only the new key: it reads the baseline, staged
  // segments, tail and final, and holds the racing write with the rest.
  const fresh = await world.newDevice(alice);
  expect(await readText(fresh, ref)).toBe(raced);
  expect(await readText(rotator, ref)).toBe(raced);
  expect(await readText(writer, ref)).toBe(raced);
  expect(fresh.errors).toEqual([]);
  // The refused unlink is the one failure the rotator reported, as it is for
  // a stale baseline sent whole.
  expect(rotator.errors.map(({ message }) => message)).toEqual([
    expect.stringContaining("Document unlink rotation baseline is stale"),
  ]);
  expectNoSecurityIncidents(world);
}, 600_000);
