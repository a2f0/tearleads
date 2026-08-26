import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobs,
  documents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import { buildDocumentPurgeRequest } from "../../../../test/helpers/documentPurge";
import {
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { lockRowForUpdate } from "../../../utils/sqlDialect";
import { runPurgeDocumentWorkflow } from "./purgeDocument";

const INTERLEAVING_WAIT_MS = 300;

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function createPurgeBindRaceFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const sourceDocument = await createDocument({ owner, root });
  const destinationDocument = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const initialBind = await buildBind({
    blobId,
    document: sourceDocument,
    owner,
    root,
    slotId: "purge-race-source",
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({
    blobId,
    owner,
    request: initialBind.request,
  });
  const racingBind = await buildBind({
    activeBindings: [initialBind.binding],
    blobId,
    document: destinationDocument,
    documents: [sourceDocument, destinationDocument],
    owner,
    root,
    slotId: "purge-race-destination",
  });
  return {
    blobId,
    destinationDocument,
    owner,
    purgeRequest: await buildDocumentPurgeRequest({
      documentId: sourceDocument.id,
      documentManifestHash: sourceDocument.accessManifest.manifestHash,
      owner,
      root,
    }),
    racingBind,
    sourceDocument,
  };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a bind that reaches blob mutation first survives document purge",
  async () => {
    const fixture = await createPurgeBindRaceFixture();
    const epochHeld = deferred();
    const releaseEpoch = deferred();
    const epochHolder = db.transaction(async (tx) => {
      const query = tx
        .select({ id: blobContentKeyEpochs.id })
        .from(blobContentKeyEpochs)
        .where(eq(blobContentKeyEpochs.blobId, fixture.blobId));
      await lockRowForUpdate(query);
      epochHeld.resolve();
      await releaseEpoch.promise;
    });
    await epochHeld.promise;

    let bindSettled = false;
    const bind = bindForTest({
      blobId: fixture.blobId,
      owner: fixture.owner,
      request: fixture.racingBind.request,
    }).then(() => {
      bindSettled = true;
    });
    let purgeSettled = false;
    let purge: ReturnType<typeof runPurgeDocumentWorkflow> | undefined;
    try {
      await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
      expect(bindSettled).toBe(false);
      const activePurge = runPurgeDocumentWorkflow(db, {
        documentId: fixture.sourceDocument.id,
        fingerprint: fixture.owner.fingerprint,
        request: fixture.purgeRequest,
        userId: fixture.owner.userId,
      }).then((result) => {
        purgeSettled = true;
        return result;
      });
      purge = activePurge;
      await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
      expect(purgeSettled).toBe(false);

      releaseEpoch.resolve();
      const [, , purgeResult] = await Promise.all([
        epochHolder,
        bind,
        activePurge,
      ]);
      expect(purgeResult.response.documentId).toBe(fixture.sourceDocument.id);
      const destinationBindings = await db
        .select({ id: attachmentBindings.id })
        .from(attachmentBindings)
        .where(
          and(
            eq(attachmentBindings.documentId, fixture.destinationDocument.id),
            isNull(attachmentBindings.detachedAt),
          ),
        );
      expect(destinationBindings).toEqual([
        { id: fixture.racingBind.binding.bindingId },
      ]);
      const [blob] = await db
        .select({ dereferencedAt: blobs.dereferencedAt })
        .from(blobs)
        .where(eq(blobs.id, fixture.blobId));
      expect(blob?.dereferencedAt).toBeNull();
    } finally {
      releaseEpoch.resolve();
      await Promise.all([
        epochHolder.catch(() => undefined),
        bind.catch(() => undefined),
        purge?.catch(() => undefined),
      ]);
    }
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a purge that reaches blob mutation first rejects a stale bind",
  async () => {
    const fixture = await createPurgeBindRaceFixture();
    const documentHeld = deferred();
    const releaseDocument = deferred();
    const documentHolder = db.transaction(async (tx) => {
      const query = tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, fixture.sourceDocument.id));
      await lockRowForUpdate(query);
      documentHeld.resolve();
      await releaseDocument.promise;
    });
    await documentHeld.promise;

    let purgeSettled = false;
    const purge = runPurgeDocumentWorkflow(db, {
      documentId: fixture.sourceDocument.id,
      fingerprint: fixture.owner.fingerprint,
      request: fixture.purgeRequest,
      userId: fixture.owner.userId,
    }).then((result) => {
      purgeSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
    expect(purgeSettled).toBe(false);

    let bindSettled = false;
    const bind = bindForTest({
      blobId: fixture.blobId,
      owner: fixture.owner,
      request: fixture.racingBind.request,
    }).then(
      () => {
        bindSettled = true;
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        bindSettled = true;
        return { error, kind: "rejected" as const };
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
      expect(bindSettled).toBe(false);

      releaseDocument.resolve();
      const [, purgeResult, bindResult] = await Promise.all([
        documentHolder,
        purge,
        bind,
      ]);
      expect(purgeResult.response.documentId).toBe(fixture.sourceDocument.id);
      expect(bindResult).toMatchObject({
        error: { status: 409 },
        kind: "rejected",
      });
      const destinationBindings = await db
        .select({ id: attachmentBindings.id })
        .from(attachmentBindings)
        .where(
          eq(attachmentBindings.documentId, fixture.destinationDocument.id),
        );
      expect(destinationBindings).toEqual([]);
      const [blob] = await db
        .select({ dereferencedAt: blobs.dereferencedAt })
        .from(blobs)
        .where(eq(blobs.id, fixture.blobId));
      expect(blob?.dereferencedAt).toBeInstanceOf(Date);
    } finally {
      releaseDocument.resolve();
      await Promise.all([
        documentHolder.catch(() => undefined),
        purge.catch(() => undefined),
        bind.catch(() => undefined),
      ]);
    }
  },
  30_000,
);
