// What the rotation baseline route tests share: a document with committed
// history, readers of what a request wrote, and a pull as a new reader.
import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { mergeVersionVectors } from "@tearleads/loro";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type {
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentSyncResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import { asc, eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import { withDocumentMutationArtifacts } from "./documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "./documentLinkMutation";
import { createSignedDocumentSyncRequest } from "./documentUpdateRequests";
import { createChildContainer } from "./keyingWriterProjectionChild";
import { bootstrapRoot, createDocument } from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";
import { postDocumentSync } from "./staleBundleHealKit";

export const GROUP_INVALID = DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid;
export const NOT_WHOLE = "Document rotation baseline is not one whole group: ";

export function postJson(owner: TestUser, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** A document with three committed updates, each of its own peer. */
export async function documentWithHistory() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const committed: DocumentOutgoingUpdate[] = [];
  for (let update = 0; update < 3; update += 1) {
    const { request } = await createSignedDocumentSyncRequest({
      created,
      owner,
      root,
    });
    expect((await postDocumentSync(owner, created.id, request)).status).toBe(
      200,
    );
    committed.push(...request.outgoingUpdates);
  }
  const frontier = mergeVersionVectors(
    committed.map((update) => update.partialEndVersionVector),
  );
  return { committed, created, frontier, owner, root };
}

export type History = Awaited<ReturnType<typeof documentWithHistory>>;

export function storedUpdates(documentId: string) {
  return db
    .select({
      baselineCoversThroughUpdateId:
        documentUpdates.baselineCoversThroughUpdateId,
      baselineId: documentUpdates.baselineId,
      baselineSegmentCount: documentUpdates.baselineSegmentCount,
      baselineSegmentIndex: documentUpdates.baselineSegmentIndex,
      baselineSegmentsDigest: documentUpdates.baselineSegmentsDigest,
      id: documentUpdates.id,
      sequence: documentUpdates.sequence,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId))
    .orderBy(asc(documentUpdates.sequence));
}

export async function storedHeaderCount(documentId: string): Promise<number> {
  return (
    await db
      .select({ id: documentContentWriteHeaders.updateId })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId))
  ).length;
}

/** Pulls from nothing, page by page, as a reader that holds no history. */
export async function pullAsNewReader(
  owner: TestUser,
  documentId: string,
  at: {
    readonly contentKeyEpoch: number;
    readonly manifestHash: string;
    readonly targetHash: string;
  },
  maxPageUpdates: number,
): Promise<DocumentSyncResponse[]> {
  const pages: DocumentSyncResponse[] = [];
  let pullCursor: string | undefined;
  do {
    const response = await postDocumentSync(owner, documentId, {
      contentKeyEpoch: at.contentKeyEpoch,
      expectedLinkSetManifestHash: at.manifestHash,
      expectedTargetHash: at.targetHash,
      localVersionVector: null,
      maxPageUpdates,
      outgoingUpdates: [],
      ...(pullCursor === undefined ? {} : { pullCursor }),
      supportsPullPagination: true,
    } satisfies DocumentSyncRequest);
    expect(response.status).toBe(200);
    const page: DocumentSyncResponse = await response.json();
    expect(isDocumentSyncResponse(page)).toBe(true);
    pages.push(page);
    pullCursor = page.pullPage?.nextCursor ?? undefined;
  } while (pullCursor !== undefined);
  return pages;
}

/** The fields of a served or sent segment that place it in its group. */
export function groupFields(update: {
  readonly baselineId?: string | undefined;
  readonly baselineSegmentCount?: number | undefined;
  readonly baselineSegmentIndex?: number | undefined;
  readonly baselineSegmentsDigest?: string | undefined;
  readonly coversThroughUpdateId?: string | undefined;
  readonly id: string;
}) {
  return {
    baselineId: update.baselineId,
    baselineSegmentCount: update.baselineSegmentCount,
    baselineSegmentIndex: update.baselineSegmentIndex,
    baselineSegmentsDigest: update.baselineSegmentsDigest,
    coversThroughUpdateId: update.coversThroughUpdateId,
    id: update.id,
  };
}

/** Links the document into a child folder; returns its unlink builder. */
export async function linkedForUnlink(history: History) {
  const { created, owner, root } = history;
  const child = await createChildContainer({ parent: root, signer: owner });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkResponse = await postJson(
    owner,
    `/documents/${created.id}/link`,
    linkRequest,
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    await linkResponse.json(),
  );
  type UnlinkOptions = Omit<
    Parameters<typeof buildDocumentUnlinkRequest>[0],
    "child" | "linkedDocument" | "owner" | "root"
  >;
  return (options: UnlinkOptions = {}) =>
    buildDocumentUnlinkRequest({
      child,
      linkedDocument,
      owner,
      root,
      ...options,
    });
}
