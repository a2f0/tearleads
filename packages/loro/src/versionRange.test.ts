import { expect, test } from "bun:test";
import type { LoroDoc } from "loro-crdt";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getImportBlobMetadata,
  importUpdates,
  LoroImportUnresolvedDependenciesError,
  mergeVersionVectors,
  versionVectorsEqual,
} from "./document";
import { updateMatchesDocumentHistory } from "./updateIdentity";
import {
  exportUpdatesInVersionRange,
  minimumVersionVectors,
} from "./versionRange";

function commitText(doc: LoroDoc, value: string): Uint8Array {
  const before = encodeVersionVector(doc);
  doc.getText("text").update(value);
  doc.commit();
  return exportUpdatesSince(doc, before);
}

function unionRange(updates: ReadonlyArray<Uint8Array>) {
  const metadata = updates.map(getImportBlobMetadata);
  return {
    start: minimumVersionVectors(
      metadata.map((entry) => entry.partialStartVersionVector),
    ),
    end: mergeVersionVectors(
      metadata.map((entry) => entry.partialEndVersionVector),
    ),
  };
}

function expectExport(doc: LoroDoc, start: string, end: string): Uint8Array {
  const merged = exportUpdatesInVersionRange(doc, start, end);
  if (!merged) throw new Error("expected a merged update");
  return merged;
}

test("merged consecutive local updates import like every member", async () => {
  const source = await createDocument("range-merge-source");
  const members = [
    commitText(source, "a"),
    commitText(source, "ab"),
    commitText(source, "abc"),
  ];
  const { start, end } = unionRange(members);
  const merged = expectExport(source, start, end);

  const viaMembers = await createDocument("range-merge-members");
  importUpdates(viaMembers, members);
  const viaMerged = await createDocument("range-merge-merged");
  importUpdates(viaMerged, [merged]);

  expect(viaMerged.toJSON()).toEqual(viaMembers.toJSON());
  expect(encodeVersionVector(viaMerged)).toBe(encodeVersionVector(viaMembers));
  const metadata = getImportBlobMetadata(merged);
  expect(metadata.mode).toBe("update");
  expect(versionVectorsEqual(metadata.partialStartVersionVector, start)).toBe(
    true,
  );
  expect(versionVectorsEqual(metadata.partialEndVersionVector, end)).toBe(true);
  expect(updateMatchesDocumentHistory(source, merged)).toBe(true);
});

test("merged range excludes interleaved remote operations", async () => {
  const local = await createDocument("range-local");
  const remote = await createDocument("range-remote");
  const first = commitText(local, "local one");
  importUpdates(remote, [exportUpdatesSince(local)]);
  const remoteUpdate = commitText(remote, "local one remote");
  importUpdates(local, [remoteUpdate]);
  const second = commitText(local, "local one remote local two");
  const { start, end } = unionRange([first, second]);
  const merged = expectExport(local, start, end);

  const decodedEnd = decodeVersionVector(
    getImportBlobMetadata(merged).partialEndVersionVector,
  );
  expect(decodedEnd.get(remote.peerIdStr)).toBeUndefined();
  expect(decodedEnd.get(local.peerIdStr)).toBe(
    local.oplogVersion().get(local.peerIdStr),
  );

  const receiver = await createDocument("range-receiver");
  importUpdates(receiver, [first, remoteUpdate, merged]);
  expect(receiver.getText("text").toString()).toBe(
    local.getText("text").toString(),
  );
  // The remote op stays out of the blob, so it is still a dependency.
  const withoutRemote = await createDocument("range-receiver-no-remote");
  expect(() => importUpdates(withoutRemote, [first, merged])).toThrow(
    LoroImportUnresolvedDependenciesError,
  );
});

test("merged range covers several peers' spans", async () => {
  const left = await createDocument("range-peer-left");
  const right = await createDocument("range-peer-right");
  const leftUpdate = commitText(left, "left");
  importUpdates(right, [leftUpdate]);
  const rightUpdate = commitText(right, "left right");
  importUpdates(left, [rightUpdate]);
  const leftSecond = commitText(left, "left right again");
  const members = [leftUpdate, rightUpdate, leftSecond];
  const { start, end } = unionRange(members);
  const merged = expectExport(left, start, end);

  const viaMembers = await createDocument("range-peers-members");
  importUpdates(viaMembers, members);
  const viaMerged = await createDocument("range-peers-merged");
  importUpdates(viaMerged, [merged]);
  expect(viaMerged.toJSON()).toEqual(viaMembers.toJSON());
  const metadata = getImportBlobMetadata(merged);
  expect(versionVectorsEqual(metadata.partialStartVersionVector, start)).toBe(
    true,
  );
  expect(versionVectorsEqual(metadata.partialEndVersionVector, end)).toBe(true);
});

test("uncovered end, inverted range and empty range export nothing", async () => {
  const source = await createDocument("range-null-source");
  const first = commitText(source, "one");
  const second = commitText(source, "one two");
  const firstMetadata = getImportBlobMetadata(first);
  const secondMetadata = getImportBlobMetadata(second);
  const behind = await createDocument("range-null-behind");
  importUpdates(behind, [first]);

  expect(
    exportUpdatesInVersionRange(
      behind,
      firstMetadata.partialStartVersionVector,
      secondMetadata.partialEndVersionVector,
    ),
  ).toBeNull();
  expect(
    exportUpdatesInVersionRange(
      source,
      secondMetadata.partialEndVersionVector,
      firstMetadata.partialEndVersionVector,
    ),
  ).toBeNull();
  expect(
    exportUpdatesInVersionRange(
      source,
      firstMetadata.partialEndVersionVector,
      firstMetadata.partialEndVersionVector,
    ),
  ).toBeNull();
});

test("minimum version vector keeps each peer's smallest counter", async () => {
  const source = await createDocument("range-minimum");
  const first = getImportBlobMetadata(commitText(source, "x"));
  const second = getImportBlobMetadata(commitText(source, "xy"));
  expect(
    versionVectorsEqual(
      minimumVersionVectors([
        second.partialStartVersionVector,
        first.partialStartVersionVector,
      ]),
      first.partialStartVersionVector,
    ),
  ).toBe(true);
});
