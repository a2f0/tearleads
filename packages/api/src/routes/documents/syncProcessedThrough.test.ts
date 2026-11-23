import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  createSignedDocumentSyncRequest,
  type DeclaredSpan,
} from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";

interface Fixture {
  readonly created: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}

async function documentFixture(): Promise<Fixture> {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  return { created, owner, root };
}

async function commit(
  fixture: Fixture,
  declaredSpan?: DeclaredSpan,
): Promise<{ id: string; end: string }> {
  const { request, updateId } = await createSignedDocumentSyncRequest({
    ...fixture,
    declaredSpan,
  });
  const response = await postDocumentSync(fixture.owner, fixture.created.id, {
    ...request,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const [update] = request.outgoingUpdates;
  if (!update) throw new Error("Expected one update");
  return { id: updateId, end: update.partialEndVersionVector };
}

async function pull(
  fixture: Fixture,
  input: {
    readonly localVersionVector: string | null;
    readonly processedThroughUpdateId?: string;
  },
): Promise<DocumentSyncResponse> {
  const request: DocumentSyncRequest = {
    contentKeyEpoch: fixture.created.contentKeyEpoch,
    expectedLinkSetManifestHash: fixture.created.manifestHash,
    expectedTargetHash: fixture.created.targetHash,
    localVersionVector: input.localVersionVector,
    outgoingUpdates: [],
    ...(input.processedThroughUpdateId === undefined
      ? {}
      : { processedThroughUpdateId: input.processedThroughUpdateId }),
    supportsPullPagination: true,
  };
  const response = await postDocumentSync(
    fixture.owner,
    fixture.created.id,
    request,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as DocumentSyncResponse;
}

/** A span no reader's version will ever cover: its ops do not exist. */
const OVERCLAIM: DeclaredSpan = {
  partialStartVersionVector: emptyVersionVector(),
  partialEndVersionVector: encodeVersionVectorCounters({ "4242": 1_000_000 }),
};

test("a processed cursor stops re-serving an update the reader already judged", async () => {
  const fixture = await documentFixture();
  const honest = await commit(fixture);
  const liar = await commit(fixture, OVERCLAIM);

  const first = await pull(fixture, { localVersionVector: honest.end });
  expect(first.updates.map(({ id }) => id)).toEqual([liar.id]);
  expect(first.pullPage.throughUpdateId).toBe(liar.id);

  // Its declared span stays uncovered, so the vector alone serves it again.
  const withoutCursor = await pull(fixture, { localVersionVector: honest.end });
  expect(withoutCursor.updates.map(({ id }) => id)).toEqual([liar.id]);

  const withCursor = await pull(fixture, {
    localVersionVector: honest.end,
    processedThroughUpdateId: liar.id,
  });
  expect(withCursor.updates).toEqual([]);
  expect(withCursor.pullPage.throughUpdateId).toBe(liar.id);

  const later = await commit(fixture);
  const afterLater = await pull(fixture, {
    localVersionVector: honest.end,
    processedThroughUpdateId: liar.id,
  });
  expect(afterLater.updates.map(({ id }) => id)).toEqual([later.id]);
  expect(afterLater.pullPage.throughUpdateId).toBe(later.id);
});

test("a cursor the document does not hold serves as much as no cursor", async () => {
  const fixture = await documentFixture();
  const honest = await commit(fixture);
  const liar = await commit(fixture, OVERCLAIM);
  const other = await documentFixture();
  const foreign = await commit(other);

  for (const processedThroughUpdateId of [foreign.id, crypto.randomUUID()]) {
    const page = await pull(fixture, {
      localVersionVector: honest.end,
      processedThroughUpdateId,
    });
    expect(page.updates.map(({ id }) => id)).toEqual([liar.id]);
  }
});

test("a processed cursor without a version vector is refused", async () => {
  const fixture = await documentFixture();
  const honest = await commit(fixture);
  const response = await postDocumentSync(fixture.owner, fixture.created.id, {
    contentKeyEpoch: fixture.created.contentKeyEpoch,
    expectedLinkSetManifestHash: fixture.created.manifestHash,
    expectedTargetHash: fixture.created.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    processedThroughUpdateId: honest.id,
    supportsPullPagination: true,
  });
  expect(response.status).toBe(400);
});

test("an update declaring no operations, or an inverted span, is refused unstored", async () => {
  const fixture = await documentFixture();
  const honest = await commit(fixture);
  for (const declaredSpan of [
    {
      partialStartVersionVector: honest.end,
      partialEndVersionVector: honest.end,
    },
    {
      partialStartVersionVector: encodeVersionVectorCounters({ "4242": 9 }),
      partialEndVersionVector: encodeVersionVectorCounters({ "4242": 3 }),
    },
  ]) {
    const { request, updateId } = await createSignedDocumentSyncRequest({
      ...fixture,
      declaredSpan,
    });
    const response = await postDocumentSync(
      fixture.owner,
      fixture.created.id,
      request,
    );
    expect(response.status).toBe(400);
    expect(
      await db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.id, updateId)),
    ).toEqual([]);
  }
});
