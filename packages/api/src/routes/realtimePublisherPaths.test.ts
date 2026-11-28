import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser } from "@tearleads/test-utils";
import { createAncestorSdkContext } from "../../test/helpers/ancestorSdkRepair";
import {
  blobAttachmentTestRuntime,
  buildBind,
  buildDetach,
  stageBlob,
} from "../../test/helpers/blobAttachmentKit";
import { createEncryptedColdDocument } from "../../test/helpers/coldSdkRematerialization";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { linkEncryptedColdDocument } from "../../test/helpers/linkEncryptedColdDocument";
import { createOwnedTree } from "../../test/helpers/ownedContainerTree";
import { registerAndAuthenticateUsers } from "../../test/helpers/principalPolicyReadFixtures";
import { addListener } from "../adapters/pubSub";
import {
  type PublishedRealtimeEvent,
  parsePublishedRealtimeEvent,
} from "../realtime/publishedRealtimeEvents";
import { routeApp } from "../routeApp";
import {
  bindBlobAttachment,
  detachBlobAttachment,
} from "../services/blobs/blobMutations";

function capturePublishedEvents() {
  const events: PublishedRealtimeEvent[] = [];
  const stop = addListener((raw) => {
    const parsed = parsePublishedRealtimeEvent(raw);
    if (parsed) events.push(parsed);
  });
  return { events, stop };
}

test("container create, share, rekey, move, delete, and document link publish verified ancestor paths", async () => {
  const tree = await createOwnedTree(1);
  const member = tree.members[0];
  if (!member) throw new Error("Expected member");
  const server = Bun.serve({
    fetch: (request) => routeApp.fetch(request),
    hostname: "127.0.0.1",
    port: 0,
  });
  const context = await createAncestorSdkContext(
    tree.owner,
    tree.organizationId,
    member,
  );
  const apiClient = new ApiClient(server.url.origin);
  apiClient.setAuthToken(tree.owner.token);

  const capture = capturePublishedEvents();
  try {
    // 1. container.create (child & grandchild)
    const parentA = await tree.createChild(tree.rootId);
    const parentB = await tree.createChild(tree.rootId);
    const child = await tree.createChild(parentA);
    const childCreateEvent = capture.events.find(
      (event) =>
        event.type === "container_mutation_created" &&
        event.containerId === child &&
        event.eventType === "container.create",
    );
    expect(childCreateEvent).toMatchObject({
      ancestorIds: [tree.rootId, parentA],
      containerId: child,
      eventType: "container.create",
      parentId: parentA,
    });

    // 2. container.grant
    capture.events.length = 0;
    await tree.share(child, member.userId);
    const grantEvent = capture.events.find(
      (event) =>
        event.type === "container_mutation_created" &&
        event.containerId === child &&
        event.eventType === "container.grant",
    );
    expect(grantEvent).toMatchObject({
      ancestorIds: [tree.rootId, parentA],
      containerId: child,
      eventType: "container.grant",
    });

    // 3. container.move (both new ancestorIds and previousAncestorIds)
    capture.events.length = 0;
    await tree.move(child, parentB);
    const moveEvent = capture.events.find(
      (event) =>
        event.type === "container_mutation_created" &&
        event.containerId === child &&
        event.eventType === "container.move",
    );
    expect(moveEvent).toMatchObject({
      ancestorIds: [tree.rootId, parentB],
      containerId: child,
      eventType: "container.move",
      parentId: parentB,
      previousAncestorIds: [tree.rootId, parentA],
      previousParentId: parentA,
    });

    // 4. document create, sync, and link
    const docFolder = await tree.createChild(parentB);
    capture.events.length = 0;
    const createdDoc = await createEncryptedColdDocument({
      containerId: docFolder,
      organizationId: tree.organizationId,
      owner: tree.owner,
    });
    const docSyncEvent = capture.events.find(
      (event) =>
        event.type === "document_update_created" &&
        event.documentId === createdDoc.documentId,
    );
    expect(docSyncEvent).toMatchObject({
      containerPaths: {
        [docFolder]: [tree.rootId, parentB, docFolder],
      },
      documentId: createdDoc.documentId,
    });

    capture.events.length = 0;
    await linkEncryptedColdDocument({
      apiClient,
      context,
      documentId: createdDoc.documentId,
      owner: tree.owner,
      targetContainerId: parentA,
    });
    const linkEvent = capture.events.find(
      (event) =>
        event.type === "document_mutation_created" &&
        event.documentId === createdDoc.documentId &&
        event.eventType === "document.link",
    );
    expect(linkEvent).toMatchObject({
      containerPaths: {
        [docFolder]: [tree.rootId, parentB, docFolder],
        [parentA]: [tree.rootId, parentA],
      },
      documentId: createdDoc.documentId,
      eventType: "document.link",
    });

    // 5. deleteContainer publishes access_changed + container_deleted with verified ancestors
    const leaf = await tree.createChild(parentB);
    capture.events.length = 0;
    const deleteResponse = await routeApp.request(`/containers/${leaf}`, {
      headers: { Authorization: `Bearer ${tree.owner.token}` },
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect(capture.events).toContainEqual({
      containerId: leaf,
      type: "access_changed",
    });
    expect(capture.events).toContainEqual(
      expect.objectContaining({
        ancestorIds: [tree.rootId, parentB],
        containerId: leaf,
        parentId: parentB,
        type: "container_deleted",
      }),
    );
  } finally {
    capture.stop();
    await server.stop(true);
    context.close();
    tree.close();
  }
}, 60_000);

test("blob bind and detach publish verified containerPaths", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const root = await bootstrapRoot(owner);
  const doc = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const staged = await stageBlob(owner, blobId);

  const published: PublishedRealtimeEvent[] = [];
  const runtime = {
    ...blobAttachmentTestRuntime,
    eventPublisher: {
      publish: async (event: PublishedRealtimeEvent) => {
        published.push(event);
      },
    },
  };
  const { binding, request: bindRequest } = await buildBind({
    blobId,
    document: doc,
    owner,
    root,
    stagedBlob: staged,
  });
  await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bindRequest,
    sessionId: "sess-1",
    userId: owner.userId,
  });
  expect(published).toContainEqual(
    expect.objectContaining({
      containerIds: [root.kekState.containerId],
      containerPaths: {
        [root.kekState.containerId]: [root.kekState.containerId],
      },
      documentId: doc.id,
      type: "document_update_created",
    }),
  );

  published.length = 0;
  const detachRequest = await buildDetach({
    binding,
    document: doc,
    owner,
    root,
  });
  await detachBlobAttachment(runtime, {
    bindingId: binding.bindingId,
    blobId,
    fingerprint: owner.fingerprint,
    request: detachRequest,
    sessionId: "sess-1",
    userId: owner.userId,
  });
  expect(published).toContainEqual(
    expect.objectContaining({
      containerIds: [root.kekState.containerId],
      containerPaths: {
        [root.kekState.containerId]: [root.kekState.containerId],
      },
      documentId: doc.id,
      type: "document_update_created",
    }),
  );
}, 60_000);
