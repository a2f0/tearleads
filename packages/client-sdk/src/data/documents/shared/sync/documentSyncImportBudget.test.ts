import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { validateDocumentSyncUpdateImports } from "./documentSyncImportVerdicts";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";

function decrypted(id: string, data: Uint8Array): DecryptedDocumentSyncUpdate {
  return { id, ...getUpdateVersionVectors(data), updateData: data };
}

async function independent(
  id: string,
  text: string,
): Promise<DecryptedDocumentSyncUpdate> {
  const source = await createDocument(`budget-${id}`);
  source.getText("text").update(text);
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  return decrypted(id, data);
}

/**
 * An update whose own peer starts at its first counter but whose operation
 * depends on another peer's operation the reader never holds. Its counters
 * pass the metadata check, so the import runs and leaves it pending.
 */
async function pendingOnAnotherPeer(
  id: string,
): Promise<DecryptedDocumentSyncUpdate> {
  const parent = await createDocument(`budget-parent-${id}`);
  parent.getText("text").update("parent");
  parent.commit();
  const child = await createDocument(`budget-child-${id}`);
  importUpdates(child, [exportUpdatesSince(parent, undefined)]);
  const afterParent = encodeVersionVector(child);
  child.getText("text").insert(6, " child");
  child.commit();
  const data = exportUpdatesSince(child, afterParent);
  parent.free();
  child.free();
  return decrypted(id, data);
}

const ids = {
  a: "550e8400-e29b-41d4-a716-446655440a01",
  b: "550e8400-e29b-41d4-a716-446655440a02",
  c: "550e8400-e29b-41d4-a716-446655440a03",
  forged: "550e8400-e29b-41d4-a716-446655440a04",
  garbage: "550e8400-e29b-41d4-a716-446655440a05",
  gap: "550e8400-e29b-41d4-a716-446655440a06",
  pending: "550e8400-e29b-41d4-a716-446655440a07",
};

function voidedIds(verdicts: {
  readonly voided: readonly { readonly updateId: string }[];
}) {
  return verdicts.voided.map((entry) => entry.updateId);
}

test("a void whose import changed the scratch document defers the rest of the page once rebuilds are spent", async () => {
  const current = await createDocument("budget-current");
  const page = [
    await independent(ids.a, "first"),
    await pendingOnAnotherPeer(ids.pending),
    await independent(ids.b, "second"),
    await independent(ids.c, "third"),
  ];

  const spent = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: page,
    rebuildBudgetBytes: 0,
  });
  expect(voidedIds(spent)).toEqual([ids.pending]);
  expect(spent.deferredUpdateIds).toEqual([ids.b, ids.c]);

  // The default budget rebuilds once and judges the whole page.
  const judged = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: page,
  });
  expect(voidedIds(judged)).toEqual([ids.pending]);
  expect(judged.deferredUpdateIds).toEqual([]);
});

test("voids that leave the scratch document unchanged cost no rebuild", async () => {
  // The reader already holds these operations; the forged update reuses
  // their peer and counters with different text.
  const current = await createDocument("budget-collision");
  current.getText("text").update("honest");
  current.commit();
  const forgedSource = await createDocument("budget-collision");
  forgedSource.getText("text").update("forged");
  forgedSource.commit();
  const forged = decrypted(
    ids.forged,
    exportUpdatesSince(forgedSource, undefined),
  );
  // A writer's second edit served without its first: its own counters start
  // past what the reader holds, so its metadata alone voids it.
  const gapSource = await createDocument("budget-gap");
  gapSource.getText("text").update("one");
  gapSource.commit();
  const afterFirst = encodeVersionVector(gapSource);
  gapSource.getText("text").update("one two");
  gapSource.commit();
  const gap = decrypted(ids.gap, exportUpdatesSince(gapSource, afterFirst));
  const garbage = {
    id: ids.garbage,
    partialEndVersionVector: "AA==",
    partialStartVersionVector: "AA==",
    updateData: new Uint8Array([1, 2, 3]),
  };

  const verdicts = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: [forged, gap, garbage, await independent(ids.a, "kept")],
    rebuildBudgetBytes: 0,
  });

  expect(voidedIds(verdicts)).toEqual([ids.forged, ids.gap, ids.garbage]);
  expect(verdicts.deferredUpdateIds).toEqual([]);
  expect(String(verdicts.voided[1]?.error.message)).toContain(
    "depends on operations no earlier served update carries",
  );
});

test("an update this device already voided stays void without being imported", async () => {
  const current = await createDocument("budget-known");
  const known = await independent(ids.a, "would join");

  const verdicts = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: [known, await independent(ids.b, "kept")],
    knownVoids: new Set([ids.a]),
    rebuildBudgetBytes: 0,
  });

  expect(voidedIds(verdicts)).toEqual([ids.a]);
  expect(verdicts.voided[0]?.stage).toBe("loro_import");
  expect(verdicts.deferredUpdateIds).toEqual([]);
});

test("known voids after a deferral are still voided, so the next pass is served only unjudged updates", async () => {
  const current = await createDocument("budget-known-after-deferral");

  const verdicts = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: [
      await pendingOnAnotherPeer(ids.pending),
      await independent(ids.b, "deferred"),
      await independent(ids.c, "known"),
    ],
    knownVoids: new Set([ids.c]),
    rebuildBudgetBytes: 0,
  });

  expect(voidedIds(verdicts)).toEqual([ids.pending, ids.c]);
  expect(verdicts.deferredUpdateIds).toEqual([ids.b]);
});
