import { afterEach, beforeEach, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
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
const CONTAINER_ID = "container-1";

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql("metadata-peer-rebase"));
  await sqlContainerContentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

/** Metadata whose writer peer committed "Before" and queued "After". */
async function refusedMetadata() {
  const doc = await createDocument("metadata-writer");
  doc.setPeerId(WRITER_PEER);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const committedVersion = encodeVersionVector(doc);
  const committed = decodeVersionVector(committedVersion).get(WRITER_PEER) ?? 0;
  const committedUpdates = exportAllUpdates(doc);
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
      update: exportUpdatesSince(doc, committedVersion),
    },
  );
  const metadataState: ContainerMetadataState = { container, doc, record };
  return { committed, committedUpdates, metadataState };
}

function rebaserFor(metadataState: ContainerMetadataState) {
  const rebase = containerMetadataPeerRebaser({
    execSql,
    isCurrent: () => true,
    metadataState,
    onRebased: () => undefined,
    persistence: sqlContainerContentsPersistence,
  });
  if (!rebase) throw new Error("expected the SQL adapter to install rebases");
  return rebase;
}

test("moves refused metadata edits onto a fresh memory-only peer", async () => {
  const { committed, metadataState } = await refusedMetadata();
  const live = metadataState.doc;
  let rebasedSignals = 0;
  const rebase = containerMetadataPeerRebaser({
    execSql,
    isCurrent: () => true,
    metadataState,
    onRebased: () => {
      rebasedSignals += 1;
    },
    persistence: sqlContainerContentsPersistence,
  });
  if (!rebase) throw new Error("expected the SQL adapter to install rebases");

  const outcome = await rebase({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: committed, peerId: WRITER_PEER }],
  });

  expect(outcome).toBe("rebased");
  expect(rebasedSignals).toBe(1);
  const fork = metadataState.doc;
  expect(fork).not.toBe(live);
  expect(fork.peerIdStr).not.toBe(WRITER_PEER);
  expect(readContainerMetadataValue(fork, "/").name).toBe("After");
  expect(fork.version().get(WRITER_PEER)).toBe(committed);

  // The stored content is the fork's, and one update replaces the queue.
  const stored =
    await sqlContainerContentsPersistence.loadContainerMetadataState(
      execSql,
      CONTAINER_ID,
    );
  const storedDoc = await createDocument("stored-metadata");
  importUpdates(storedDoc, [
    base64ToBytes(stored?.record?.metadataUpdates ?? ""),
  ]);
  expect(storedDoc.version().get(WRITER_PEER)).toBe(committed);
  expect(readContainerMetadataValue(storedDoc, "/").name).toBe("After");
  const queued = await sqlContainerContentsPersistence.listPendingUpdates(
    execSql,
    CONTAINER_ID,
  );
  expect(queued).toHaveLength(1);
  const sent = decodeVersionVector(queued[0]?.partialEndVersionVector ?? "");
  expect(sent.get(WRITER_PEER) ?? 0).toBeLessThanOrEqual(committed);

  // The next write stays on the fork's own peer.
  const peer = fork.peerIdStr;
  writeContainerMetadataValue(fork, { name: "Later" });
  expect(fork.peerIdStr).toBe(peer);
});

test("leaves the metadata alone when the server committed every edit", async () => {
  const { metadataState } = await refusedMetadata();
  const live = metadataState.doc;
  let rebasedSignals = 0;
  const rebase = containerMetadataPeerRebaser({
    execSql,
    isCurrent: () => true,
    metadataState,
    onRebased: () => {
      rebasedSignals += 1;
    },
    persistence: sqlContainerContentsPersistence,
  });

  const outcome = await rebase?.({
    kind: "peer_owned",
    peerFrontiers: [
      {
        committedEndCounter: live.version().get(WRITER_PEER) ?? 0,
        peerId: WRITER_PEER,
      },
    ],
  });

  expect(outcome).toBe("nothing_to_cut");
  expect(metadataState.doc).toBe(live);
  expect(rebasedSignals).toBe(0);
});

test("carries a metadata edit another runtime queued that the live state lacks", async () => {
  const { committed, committedUpdates, metadataState } =
    await refusedMetadata();
  // Another tab on this database sets the icon on its own peer.
  const otherTab = await createDocument("other-tab");
  importUpdates(otherTab, [exportAllUpdates(metadataState.doc)]);
  otherTab.setPeerId("22");
  const before = encodeVersionVector(otherTab);
  writeContainerMetadataValue(otherTab, { icon: "star" });
  await enqueuePendingContainerUpdate(
    execSql,
    sqlContainerContentsPersistence,
    {
      containerId: CONTAINER_ID,
      update: exportUpdatesSince(otherTab, before),
    },
  );

  const outcome = await rebaserFor(metadataState)({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: committed, peerId: WRITER_PEER }],
  });

  expect(outcome).toBe("rebased");
  const fork = metadataState.doc;
  expect(readContainerMetadataValue(fork, "/")).toMatchObject({
    icon: "star",
    name: "After",
  });
  // The other tab's edit depends on the cut one, so the fork writes it again
  // under the fresh peer too.
  expect(fork.version().get("22")).toBeUndefined();

  // The one queued update brings the server's state to the fork's.
  const [queued] = await sqlContainerContentsPersistence.listPendingUpdates(
    execSql,
    CONTAINER_ID,
  );
  const server = await createDocument("server");
  importUpdates(server, [
    committedUpdates,
    base64ToBytes(queued?.updateData ?? ""),
  ]);
  expect(readContainerMetadataValue(server, "/")).toMatchObject({
    icon: "star",
    name: "After",
  });
});
