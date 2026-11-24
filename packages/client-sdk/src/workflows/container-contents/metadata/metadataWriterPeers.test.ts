import { expect, test } from "bun:test";
import {
  exportAllUpdates,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
  listVersionVectorSpans,
} from "@tearleads/loro";
import { createDomainScope } from "../../../data/shared/domainScope";
import {
  createWriterContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "./containerMetadataDocument";
import { renameContainerMetadataStateFromRuntime } from "./index";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  createDocumentRecord,
  metadataTestExecSql as execSql,
} from "./metadata.testFixtures";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";

async function liveState() {
  const container = createContainerRecord({ id: "folder-1", parentId: null });
  const writer = {
    auth: { userId: "alice" },
    state: { domainScope: createDomainScope() },
  };
  const doc = await createWriterContainerMetadataDocument(container.id, writer);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  return {
    container,
    doc,
    record: createDocumentRecord({ id: container.id }),
    writer,
    writerPeer: doc.peerIdStr,
  };
}

/** Every op id the document holds, as `peer:counter`. */
function opIds(doc: Awaited<ReturnType<typeof liveState>>["doc"]): string[] {
  return [...doc.version().toJSON()].flatMap(([peer, end]) =>
    Array.from({ length: end }, (_, counter) => `${peer}:${counter}`),
  );
}

test("serial edits keep writing the container under its writer's peer", async () => {
  const live = await liveState();
  for (const name of ["First", "Second"]) {
    const copy = await createDetachedContainerMetadataState(live);
    writeContainerMetadataValue(copy.doc, { name });
    expect(copy.doc.peerIdStr).toBe(live.writerPeer);
    installDetachedContainerMetadataState(live, copy);
  }
  expect(live.doc.peerIdStr).toBe(live.writerPeer);
  expect([...live.doc.version().toJSON().keys()]).toEqual([live.writerPeer]);
  expect(readContainerMetadataValue(live.doc, "fallback").name).toBe("Second");
});

test("a copy that never wrote leaves the live writer's peer in place", async () => {
  const live = await liveState();
  const pass = await createDetachedContainerMetadataState(live);
  installDetachedContainerMetadataState(live, pass);
  expect(live.doc.peerIdStr).toBe(live.writerPeer);
});

test("overlapping copies never write one peer's counters twice", async () => {
  const live = await liveState();
  const rename = await createDetachedContainerMetadataState(live);
  const icon = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(rename.doc, { name: "Renamed" });
  writeContainerMetadataValue(icon.doc, { icon: "archive" });
  expect(rename.doc.peerIdStr).toBe(live.writerPeer);
  expect(icon.doc.peerIdStr).not.toBe(live.writerPeer);

  const renameOps = opIds(rename.doc).length;
  installDetachedContainerMetadataState(live, rename);
  installDetachedContainerMetadataState(live, icon, {
    preserveConcurrentMetadataEdit: true,
  });
  // Both edits survive the merge: no op id was written twice.
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Renamed",
  });
  const ids = opIds(live.doc);
  expect(new Set(ids).size).toBe(ids.length);
  // The rename's history plus the icon copy's one op.
  expect(ids).toHaveLength(renameOps + 1);
});

test("the live document writes under a fresh peer while a copy holds its peer", async () => {
  const live = await liveState();
  const copy = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(copy.doc, { name: "From copy" });
  writeContainerMetadataValue(live.doc, { icon: "archive" });
  expect(live.doc.peerIdStr).not.toBe(live.writerPeer);

  installDetachedContainerMetadataState(live, copy, {
    preserveConcurrentMetadataEdit: true,
  });
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "From copy",
  });
});

