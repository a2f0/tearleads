import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import { count, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  committedUpdateIds,
  sharedWriterDocument,
  syncPeerSpans,
} from "../../../test/helpers/documentPeerOwnership";
import {
  createSignedDocumentSyncRequest,
  type DeclaredSpan,
} from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

// Postgres binds at most 65,535 parameters to a statement: 13,107 span rows
// of five columns, or 21,845 owner rows of three. Every count below passes
// the limit for the rows it tests, and each request stays far under the
// 16 MiB request ceiling.

/** `count` distinct peer ids, starting at `offset`. */
function peerIds(offset: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    String(1_000_000 + offset + index),
  );
}

/** One update declaring a single op on each peer, from counter 0. */
function oneOpPerPeer(peers: readonly string[]): DeclaredSpan {
  return {
    partialEndVersionVector: encodeVersionVectorCounters(
      Object.fromEntries(peers.map((peerId) => [peerId, 1])),
    ),
    partialStartVersionVector: emptyVersionVector(),
  };
}

async function spanRowCount(updateId: string): Promise<number> {
  const [row] = await db
    .select({ rows: count() })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, updateId));
  return row?.rows ?? 0;
}

async function ownerRowCount(documentId: string): Promise<number> {
  const [row] = await db
    .select({ rows: count() })
    .from(documentPeerOwners)
    .where(eq(documentPeerOwners.documentId, documentId));
  return row?.rows ?? 0;
}

// #3230 item 3: a member's ordinary writes may add peers across requests
// until the document holds more than one statement's worth, and every later
// rotation baseline carries all of them.
test("a rotation baseline over more peers than one statement binds commits", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  const first = peerIds(0, 7_000);
  const second = peerIds(7_000, 7_000);
  for (const peers of [first, second]) {
    const claim = await syncPeerSpans(fixture, writer, [oneOpPerPeer(peers)]);
    expect(claim.response.status).toBe(200);
  }

  const baseline = await syncPeerSpans(
    fixture,
    owner,
    [oneOpPerPeer([...first, ...second])],
    { checkpoint: true },
  );

  expect(baseline.response.status).toBe(200);
  const [baselineId] = baseline.updateIds;
  if (!baselineId) throw new Error("Expected a baseline id");
  expect(await committedUpdateIds([baselineId])).toEqual([baselineId]);
  expect(await spanRowCount(baselineId)).toBe(14_000);
}, 120_000);

// A create's seed claims every peer it carries, as an organization's recovery
// does when it recreates a document from its history.
test("a create seed claiming more peers than one statement binds owns them all", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const create = await createDocumentRequest({ owner, root });
  const planned = {
    accessManifest: { state: create.event },
    contentKeyBundle: create.contentKeyBundle,
    id: String(Reflect.get(create.event, "objectId")),
  } as unknown as CreatedDocumentFixture;
  const { request: seed, updateId } = await createSignedDocumentSyncRequest({
    created: planned,
    declaredSpan: oneOpPerPeer(peerIds(0, 21_847)),
    owner,
    root,
  });

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...create,
      initialSync: { outgoingUpdates: seed.outgoingUpdates },
    }),
  });

  expect(response.status).toBe(200);
  const created = (await response.json()) as DocumentCreateResponse;
  expect(created.initialSync?.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(await ownerRowCount(created.id)).toBe(21_847);
  expect(await spanRowCount(updateId)).toBe(21_847);
}, 120_000);
