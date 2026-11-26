import { expect, test } from "bun:test";
import {
  createDocument,
  createReadOnlyDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { compareDocumentHistories } from "./documentHistoryComparison";

type WritableDocument = Awaited<ReturnType<typeof createDocument>>;

function commitText(doc: WritableDocument, value: string): void {
  doc.getText("text").update(value);
  doc.commit();
}

/** A fresh document of peer `seed` holding the history in `snapshot`. */
async function continued(
  seed: string,
  snapshot: Uint8Array,
): Promise<WritableDocument> {
  const doc = await createDocument(seed);
  importSnapshot(doc, snapshot);
  return doc;
}

function copyOf(doc: WritableDocument) {
  const copy = createReadOnlyDocument();
  importSnapshot(copy, exportFullHistorySnapshot(doc));
  return copy;
}

test("the same history matches however each side imported it", async () => {
  const writer = await createDocument("compare-writer");
  commitText(writer, "one");
  const first = exportAllUpdates(writer);
  commitText(writer, "one two");
  const viaUpdates = createReadOnlyDocument();
  importUpdates(viaUpdates, [first]);
  importUpdates(viaUpdates, [exportAllUpdates(writer)]);

  expect(
    compareDocumentHistories({ local: copyOf(writer), signed: viaUpdates }),
  ).toEqual({ matches: true, serverAhead: false });
});

test("operations only one side holds are outside the comparison", async () => {
  const writer = await createDocument("compare-shared");
  commitText(writer, "shared");
  const shared = exportFullHistorySnapshot(writer);
  const device = await continued("compare-device", shared);
  commitText(device, "shared, and an unsent edit");
  const server = await continued("compare-other-writer", shared);
  commitText(server, "shared, and an edit not pulled yet");

  // An unsent edit: the device is ahead.
  expect(
    compareDocumentHistories({ local: device, signed: copyOf(writer) }),
  ).toEqual({ matches: true, serverAhead: false });
  // An update the device has not pulled: the server is ahead.
  expect(
    compareDocumentHistories({ local: copyOf(writer), signed: server }),
  ).toEqual({ matches: true, serverAhead: true });
  // Both at once: neither version covers the other.
  expect(compareDocumentHistories({ local: device, signed: server })).toEqual({
    matches: true,
    serverAhead: true,
  });
});

test("histories with no operation in common have nothing that differs", async () => {
  const device = await createDocument("compare-alone-device");
  commitText(device, "device");
  const server = await createDocument("compare-alone-server");
  commitText(server, "server");

  expect(compareDocumentHistories({ local: device, signed: server })).toEqual({
    matches: true,
    serverAhead: true,
  });
  expect(
    compareDocumentHistories({
      local: createReadOnlyDocument(),
      signed: server,
    }),
  ).toEqual({ matches: true, serverAhead: true });
});

test("the same operation ids with other content do not match", async () => {
  const genuine = await createDocument("compare-reused");
  commitText(genuine, "genuine");
  const forged = await createDocument("compare-reused");
  commitText(forged, "forgery");

  expect(
    compareDocumentHistories({ local: forged, signed: genuine }).matches,
  ).toBe(false);

  // The device also holds an unsent edit past the forged operations.
  const edited = await continued(
    "compare-reused-device",
    exportFullHistorySnapshot(forged),
  );
  commitText(edited, "forgery, edited");
  expect(
    compareDocumentHistories({ local: edited, signed: genuine }).matches,
  ).toBe(false);
});

// A forger can give a shared operation id a dependency only its own history
// holds, while the genuine operation depends on one only the signed history
// holds. Cut at the versions' meet, both replays would then drop that
// operation and agree on what is left.
test("a shared operation that depends on unshared ones on both sides does not match", async () => {
  const writer = await createDocument("compare-deps-writer");
  commitText(writer, "x");
  const shared = exportFullHistorySnapshot(writer);

  const genuine = await continued("compare-deps-writer", shared);
  const genuineOther = await continued("compare-deps-genuine", shared);
  commitText(genuineOther, "x, other aaaa");
  importUpdates(genuine, [exportAllUpdates(genuineOther)]);
  commitText(genuine, "x, other aaaa, aaaa");

  const forged = await continued("compare-deps-writer", shared);
  const forgedOther = await continued("compare-deps-forger", shared);
  commitText(forgedOther, "x, other bbbb");
  importUpdates(forged, [exportAllUpdates(forgedOther)]);
  commitText(forged, "x, other bbbb, bbbb");

  expect(genuine.oplogVersion().get(genuine.peerIdStr)).toBe(
    forged.oplogVersion().get(forged.peerIdStr),
  );
  expect(compareDocumentHistories({ local: forged, signed: genuine })).toEqual({
    matches: false,
    serverAhead: true,
  });
  expect(compareDocumentHistories({ local: genuine, signed: forged })).toEqual({
    matches: false,
    serverAhead: true,
  });
});