test("a document reloaded under the peer a copy holds never writes that peer", async () => {
  const live = await liveState();
  const rename = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(rename.doc, { name: "Renamed" });
  expect(rename.doc.peerIdStr).toBe(live.writerPeer);

  // A refresh swaps in the stored document, under the same writer peer,
  // while the rename's copy is still out.
  const reloaded = await createWriterContainerMetadataDocument(
    live.container.id,
    live.writer,
  );
  importSnapshot(reloaded, exportFullHistorySnapshot(live.doc));
  expect(reloaded.peerIdStr).toBe(live.writerPeer);
  live.doc = reloaded;
  const icon = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(icon.doc, { icon: "archive" });
  expect(icon.doc.peerIdStr).not.toBe(live.writerPeer);
  writeContainerMetadataValue(live.doc, { primaryDocumentId: "doc-1" });
  expect(live.doc.peerIdStr).not.toBe(live.writerPeer);

  installDetachedContainerMetadataState(live, icon, {
    preserveConcurrentMetadataEdit: true,
  });
  installDetachedContainerMetadataState(live, rename, {
    preserveConcurrentMetadataEdit: true,
  });
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Renamed",
    primaryDocumentId: "doc-1",
  });
});

test("a document behind the peer's holder never reuses its counters", async () => {
  const live = await liveState();
  // A stale load of the stored document, before the live document's last edit.
  const stale = await createWriterContainerMetadataDocument(
    live.container.id,
    live.writer,
  );
  importSnapshot(stale, exportFullHistorySnapshot(live.doc));
  writeContainerMetadataValue(live.doc, { name: "Live" });
  writeContainerMetadataValue(stale, { icon: "archive" });
  expect(stale.peerIdStr).not.toBe(live.writerPeer);

  importUpdates(live.doc, [exportAllUpdates(stale)]);
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Live",
  });
});

test("a document behind the peer's end never writes it after the holder is freed", async () => {
  const live = await liveState();
  const stale = await createWriterContainerMetadataDocument(
    live.container.id,
    live.writer,
  );
  importSnapshot(stale, exportFullHistorySnapshot(live.doc));
  writeContainerMetadataValue(live.doc, { name: "Live" });
  live.doc.free();
  writeContainerMetadataValue(stale, { icon: "archive" });
  expect(stale.peerIdStr).not.toBe(live.writerPeer);
});

test("a copy dropped after borrowing the peer keeps it from everyone else", async () => {
  const live = await liveState();
  let dropped: Awaited<
    ReturnType<typeof createDetachedContainerMetadataState>
  > | null = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(dropped.doc, { name: "Queued, never installed" });
  expect(dropped.doc.peerIdStr).toBe(live.writerPeer);
  dropped = null;
  Bun.gc(true);

  const next = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(next.doc, { name: "Next" });
  expect(next.doc.peerIdStr).not.toBe(live.writerPeer);
  writeContainerMetadataValue(live.doc, { icon: "archive" });
  expect(live.doc.peerIdStr).not.toBe(live.writerPeer);
});

test("a borrower installed after the live document moved off the peer lends it on", async () => {
  const live = await liveState();
  const rename = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(rename.doc, { name: "Renamed" });
  writeContainerMetadataValue(live.doc, { icon: "archive" });
  expect(live.doc.peerIdStr).not.toBe(live.writerPeer);
  // A rename installs its copy outright.
  installDetachedContainerMetadataState(live, rename);
  expect(live.doc.peerIdStr).toBe(live.writerPeer);

  const next = await createDetachedContainerMetadataState(live);
  writeContainerMetadataValue(next.doc, { name: "Next" });
  expect(next.doc.peerIdStr).toBe(live.writerPeer);
});

test("renames queue their operations under the container's writer peer", async () => {
  const live = await liveState();
  const pendingUpdates: Parameters<
    typeof createContainerContentsPersistence
  >[0]["pendingUpdates"] = [];
  const persistence = createContainerContentsPersistence({
    pendingUpdates,
    savedContainers: [],
    storedContainers: [{ container: live.container, record: live.record }],
  });
  for (const name of ["First", "Second"]) {
    // As the store's rename operation does: edit a copy, then install it.
    const copy = await createDetachedContainerMetadataState(live);
    const renamed = await renameContainerMetadataStateFromRuntime({
      metadataState: copy,
      name,
      persistence,
      runtime: { infra: { execSql } },
    });
    if (!renamed) throw new Error("Rename was not persisted");
    copy.container = renamed.container;
    installDetachedContainerMetadataState(live, copy);
  }
  const peers = (pendingUpdates ?? []).flatMap(({ input }) =>
    listVersionVectorSpans(input).map((span) => span.peerId),
  );
  expect(peers).toEqual([live.writerPeer, live.writerPeer]);
});
