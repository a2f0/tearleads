import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createDomainScope } from "../../../data/shared/domainScope";
import { hydrateStoredContainerState } from "../storedContainerState";
import {
  type ContainerMetadataWriter,
  createContainerMetadataDocument,
  createInitializedContainerMetadataDocument,
  createWriterContainerMetadataDocument,
} from "./containerMetadataDocument";
import { createContainerRecord } from "./metadata.testFixtures";

function writer(
  userId: string,
  state: ContainerMetadataWriter["state"] = {
    domainScope: createDomainScope(),
  },
): ContainerMetadataWriter {
  return { auth: { userId }, state };
}

async function peerOf(
  containerId: string,
  metadataWriter: ContainerMetadataWriter,
): Promise<string> {
  const doc = await createWriterContainerMetadataDocument(
    containerId,
    metadataWriter,
  );
  try {
    return doc.peerIdStr;
  } finally {
    doc.free();
  }
}

test("a writer keeps one peer per container, apart from its other containers, users, and panes", async () => {
  const alice = writer("alice");
  const first = await peerOf("folder-1", alice);

  // Loading the container again in the same runtime keeps its peer.
  expect(await peerOf("folder-1", alice)).toBe(first);
  // Another container, or another identity on this runtime, never shares it.
  expect(await peerOf("folder-2", alice)).not.toBe(first);
  expect(await peerOf("folder-1", writer("bob", alice.state))).not.toBe(first);
  // Neither does another pane or runtime of the same user.
  expect(
    await peerOf(
      "folder-1",
      writer("alice", { ...alice.state, peerScope: "pane-2" }),
    ),
  ).not.toBe(first);
  expect(await peerOf("folder-1", writer("alice"))).not.toBe(first);
});

test("hydrating a stored container writes under its writer's peer for it", async () => {
  const { close, execSql } = await createTestExecSql("metadata-writer-peers");
  const hydratedPeer = async (
    containerId: string,
    metadataWriter: ContainerMetadataWriter,
  ): Promise<string> => {
    const container = createContainerRecord({
      id: containerId,
      parentId: null,
    });
    await persistence.saveContainer(execSql, container, null);
    const storedContainer = await persistence.loadContainerMetadataState(
      execSql,
      containerId,
    );
    if (!storedContainer) throw new Error("Missing stored container");
    const hydrated = await hydrateStoredContainerState({
      execSql,
      persistence,
      storedContainer,
      writer: metadataWriter,
    });
    try {
      return hydrated.doc.peerIdStr;
    } finally {
      hydrated.doc.free();
    }
  };
  try {
    await persistence.ensureSchema(execSql);
    const alice = writer("alice");
    const first = await hydratedPeer("folder-1", alice);
    expect(first).toBe(await peerOf("folder-1", alice));
    expect(await hydratedPeer("folder-1", alice)).toBe(first);
    expect(await hydratedPeer("folder-2", alice)).not.toBe(first);
    expect(await hydratedPeer("folder-1", writer("bob", alice.state))).not.toBe(
      first,
    );
  } finally {
    await close();
  }
});

test("creates and readers write under fresh peers no other document shares", async () => {
  const peers = new Set<string>();
  for (let index = 0; index < 3; index += 1) {
    const { doc } = await createInitializedContainerMetadataDocument(
      "folder-1",
      { icon: null, name: "Folder" },
    );
    const reader = await createContainerMetadataDocument("folder-1");
    peers.add(doc.peerIdStr);
    peers.add(reader.peerIdStr);
    doc.free();
    reader.free();
  }
  expect(peers.size).toBe(6);
});
