import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import type { CreatedDocumentFixture } from "./documentAcknowledgementFixture";
import {
  createSignedDocumentSyncRequest,
  type DeclaredSpan,
} from "./documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";
import { postDocumentSync } from "./staleBundleHealKit";
import { withStoredContainerMutation } from "./storedContainerMutation";

export interface SharedWriterDocument {
  readonly created: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
  readonly writer: TestUser;
}

/** A document in the owner's root, which the owner shares with a writer. */
export async function sharedWriterDocument(): Promise<SharedWriterDocument> {
  const owner = createTestUser();
  const writer = createTestUser();
  for (const user of [owner, writer]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const shared = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildRootGrantRequest({
          accessLevel: "write",
          previous: root.bundle,
          previousKekState: root.kekState,
          recipient: writer,
          signer: owner,
        }),
      ),
    },
  );
  expect(shared.status).toBe(200);
  const sharedBody = await shared.json();
  if (!isContainerMutationResponse(sharedBody)) {
    throw new Error("Expected a shared root");
  }
  const stored = await withStoredContainerMutation(sharedBody);
  const sharedRoot: StoredRootFixture = {
    bundle: await accessManifestFromContainerResponse(stored),
    kekState: await kekStateFromContainerResponse(stored),
    principalPolicies: root.principalPolicies,
  };
  const created = await createDocument({ owner, root: sharedRoot });
  return { created, owner, root: sharedRoot, writer };
}

/** A declared span of one peer, `[start, end)`. */
export function peerSpan(
  peerId: string,
  start: number,
  end: number,
): DeclaredSpan {
  return {
    partialEndVersionVector: encodeVersionVectorCounters({ [peerId]: end }),
    partialStartVersionVector:
      start === 0
        ? emptyVersionVector()
        : encodeVersionVectorCounters({ [peerId]: start }),
  };
}

/** A rotation baseline declaring every peer from counter 0 to its end. */
export function baselineSpan(
  ends: Readonly<Record<string, number>>,
): DeclaredSpan {
  return {
    partialEndVersionVector: encodeVersionVectorCounters(ends),
    partialStartVersionVector: emptyVersionVector(),
  };
}

/** One sync request carrying a signed update per span, in order. */
async function peerSyncRequest(
  fixture: SharedWriterDocument,
  user: TestUser,
  spans: readonly DeclaredSpan[],
  options: { readonly checkpoint?: boolean } = {},
): Promise<{
  readonly request: DocumentSyncRequest;
  readonly updateIds: readonly string[];
}> {
  const signed = [];
  for (const declaredSpan of spans) {
    signed.push(
      await createSignedDocumentSyncRequest({
        checkpoint: options.checkpoint ?? false,
        created: fixture.created,
        declaredSpan,
        owner: user,
        root: fixture.root,
      }),
    );
  }
  const [first] = signed;
  if (!first) throw new Error("Expected at least one span");
  return {
    request: {
      ...first.request,
      outgoingUpdates: signed.flatMap((entry) => entry.request.outgoingUpdates),
    },
    updateIds: signed.map((entry) => entry.updateId),
  };
}

/** Posts one update per span as `user` and returns the response. */
export async function syncPeerSpans(
  fixture: SharedWriterDocument,
  user: TestUser,
  spans: readonly DeclaredSpan[],
  options: { readonly checkpoint?: boolean } = {},
) {
  const { request, updateIds } = await peerSyncRequest(
    fixture,
    user,
    spans,
    options,
  );
  const response = await postDocumentSync(user, fixture.created.id, request);
  return { response, updateIds };
}

export async function peerOwner(
  documentId: string,
  peerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ ownerUserId: documentPeerOwners.ownerUserId })
    .from(documentPeerOwners)
    .where(
      and(
        eq(documentPeerOwners.documentId, documentId),
        eq(documentPeerOwners.peerId, peerId),
      ),
    );
  return row?.ownerUserId ?? null;
}

export async function committedUpdateIds(
  updateIds: readonly string[],
): Promise<string[]> {
  const rows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, [...updateIds]));
  return rows.map((row) => row.id);
}
