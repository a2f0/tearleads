import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
  LoroReusedOperationIdError,
} from "./document";

type Document = Awaited<ReturnType<typeof createDocument>>;

/** A document on the peer `seed` derives, holding `text`. */
async function documentWith(seed: string, text: string): Promise<Document> {
  const doc = await createDocument(seed);
  doc.getText("text").insert(0, text);
  doc.commit();
  return doc;
}

function refusal(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

test.each([
  ["as many operations", "bbbb"],
  ["more operations", "bbbbbbbb"],
])(
  "an update that reuses held ids with other content, carrying %s, is refused by name",
  async (_case, forgedText) => {
    const held = await documentWith("reused-peer", "aaaa");
    const forged = await documentWith("reused-peer", forgedText);
    const before = encodeVersionVector(held);

    const error = refusal(() =>
      importUpdates(held, [exportAllUpdates(forged)]),
    );

    expect(error).toBeInstanceOf(LoroReusedOperationIdError);
    if (!(error instanceof LoroReusedOperationIdError)) return;
    expect(error.peerId).toBe(held.peerIdStr);
    expect(error.counter).toBe(0);
    // Loro's own words stay reachable for a log.
    expect(error.cause).toStartWith("Every op id should be unique.");
    expect(held.getText("text").toString()).toBe("aaaa");
    expect(encodeVersionVector(held)).toBe(before);
    held.free();
    forged.free();
  },
);

test("a snapshot that reuses held ids with other content is refused by name", async () => {
  const held = await documentWith("reused-snapshot-peer", "aaaa");
  const forged = await documentWith("reused-snapshot-peer", "bbbb");

  expect(() => importSnapshot(held, exportFullHistorySnapshot(forged))).toThrow(
    LoroReusedOperationIdError,
  );
  expect(held.getText("text").toString()).toBe("aaaa");
  held.free();
  forged.free();
});

test("operations a document already holds import again as a no-op", async () => {
  const held = await documentWith("held-twice", "aaaa");
  const before = encodeVersionVector(held);
  const extended = await createDocument("held-twice");
  importSnapshot(extended, exportFullHistorySnapshot(held));
  extended.getText("text").insert(4, "more");
  extended.commit();

  importUpdates(held, [exportAllUpdates(held)]);
  expect(encodeVersionVector(held)).toBe(before);
  // The same operations again, followed by new ones on the same peer.
  importUpdates(held, [exportAllUpdates(extended)]);
  expect(held.getText("text").toString()).toBe("aaaamore");
  held.free();
  extended.free();
});

test("a batch with a refused update keeps what its other updates brought", async () => {
  const held = await documentWith("batch-held", "aaaa");
  const forged = await documentWith("batch-held", "bbbb");
  const other = await documentWith("batch-other", "cccc");

  expect(() =>
    importUpdates(held, [exportAllUpdates(forged), exportAllUpdates(other)]),
  ).toThrow(LoroReusedOperationIdError);
  expect(held.oplogVersion().get(other.peerIdStr)).toBe(4);
  held.free();
  forged.free();
  other.free();
});

test("a refusal this package has no name for is thrown as Loro threw it", async () => {
  const held = await documentWith("corrupt-held", "aaaa");
  const other = await documentWith("corrupt-other", "cccc");
  const corrupt = exportUpdatesSince(other).slice();
  const damaged = corrupt.length - 3;
  corrupt[damaged] = (corrupt[damaged] ?? 0) ^ 0xff;

  const error = refusal(() => importUpdates(held, [corrupt]));

  expect(error).toBeString();
  expect(error).not.toBeInstanceOf(LoroReusedOperationIdError);
  held.free();
  other.free();
});
