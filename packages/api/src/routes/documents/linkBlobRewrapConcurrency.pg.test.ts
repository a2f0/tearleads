import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import { routeApp } from "../../routeApp";
import { BlobMutationError } from "../../services/blobs/blobMutations";

async function fixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const stagedBlob = await stageBlob(owner);
  const { request: bind } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
  });
  const post = (path: string, request: unknown) =>
    Promise.resolve(
      routeApp.request(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    );
  return {
    document,
    link,
    bind: async () => {
      // Use the same object-store runtime that staged the ciphertext. The link
      // route shares the real database and the document-head transaction locks.
      try {
        await bindForTest({ blobId, owner, request: bind });
        return Response.json({}, { status: 200 });
      } catch (error) {
        if (!(error instanceof BlobMutationError)) throw error;
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      }
    },
    linkDocument: () => post(`/documents/${document.id}/link`, link),
  };
}

for (const first of ["bind", "link"] as const) {
  test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
    `${first} wins the attachment/link race without exposing an unwrapped binding`,
    async () => {
      const input = await fixture();
      const lock = await holdAccessManifestHeadForUpdate({
        objectKind: "document",
        objectId: input.document.id,
      });
      let firstResponse: Promise<Response> | undefined;
      let secondResponse: Promise<Response> | undefined;
      try {
        firstResponse = first === "bind" ? input.bind() : input.linkDocument();
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          queryFragment: "access_manifest_heads",
        });
        secondResponse = first === "bind" ? input.linkDocument() : input.bind();
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          queryFragment: "access_manifest_heads",
          minimumWaiters: 2,
        });
      } finally {
        await lock.release();
      }
      if (!firstResponse || !secondResponse)
        throw new Error("Expected both concurrent requests");
      const responses = await Promise.all([firstResponse, secondResponse]);
      expect({
        status: responses[0].status,
        body: await responses[0].json(),
      }).toMatchObject({ status: 200 });
      expect({
        status: responses[1].status,
        body: await responses[1].json(),
      }).toMatchObject({ status: 409 });
      const head = await getCurrentAccessManifestHead(
        "document",
        input.document.id,
        db,
      );
      expect(head?.manifestHash).toBe(
        first === "link"
          ? input.link.expectedManifestHash
          : input.document.accessManifest.manifestHash,
      );
      const bindings = await db
        .select()
        .from(attachmentBindings)
        .where(eq(attachmentBindings.documentId, input.document.id));
      expect(bindings).toHaveLength(first === "bind" ? 1 : 0);
    },
    30_000,
  );
}
