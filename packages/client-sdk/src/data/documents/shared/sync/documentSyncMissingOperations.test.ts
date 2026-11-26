// A void for want of a held operation names the operations the reader
// lacked. The pass reads them to tell a rotation baseline's segment that
// builds on a void one from a segment served without the ones it builds on
// (`settleBaselineGroupVerdicts`).
import { expect, test } from "bun:test";
import {
  createDocument,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { validateDocumentSyncUpdateImports } from "./documentSyncImportVerdicts";

type Doc = Awaited<ReturnType<typeof createDocument>>;

function edit(document: Doc, lines: number): void {
  for (let line = 0; line < lines; line += 1) {
    const text = document.getText("text");
    text.insert(text.length, `line ${line}\n`);
    document.commit();
  }
}

function count(document: Doc): number {
  return document.oplogVersion().get(document.peerIdStr) ?? 0;
}

/** `document`'s own operations `[start, end)`, as a decrypted update. */
function ownUpdate(
  document: Doc,
  id: string,
  ...ranges: [start: number, end: number][]
) {
  const updateData = document.export({
    mode: "updates-in-range",
    spans: ranges.map(([start, end]) => ({
      id: { counter: start, peer: document.peerIdStr },
      len: end - start,
    })),
  });
  return { id, ...getUpdateVersionVectors(updateData), updateData };
}

/**
 * Two writers: `other`, and `writer`, whose later operations are written on
 * top of `other`'s. `later` is `writer`'s operations from `cut` on: it
 * starts after `writer`'s first `cut` and signs a dependency on `other`.
 */
async function writers() {
  const other = await createDocument("missing-operations-other");
  edit(other, 2);
  const writer = await createDocument("missing-operations-writer");
  edit(writer, 3);
  const cut = count(writer);
  importUpdates(writer, [other.export({ mode: "update" })]);
  edit(writer, 2);
  return {
    cut,
    earlier: ownUpdate(writer, "earlier", [0, cut]),
    later: ownUpdate(writer, "later", [cut, count(writer)]),
    other,
    otherUpdate: ownUpdate(other, "other", [0, count(other)]),
    writer,
  };
}

async function judge(
  held: readonly { readonly updateData: Uint8Array }[],
  update: ReturnType<typeof ownUpdate>,
) {
  const reader = await createDocument(crypto.randomUUID());
  importUpdates(
    reader,
    held.map(({ updateData }) => updateData),
  );
  const { voided } = await validateDocumentSyncUpdateImports({
    currentDocument: reader,
    decryptedUpdates: [update],
  });
  return voided.map(({ missingOperations, stage, updateId }) => ({
    missingOperations,
    stage,
    updateId,
  }));
}

test("a void for want of a held operation names what the reader lacked", async () => {
  const { cut, earlier, later, other, otherUpdate, writer } = await writers();
  const ofWriter = (startCounter: number) => ({
    endCounter: cut,
    peerId: writer.peerIdStr,
    startCounter,
  });
  const ofOther = {
    endCounter: count(other),
    peerId: other.peerIdStr,
    startCounter: 0,
  };
  const byPeer = (voided: Awaited<ReturnType<typeof judge>>) =>
    voided.map((entry) => ({
      ...entry,
      missingOperations: [...(entry.missingOperations ?? [])].sort(
        (left, right) => (left.peerId < right.peerId ? -1 : 1),
      ),
    }));
  const lacking = (...spans: (typeof ofOther)[]) => [
    {
      missingOperations: [...spans].sort((left, right) =>
        left.peerId < right.peerId ? -1 : 1,
      ),
      stage: "loro_import" as const,
      updateId: "later",
    },
  ];

  // It holds everything the update names: no void.
  expect(await judge([earlier, otherUpdate], later)).toEqual([]);
  // It lacks the update's start, and the dependency it signs with it.
  expect(byPeer(await judge([], later))).toEqual(lacking(ofWriter(0), ofOther));
  expect(byPeer(await judge([otherUpdate], later))).toEqual(
    lacking(ofWriter(0)),
  );
  // It holds part of what the update starts after: the rest is lacked.
  expect(
    byPeer(
      await judge([ownUpdate(writer, "part", [0, 2]), otherUpdate], later),
    ),
  ).toEqual(lacking(ofWriter(2)));
  // It holds the start and lacks only the signed dependency.
  expect(byPeer(await judge([earlier], later))).toEqual(lacking(ofOther));
});

// A payload that leaves a gap inside its own range cannot join for any
// reader, whatever the reader holds: no operation the reader lacks is named,
// so nothing reads it as a segment the server left out.
test("a payload that skips its own operations names no missing operation", async () => {
  const { writer, cut } = await writers();
  const gapped = ownUpdate(writer, "gapped", [0, cut - 2], [cut - 1, cut]);
  expect(gapped.partialEndVersionVector).toBe(
    ownUpdate(writer, "whole", [0, cut]).partialEndVersionVector,
  );
  expect(await judge([], gapped)).toEqual([
    {
      missingOperations: undefined,
      stage: "loro_import" as const,
      updateId: "gapped",
    },
  ]);
});
