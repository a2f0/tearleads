import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  attachmentBindings,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { insertDocumentUpdateSpans } from "../../documents/documentUpdateSpans";
import { bindBlobAttachment } from "./blobMutations";

/** An edit from a device the uploader has never pulled from. */
async function otherDeviceUpdate(documentId: string) {
  const document = await createLoroDocument(`other-device-${documentId}`);
  const start = encodeVersionVector(document);
  document.getText("text").update("removed the avatar");
  return {
    accessEpoch: 1,
    authorFingerprint: "other-device",
    byteLength: 1,
    documentId,
    encryptedData: "encrypted-other-device-update",
    id: crypto.randomUUID(),
    plaintextHash: "plaintext-other-device-update",
    ...getUpdateVersionVectors(exportUpdatesSince(document, start)),
  };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a bind queued behind an edit's document head lock sees that edit",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const document = await createDocument({ owner, root });
    const blobId = crypto.randomUUID();
    const { request } = await buildBind({
      blobId,
      document,
      owner,
      root,
      stagedBlob: await stageBlob(owner, blobId),
    });
    const update = await otherDeviceUpdate(document.id);
    // A sync writer locks the document head, then inserts its update; the
    // edit stays invisible until that transaction commits.
    const edit = await holdPostgresLock(async (tx) => {
      await tx
        .select({ id: accessManifestHeads.id })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "document"),
            eq(accessManifestHeads.objectId, document.id),
          ),
        )
        .for("update");
      await tx.insert(documentUpdates).values(update);
      await insertDocumentUpdateSpans(tx, {
        documentId: document.id,
        updates: [update],
      });
    });
    const bound = bindBlobAttachment(blobAttachmentTestRuntime, {
      blobId,
      fingerprint: owner.fingerprint,
      request,
      sessionId: "bind-document-version-race",
      userId: owner.userId,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await waitForPostgresLockWait({
        blockerPid: edit.backendPid,
        queryFragment: "access_manifest_heads",
      });
    } finally {
      await edit.release();
    }

    expect(await bound).toMatchObject({
      code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
      status: 409,
    });
    expect(
      await db
        .select({ id: attachmentBindings.id })
        .from(attachmentBindings)
        .where(eq(attachmentBindings.documentId, document.id)),
    ).toEqual([]);
  },
  30_000,
);
