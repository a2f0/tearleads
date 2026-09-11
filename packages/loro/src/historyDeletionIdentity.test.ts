import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
} from "./document";
import { updateMatchesDocumentHistory } from "./updateIdentity";

for (const kind of ["text", "list", "movable-list"] as const) {
  for (const backward of [true, false]) {
    test(`${kind} deletion identity survives ${backward ? "backward" : "forward"} coalescing`, async () => {
      const original = await createDocument("deletion-original-device");
      const writer = await createDocument("deletion-restored-device");
      const reloaded = await createDocument("deletion-reloaded-device");
      try {
        if (kind === "text") original.getText("text").update("abcd");
        else {
          const list =
            kind === "list"
              ? original.getList("list")
              : original.getMovableList("list");
          for (const value of ["a", "b", "c", "d"]) list.push(value);
        }
        importSnapshot(writer, exportFullHistorySnapshot(original));
        const sequence =
          kind === "text"
            ? writer.getText("text")
            : kind === "list"
              ? writer.getList("list")
              : writer.getMovableList("list");
        const base = encodeVersionVector(writer);
        sequence.delete(backward ? 3 : 0, 1);
        const first = exportUpdatesSince(writer, base);
        const prefixVersion = encodeVersionVector(writer);
        const prefixIdentity = exportFullHistoryIdentity(writer);
        sequence.delete(backward ? 2 : 0, 1);
        const second = exportUpdatesSince(writer, prefixVersion);

        expect(exportFullHistoryIdentity(writer, prefixVersion)).toBe(
          prefixIdentity,
        );
        importUpdates(original, [first, second]);
        importSnapshot(reloaded, exportFullHistorySnapshot(original));
        for (const document of [original, reloaded]) {
          expect(updateMatchesDocumentHistory(document, first)).toBe(true);
          expect(updateMatchesDocumentHistory(document, second)).toBe(true);
        }
      } finally {
        original.free();
        writer.free();
        reloaded.free();
      }
    });
  }
}

test("deletions of different characters remain different at the same frontier", async () => {
  const initial = await createDocument("deletion-base");
  const genuine = await createDocument("deletion-writer");
  const conflicting = await createDocument("deletion-writer");
  try {
    initial.getText("text").update("aaaa");
    const snapshot = exportFullHistorySnapshot(initial);
    importSnapshot(genuine, snapshot);
    importSnapshot(conflicting, snapshot);
    const base = encodeVersionVector(genuine);
    genuine.getText("text").delete(3, 1);
    conflicting.getText("text").delete(0, 1);
    const genuineUpdate = exportUpdatesSince(genuine, base);
    const conflictingUpdate = exportUpdatesSince(conflicting, base);

    expect(genuine.toJSON()).toEqual(conflicting.toJSON());
    expect(encodeVersionVector(genuine)).toBe(encodeVersionVector(conflicting));
    expect(updateMatchesDocumentHistory(genuine, genuineUpdate)).toBe(true);
    expect(updateMatchesDocumentHistory(genuine, conflictingUpdate)).toBe(
      false,
    );
  } finally {
    initial.free();
    genuine.free();
    conflicting.free();
  }
});

test("deletion-shaped application values retain their exact identity", async () => {
  const negative = await createDocument("deletion-shaped-value");
  const positive = await createDocument("deletion-shaped-value");
  try {
    negative.getMap("fields").set("value", { type: "delete", len: -1 });
    positive.getMap("fields").set("value", { type: "delete", len: 1 });
    negative.commit();
    positive.commit();
    expect(encodeVersionVector(negative)).toBe(encodeVersionVector(positive));
    expect(exportFullHistoryIdentity(negative)).not.toBe(
      exportFullHistoryIdentity(positive),
    );
    expect(
      updateMatchesDocumentHistory(negative, exportUpdatesSince(positive)),
    ).toBe(false);
  } finally {
    negative.free();
    positive.free();
  }
});

test("coalesced backspaces still reject a conflicting same-peer deletion", async () => {
  const original = await createDocument("coalesced-deletion-base");
  const genuine = await createDocument("coalesced-deletion-writer");
  const conflicting = await createDocument("coalesced-deletion-writer");
  try {
    original.getText("text").update("abcdef");
    const snapshot = exportFullHistorySnapshot(original);
    importSnapshot(genuine, snapshot);
    importSnapshot(conflicting, snapshot);
    const genuineUpdates: Uint8Array[] = [];
    const conflictingUpdates: Uint8Array[] = [];
    for (const position of [5, 4, 3]) {
      const base = encodeVersionVector(genuine);
      genuine.getText("text").delete(position, 1);
      conflicting.getText("text").delete(position - 1, 1);
      genuineUpdates.push(exportUpdatesSince(genuine, base));
      conflictingUpdates.push(exportUpdatesSince(conflicting, base));
    }
    importUpdates(original, genuineUpdates);
    expect(encodeVersionVector(genuine)).toBe(encodeVersionVector(conflicting));
    for (const update of genuineUpdates) {
      expect(updateMatchesDocumentHistory(original, update)).toBe(true);
    }
    for (const update of conflictingUpdates) {
      expect(updateMatchesDocumentHistory(original, update)).toBe(false);
    }
  } finally {
    original.free();
    genuine.free();
    conflicting.free();
  }
});

test("direction remains part of multi-element deletion identity", async () => {
  const initial = await createDocument("deletion-direction-base");
  const backward = await createDocument("deletion-direction-writer");
  const forward = await createDocument("deletion-direction-writer");
  try {
    initial.getText("text").update("aaaaaa");
    const snapshot = exportFullHistorySnapshot(initial);
    importSnapshot(backward, snapshot);
    importSnapshot(forward, snapshot);
    const base = encodeVersionVector(backward);
    backward.getText("text").delete(3, 1);
    backward.getText("text").delete(2, 1);
    forward.getText("text").delete(2, 2);

    expect(backward.toJSON()).toEqual(forward.toJSON());
    expect(encodeVersionVector(backward)).toBe(encodeVersionVector(forward));
    expect(exportFullHistoryIdentity(backward)).not.toBe(
      exportFullHistoryIdentity(forward),
    );
    expect(
      updateMatchesDocumentHistory(backward, exportUpdatesSince(forward, base)),
    ).toBe(false);
  } finally {
    initial.free();
    backward.free();
    forward.free();
  }
});
