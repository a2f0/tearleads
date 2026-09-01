import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";

test("detached metadata state does not mutate its live source before install", async () => {
  const container = createContainerRecord({
    id: "metadata-isolation-container",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, { icon: null, name: "Live name" });
  const live = {
    container,
    doc,
    record: createDocumentRecord({ id: container.id }),
    rekeyOnlyPassCount: 2,
  };

  const candidate = await createDetachedContainerMetadataState(live);
  const candidateDoc = candidate.doc;
  candidate.container = { ...candidate.container, name: "Candidate name" };
  candidate.record = { ...candidate.record, lastCommitLsn: "0/2" };
  candidate.rekeyOnlyPassCount = 3;
  writeContainerMetadataValue(candidate.doc, {
    icon: "archive",
    name: "Candidate name",
  });

  expect(live.container.name).not.toBe("Candidate name");
  expect(live.record.lastCommitLsn).not.toBe("0/2");
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: null,
    name: "Live name",
  });

  installDetachedContainerMetadataState(live, candidate);
  expect(live.container.name).toBe("Candidate name");
  expect(live.record.lastCommitLsn).toBe("0/2");
  expect(live.rekeyOnlyPassCount).toBe(3);
  expect(live.doc).toBe(candidateDoc);
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Candidate name",
  });
});

test("detached settlement preserves a completed concurrent metadata edit", async () => {
  const container = createContainerRecord({
    id: "metadata-concurrent-edit-container",
    parentId: "local-parent",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const live = {
    container,
    doc,
    record: createDocumentRecord({ id: container.id }),
  };
  const candidate = await createDetachedContainerMetadataState(live);
  const liveDoc = live.doc;
  candidate.container = {
    ...candidate.container,
    parentId: "remote-parent",
  };
  const candidateRecord = {
    ...candidate.record,
    accessStateHash: "remote-access-state",
    documentId: "remote-metadata-document",
  };

  writeContainerMetadataValue(live.doc, {
    icon: "archive",
    name: "Concurrent rename",
  });
  live.container = {
    ...candidate.container,
    icon: "archive",
    name: "Concurrent rename",
  };
  const completedEditRecord = {
    ...candidateRecord,
    lastCommitLsn: "0/3",
  };
  live.record = completedEditRecord;

  installDetachedContainerMetadataState(live, candidate, {
    candidateRecord,
    preserveConcurrentMetadataEdit: true,
  });

  expect(live.container).toMatchObject({
    icon: "archive",
    name: "Concurrent rename",
    parentId: "remote-parent",
  });
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Concurrent rename",
  });
  expect(live.record).toBe(completedEditRecord);
  expect(live.doc).toBe(liveDoc);
});

test("detached settlement merges remote metadata with a queued local edit", async () => {
  const container = createContainerRecord({
    id: "metadata-queued-edit-container",
    parentId: "local-parent",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const sourceRecord = createDocumentRecord({ id: container.id });
  const live = { container, doc, record: sourceRecord };
  const candidate = await createDetachedContainerMetadataState(live);
  const liveDoc = live.doc;
  candidate.container = {
    ...candidate.container,
    parentId: "remote-parent",
  };
  candidate.doc.getMap("container").set("icon", "remote-icon");

  // The queued edit has mutated the live Loro document, but its serialized
  // write is still waiting behind this sync pass so the record is unchanged.
  live.doc.getMap("container").set("name", "Queued rename");

  installDetachedContainerMetadataState(live, candidate, {
    preserveConcurrentMetadataEdit: true,
  });

  expect(live.container).toMatchObject({
    icon: "remote-icon",
    name: "Queued rename",
    parentId: "remote-parent",
  });
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "remote-icon",
    name: "Queued rename",
  });
  expect(live.doc).toBe(liveDoc);
  expect(live.record).toBe(sourceRecord);
});

test("a concurrent edit cannot restore the detached state's old remote identity", async () => {
  const container = createContainerRecord({
    id: "metadata-identity-rotation-container",
    parentId: "local-parent",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const sourceRecord = createDocumentRecord({
    accessEpoch: 1,
    accessStateHash: "old-access-state",
    documentId: "old-metadata-document",
    id: container.id,
    metadataUpdates: "old-durable-history",
    pendingBaseVersion: "old-pending-base",
    snapshotEndVersion: "old-snapshot-end",
  });
  const live = {
    container,
    doc,
    pullContinuation: {
      commitLsn: "0/1",
      commitLsnMode: "tracked" as const,
      cursor: "old-page",
    },
    record: sourceRecord,
  };
  const candidate = await createDetachedContainerMetadataState(live);
  const candidateRecord = createDocumentRecord({
    accessEpoch: 2,
    accessStateHash: "new-access-state",
    contentKeyBundle: "new-content-key-bundle",
    documentId: "new-metadata-document",
    documentKekTargets: "new-kek-targets",
    documentManifestBundle: "new-manifest",
    id: container.id,
    lastCommitLsn: "0/2",
    metadataUpdates: "new-identity-history",
    pullContinuation: {
      commitLsn: "0/2",
      commitLsnMode: "tracked",
      cursor: "new-page",
    },
  });

  writeContainerMetadataValue(live.doc, {
    icon: "archive",
    name: "Concurrent rename",
  });
  live.record = {
    ...sourceRecord,
    metadataUpdates: "concurrent-durable-history",
    pendingBaseVersion: "concurrent-pending-base",
    snapshotEndVersion: "concurrent-snapshot-end",
  };

  installDetachedContainerMetadataState(live, candidate, {
    candidateRecord,
    preserveConcurrentMetadataEdit: true,
  });

  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Concurrent rename",
  });
  expect(live.record).toEqual({
    ...candidateRecord,
    metadataUpdates: "concurrent-durable-history",
    pendingBaseVersion: "concurrent-pending-base",
    snapshotEndVersion: "concurrent-snapshot-end",
  });
  expect(live.pullContinuation).toEqual({
    commitLsn: "0/2",
    commitLsnMode: "tracked",
    cursor: "new-page",
  });
});
