import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { readKeyingCanonicalJson } from "../../utils/canonicalJson";

test("a warm client moves an uploaded attachment on its first attempt", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({ blobId, owner, request });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => routeApp.fetch(request),
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(owner.token);
  try {
    const original = (await client.listDocumentAttachments(document.id))?.[0];
    const sourceTarget = original?.contentKeyBundle.targets[0];
    if (!original || !sourceTarget)
      throw new Error("Expected uploaded attachment");
    const target = {
      ...sourceTarget,
      wrappingMetadata: readKeyingCanonicalJson(
        sourceTarget.wrappingMetadata,
        "source wrap",
      ),
    };
    const childKek = kekStateFromContainerResponse(child);
    const destinationTarget = {
      ...target,
      containerId: child.containerId,
      containerManifestHash: childKek.accessManifestHash,
      containerKeyEpochId: childKek.containerKeyEpochId,
      containerKeyEpoch: childKek.containerKeyEpoch,
      wrappedKey: "first-destination-wrap",
    };
    const linked = await client.linkDocumentResult(
      document.id,
      await buildDocumentLinkRequest({
        child,
        createdDocument: document,
        owner,
        root,
        blobRewraps: [
          { blobId, contentKeyEpoch: 1, targets: [target, destinationTarget] },
        ],
      }),
    );
    if (!linked.ok) throw new Error(linked.message);

    const afterLink = (await client.listDocumentAttachments(document.id))?.[0];
    // The SDK retains the destination envelope when present. A stale pre-link
    // list makes it wrap the same key again with fresh randomness instead.
    const retained = afterLink?.contentKeyBundle.targets.find(
      (envelope) => envelope.containerId === child.containerId,
    );
    const remainingTarget = retained
      ? {
          ...retained,
          wrappingMetadata: readKeyingCanonicalJson(
            retained.wrappingMetadata,
            "retained wrap",
          ),
        }
      : { ...destinationTarget, wrappedKey: "regenerated-destination-wrap" };
    const moved = await client.unlinkDocumentResult(
      document.id,
      await buildDocumentUnlinkRequest({
        child,
        linkedDocument: linked.data,
        owner,
        root,
        unlinkedContainer: root,
        unlinkedContainerPath: [root.bundle],
        remainingContainer: {
          ...root,
          bundle: child.accessManifest,
          kekState: childKek,
        },
        remainingContainerPath: [root.bundle, child.accessManifest],
        blobRewraps: [
          { blobId, contentKeyEpoch: 1, targets: [remainingTarget] },
        ],
      }),
    );
    expect(moved).toMatchObject({ ok: true });
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.data.accessManifest.state).toMatchObject({
      linkedContainerIds: [child.containerId],
    });
    const afterMove = (await client.listDocumentAttachments(document.id))?.[0];
    expect(afterMove?.contentKeyBundle.targets).toEqual([
      { ...destinationTarget, wrappingMetadata: sourceTarget.wrappingMetadata },
    ]);
    expect(afterMove?.blobKekTargets.documentManifestHashes).toEqual([
      moved.data.accessManifest.manifestHash,
    ]);
    const projection = await client.getDocumentWriterProjection(document.id);
    expect(projection?.documentManifest.manifestHash).toBe(
      moved.data.accessManifest.manifestHash,
    );
    expect(projection?.contentKeyBundleStale).toBeUndefined();
  } finally {
    await server.stop(true);
  }
}, 20_000);
