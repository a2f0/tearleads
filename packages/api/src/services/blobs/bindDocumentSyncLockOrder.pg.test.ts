import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import {
  createFirstUpdateSyncRequest,
  createSignedDocumentSyncRequest,
} from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { BlobMutationError } from "./blobMutations";

const isPostgres = getDefaultApiDatabaseKind() === "postgres";

async function documentWithRoot() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  return { document: await createDocument({ owner, root }), owner, root };
}

/** A staged bind that carries the document's first update. */
async function bindWithDocumentSync(input: {
  readonly document: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
  readonly slotId: string;
}) {
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document: input.document,
    owner: input.owner,
    root: input.root,
    slotId: input.slotId,
    stagedBlob: await stageBlob(input.owner, blobId),
  });
  const sync = await createFirstUpdateSyncRequest(input);
  return {
    blobId,
    run: () =>
      bindForTest({
        blobId,
        owner: input.owner,
        request: { ...request, documentSync: sync.request },
      }).then(
        () => 200,
        (error: unknown) => {
          if (error instanceof BlobMutationError) return error.status;
          throw error;
        },
      ),
    updateId: sync.id,
  };
}

function post(owner: TestUser, path: string, body: unknown): Promise<number> {
  return Promise.resolve(
    routeApp.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  ).then((response) => response.status);
}

async function storedIds(documentId: string) {
  const [bindings, updates] = await Promise.all([
    db
      .select({ blobId: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.documentId, documentId)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
  ]);
  return {
    blobIds: bindings.map((row) => row.blobId).sort(),
    updateIds: updates.map((row) => row.id).sort(),
  };
}

// Both binds share the document head before their blob rows. If each upgraded
// it to FOR UPDATE for its sync only after the blob rows, the second sharer
// would deadlock the first. Holding the document row parks both binds past
// their head locks, at the touch that precedes the sync write.
test.skipIf(!isPostgres)(
  "two binds carrying document syncs on one document both commit",
  async () => {
    const fixture = await documentWithRoot();
    const first = await bindWithDocumentSync({ ...fixture, slotId: "first" });
    const second = await bindWithDocumentSync({ ...fixture, slotId: "second" });
    const documentRow = await holdPostgresLock(async (tx) => {
      await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, fixture.document.id))
        .for("update");
    });
    let statuses: Promise<number[]> | undefined;
    try {
      statuses = Promise.all([first.run(), second.run()]);
      await waitForPostgresLockWait({
        blockerPid: documentRow.backendPid,
        minimumWaiters: 2,
        queryFragment: "",
      });
    } finally {
      await documentRow.release();
    }

    expect(await statuses).toEqual([200, 200]);
    expect(await storedIds(fixture.document.id)).toEqual({
      blobIds: [first.blobId, second.blobId].sort(),
      updateIds: [first.updateId, second.updateId].sort(),
    });
  },
  30_000,
);

async function linkWithBlobRewrap(input: {
  readonly document: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}) {
  const blobId = crypto.randomUUID();
  const { request: bound } = await buildBind({
    blobId,
    document: input.document,
    owner: input.owner,
    root: input.root,
    slotId: "existing",
    stagedBlob: await stageBlob(input.owner, blobId),
  });
  await bindForTest({ blobId, owner: input.owner, request: bound });
  const child = await createChildContainer({
    parent: input.root,
    signer: input.owner,
  });
  const childKek = await kekStateFromContainerResponse(child);
  const rawTarget = bound.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected the bound blob's target");
  const target = {
    ...rawTarget,
    wrappingMetadata: readKeyingCanonicalJson(
      rawTarget.wrappingMetadata,
      "test wrap",
    ),
  };
  return buildDocumentLinkRequest({
    blobRewraps: [
      {
        blobId,
        contentKeyEpoch: 1,
        targets: [
          target,
          {
            ...target,
            containerId: child.containerId,
            containerKeyEpoch: childKek.containerKeyEpoch,
            containerKeyEpochId: childKek.containerKeyEpochId,
            containerManifestHash: childKek.accessManifestHash,
            wrappedKey: contentKeyEnvelopeFixture("Blob", "race-child-wrap")
              .wrappedKey,
          },
        ],
      },
    ],
    child,
    createdDocument: input.document,
    owner: input.owner,
    root: input.root,
  });
}

// The bind with a document sync, a standalone sync write, and a link that
// rewraps the document's bound blob all take container heads, then the
// document head FOR UPDATE, then blob rows. Queued behind one held head they
// serialize in some order; whichever runs later may be refused as stale, but
// none may deadlock or fail with anything other than a 409.
test.skipIf(!isPostgres)(
  "a bind carrying a document sync races a sync write and a link rewrap",
  async () => {
    const fixture = await documentWithRoot();
    const link = await linkWithBlobRewrap(fixture);
    const carried = await bindWithDocumentSync({ ...fixture, slotId: "new" });
    const { request: standalone } = await createSignedDocumentSyncRequest({
      created: fixture.document,
      owner: fixture.owner,
      root: fixture.root,
    });
    const head = await holdAccessManifestHeadForUpdate({
      objectId: fixture.document.id,
      objectKind: "document",
    });
    const pending: Promise<number>[] = [];
    try {
      pending.push(carried.run());
      pending.push(
        post(
          fixture.owner,
          `/documents/${fixture.document.id}/sync`,
          standalone,
        ),
      );
      pending.push(
        post(fixture.owner, `/documents/${fixture.document.id}/link`, link),
      );
      await waitForPostgresLockWait({
        blockerPid: head.backendPid,
        minimumWaiters: 3,
        queryFragment: "access_manifest_heads",
      });
    } finally {
      await head.release();
    }

    const statuses = await Promise.all(pending);
    for (const status of statuses) {
      expect([200, 409]).toContain(status);
    }
    expect(statuses).toContain(200);
    const stored = await storedIds(fixture.document.id);
    expect(stored.updateIds.includes(carried.updateId)).toBe(
      statuses[0] === 200,
    );
    expect(stored.blobIds.includes(carried.blobId)).toBe(statuses[0] === 200);
  },
  30_000,
);
