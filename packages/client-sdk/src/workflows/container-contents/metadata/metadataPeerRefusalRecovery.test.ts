import { afterEach, beforeEach, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
  listVersionVectorSpans,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "./containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
  enqueuePendingContainerUpdate,
} from "./metadata.testFixtures";
import { containerMetadataPeerRebaser } from "./metadataPeerRebase";
import type { ContainerMetadataState } from "./metadataTypes";

const WRITER_PEER = "11";
const OTHER_PEER = "22";
const CONTAINER_ID = "container-1";

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql("metadata-peer-recovery"));
  await sqlContainerContentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

/**
 * Folder metadata two devices wrote in turn, all of it committed: the writer
 * named the folder and another device set its icon on that. The writer then
 * queues a rename. A stale recreation loses the writer's peer.
 */
async function metadataCommittedBeforeThePurge() {
  const doc = await createDocument("metadata-writer");
  doc.setPeerId(WRITER_PEER);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const other = await createDocument("metadata-other");
  importUpdates(other, [exportAllUpdates(doc)]);
  other.setPeerId(OTHER_PEER);
  writeContainerMetadataValue(other, { icon: "star" });
  importUpdates(doc, [exportAllUpdates(other)]);
  const committed = encodeVersionVector(doc);
  writeContainerMetadataValue(doc, { name: "After" });
  const container = createContainerRecord({
    id: CONTAINER_ID,
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const record = createDocumentRecord({
    documentId: "metadata-document-1",
    id: CONTAINER_ID,
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
  });
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    { ...container, name: "After" },
    record,
  );
  await enqueuePendingContainerUpdate(
    execSql,
    sqlContainerContentsPersistence,
    {
      containerId: CONTAINER_ID,
      update: exportUpdatesSince(doc, committed),
    },
  );
  // An earlier pass settled the committed content, and its settlement
  // recorded what it saw the server hold.
  const storedState =
    await sqlContainerContentsPersistence.loadContainerMetadataState(
      execSql,
      CONTAINER_ID,
    );
  if (!storedState?.record) throw new Error("expected the stored metadata");
  await sqlContainerContentsPersistence.settleAcceptedMetadataPendingUpdates(
    execSql,
    {
      committedVersions: [committed],
      containerId: CONTAINER_ID,
      expectedRecord: storedState.record,
      pendingUpdateIds: [],
    },
  );
  const metadataState: ContainerMetadataState = { container, doc, record };
  return { committed, metadataState };
}

function recovery(metadataState: ContainerMetadataState) {
  const signals = { rebased: 0 };
  const rebase = containerMetadataPeerRebaser({
    execSql,
    isCurrent: () => true,
    metadataState,
    onRebased: () => {
      signals.rebased += 1;
    },
    persistence: sqlContainerContentsPersistence,
  });
  if (!rebase) throw new Error("expected the SQL adapter to install rebases");
  return { rebase, signals };
}

async function stored() {
  const state =
    await sqlContainerContentsPersistence.loadContainerMetadataState(
      execSql,
      CONTAINER_ID,
    );
  return {
    committedVersion: state?.record?.committedVersion,
    metadataUpdates: state?.record?.metadataUpdates,
    queued: await sqlContainerContentsPersistence.listPendingUpdates(
      execSql,
      CONTAINER_ID,
    ),
  };
}

test("relays metadata a stale recreation lost under its own peer", async () => {
  const { committed, metadataState } = await metadataCommittedBeforeThePurge();
  const live = metadataState.doc;
  const before = await stored();
  const { rebase, signals } = recovery(metadataState);

  // The other device's committed icon builds on the lost name, so cutting
  // at the named frontier would cut a committed operation.
  const outcome = await rebase({
    kind: "dependency_uncommitted",
    peerFrontiers: [{ committedEndCounter: 0, peerId: WRITER_PEER }],
  });

  expect(outcome).toBe("relayed");
  expect(signals.rebased).toBe(1);
  // The live metadata, its writer peer, and its stored content stay.
  expect(metadataState.doc).toBe(live);
  expect(live.peerIdStr).toBe(WRITER_PEER);
  const after = await stored();
  expect(after.metadataUpdates).toBe(before.metadataUpdates);
  // One update sends the writer's peer again from the named frontier.
  expect(after.queued).toHaveLength(1);
  const [relay] = after.queued;
  if (!relay) throw new Error("expected the relay's update");
  expect(listVersionVectorSpans(relay)).toEqual([
    {
      endCounter: live.version().get(WRITER_PEER) ?? 0,
      peerId: WRITER_PEER,
      startCounter: 0,
    },
  ]);
  // The record still says what the device saw committed.
  expect(versionVectorsEqual(after.committedVersion, committed)).toBe(true);
  // With the other device's lost icon, which a second refusal names, a
  // server holding nothing reads the metadata once, under its own ids.
  const again = await rebase({
    kind: "dependency_uncommitted",
    peerFrontiers: [{ committedEndCounter: 0, peerId: OTHER_PEER }],
  });
  expect(again).toBe("relayed");
  const [both] = (await stored()).queued;
  const server = await createDocument("server");
  importUpdates(server, [base64ToBytes(both?.updateData ?? "")]);
  expect(encodeVersionVector(server)).toBe(encodeVersionVector(live));
  expect(readContainerMetadataValue(server, "/")).toMatchObject({
    icon: "star",
    name: "After",
  });
});

test("parks metadata on a lost peer another user owns, then rebases", async () => {
  const { committed, metadataState } = await metadataCommittedBeforeThePurge();
  const live = metadataState.doc;
  const before = await stored();
  const { rebase, signals } = recovery(metadataState);

  const parked = await rebase({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 0, peerId: WRITER_PEER }],
  });

  expect(parked).toBe("parked");
  expect(signals.rebased).toBe(0);
  expect(metadataState.doc).toBe(live);
  expect(await stored()).toEqual(before);

  // The owner's device restored the peer up to what this device holds.
  const restored = decodeVersionVector(committed).get(WRITER_PEER) ?? 0;
  const rebased = await rebase({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: restored, peerId: WRITER_PEER }],
  });

  expect(rebased).toBe("rebased");
  expect(signals.rebased).toBe(1);
  const fork = metadataState.doc;
  expect(fork).not.toBe(live);
  expect(fork.version().get(WRITER_PEER)).toBe(restored);
  expect(fork.version().get(OTHER_PEER)).toBe(live.version().get(OTHER_PEER));
  expect(readContainerMetadataValue(fork, "/")).toMatchObject({
    icon: "star",
    name: "After",
  });
});

// The stored content holds the device's own unsent writes, so it cannot say
// what is committed, and neither can a queue that starts a peer at zero.
test("parks metadata at a frontier that fell although a full history is queued", async () => {
  const { metadataState } = await metadataCommittedBeforeThePurge();
  const live = metadataState.doc;
  await enqueuePendingContainerUpdate(
    execSql,
    sqlContainerContentsPersistence,
    { containerId: CONTAINER_ID, update: exportAllUpdates(live) },
  );
  const before = await stored();
  expect(before.queued).toHaveLength(2);
  const { rebase, signals } = recovery(metadataState);

  const outcome = await rebase({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 0, peerId: WRITER_PEER }],
  });

  expect(outcome).toBe("parked");
  expect(signals.rebased).toBe(0);
  expect(metadataState.doc).toBe(live);
  expect(await stored()).toEqual(before);
});
