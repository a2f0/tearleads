import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import { bindBlobAttachment } from "./blobMutations";

async function rekeyedBindFixture(staleSeed: boolean) {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const nextRoot = {
    bundle: rekey.bundle,
    kekState: rekey.kekState,
    principalPolicies: root.principalPolicies,
  };
  const nextTargets = await createDocumentRequest({
    documentId: document.id,
    owner,
    root: nextRoot,
  });
  const { request: sync, updateId } = await createSignedDocumentSyncRequest({
    created: document,
    owner,
    root: staleSeed ? root : nextRoot,
    includeContentKeyBundle: true,
    checkpoint: true,
    contentKeyBundle: {
      ...nextTargets.contentKeyBundle,
      documentId: document.id,
      contentKeyEpoch: document.contentKeyEpoch + 1,
      linkSetManifestHash: document.manifestHash,
    },
  });
  const [update] = sync.outgoingUpdates;
  invariant(update, "expected a first update");
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root: nextRoot,
    stagedBlob: await stageBlob(owner, blobId),
  });
  return {
    blobId,
    document,
    owner,
    rekey,
    root,
    updateId,
    request: {
      ...request,
      containerRekeys: [rekey.request],
      documentSync: {
        ...sync,
        localVersionVector: update.partialEndVersionVector,
      },
    },
  };
}

test.each([false, true])(
  "carried bind sync uses post-rekey heads (stale seed: %s)",
  async (staleSeed) => {
    const fixture = await rekeyedBindFixture(staleSeed);
    let failure: unknown;
    const response = await bindBlobAttachment(blobAttachmentTestRuntime, {
      blobId: fixture.blobId,
      fingerprint: fixture.owner.fingerprint,
      request: fixture.request,
      sessionId: "locked-head-bind-rekey",
      userId: fixture.owner.userId,
    }).catch((error: unknown) => {
      failure = error;
    });
    const rootHead = await getCurrentAccessManifestHead(
      "container",
      fixture.root.kekState.containerId,
      db,
    );
    const bindings = await db
      .select({ blobId: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.documentId, fixture.document.id));
    const updates = await db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, fixture.document.id));
    if (staleSeed) {
      expect(failure).toMatchObject({
        status: 409,
        message: "authorizingContainerPathRefs[0][0] is stale",
      });
      expect(response).toBeUndefined();
      expect(rootHead?.manifestHash).toBe(fixture.root.bundle.manifestHash);
      expect(bindings).toEqual([]);
      expect(updates).toEqual([]);
    } else {
      expect(failure).toBeUndefined();
      expect(response?.documentSync?.acceptedOutgoingUpdateIds).toEqual([
        fixture.updateId,
      ]);
      expect(rootHead?.manifestHash).toBe(fixture.rekey.bundle.manifestHash);
      expect(bindings).toEqual([{ blobId: fixture.blobId }]);
      expect(updates).toEqual([{ id: fixture.updateId }]);
    }
  },
);
