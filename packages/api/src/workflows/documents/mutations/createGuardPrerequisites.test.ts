import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  containerMetadataDocuments,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { and, eq, sql } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
import { buildDocumentPurgeRequest } from "../../../../test/helpers/documentPurge";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { storeVerifiedAccessEventInTransaction } from "../../../access/write/accessManifestStore";

import { lockDocumentLifecycleInTransaction } from "./documentLifecycleLock";
import { assertCreateCanAdvanceDocumentHead } from "./shared/documentRows";
import { verifyDocumentEvent } from "./shared/verification";

async function fixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const addPurge = async () => {
    const request = await buildDocumentPurgeRequest({
      documentId: document.id,
      documentManifestHash: document.manifestHash,
      owner,
      root,
    });
    return db.transaction(async (tx) => {
      const event = await verifyDocumentEvent({
        ...request,
        executor: tx,
        expectedDocumentId: document.id,
        expectedEventType: "document.purge",
        fingerprint: owner.fingerprint,
        userId: owner.userId,
      });
      await storeVerifiedAccessEventInTransaction(event, tx);
      return event;
    });
  };
  const check = (linkedContainerIds = [root.kekState.containerId]) =>
    db
      .transaction(async (tx) => {
        await lockDocumentLifecycleInTransaction(tx, document.id);

        await assertCreateCanAdvanceDocumentHead(
          tx,
          document.id,
          linkedContainerIds,
        );
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
  return { owner, root, document, addPurge, check };
}

// Real, separately signed purge events and deliberately corrupted stored rows.
test("create guards retain head and healthy purge refusals", async () => {
  const f = await fixture();
  expect(await f.check()).toMatchObject({
    message: "Document manifest already exists",
    status: 409,
    code: "document_manifest_already_exists",
  });
  await f.addPurge();
  expect(await f.check()).toMatchObject({
    message: "Document was permanently purged",
    status: 409,
  });
});

const corruptions = [
  {
    name: "version",
    values: { version: 2 },
    message: "stored access event version is invalid",
  },
  {
    name: "dependency array",
    values: { dependencyManifestHashes: sql`'{}'::jsonb` },
    message: "access event dependency hashes is not an array",
  },
  {
    name: "dependency element",
    values: { dependencyManifestHashes: sql`'[3]'::jsonb` },
    message: "access event dependency hashes[0] is invalid",
  },
  {
    name: "canonical body",
    values: { body: sql`'{"overflow": 1e400}'::jsonb` },
    message: "stored access event body must be canonical JSON",
  },
];
for (const corruption of corruptions) {
  test(`create purge parser preserves ${corruption.name}`, async () => {
    const f = await fixture();
    const purge = await f.addPurge();
    const predicate = eq(accessEvents.eventHash, purge.eventHash);
    await db.update(accessEvents).set(corruption.values).where(predicate);
    if (corruption.name === "canonical body") {
      const [stored] = await db.select().from(accessEvents).where(predicate);
      invariant(stored, "expected persisted corrupt purge event");
      expect(Reflect.get(stored.body as object, "overflow")).toBe(Infinity);
    }
    expect(await f.check()).toEqual(new Error(corruption.message));
  });
}

test("create guards reject duplicate purges before parsing either body", async () => {
  const f = await fixture();
  const first = await f.addPurge();
  await db
    .update(accessEvents)
    .set({ body: sql`'{"overflow": 1e400}'::jsonb` })
    .where(eq(accessEvents.eventHash, first.eventHash));
  const second = await f.addPurge();
  expect(second.eventHash).not.toBe(first.eventHash);
  expect(second.event.eventId).not.toBe(first.event.eventId);
  expect(await f.check()).toEqual(
    new Error("Stored access event type is not unique for its object"),
  );
});

test("create guards prioritize roster and metadata refusals over corrupt purge and head", async () => {
  const f = await fixture();
  const purge = await f.addPurge();
  await db
    .update(accessEvents)
    .set({ version: 2 })
    .where(eq(accessEvents.eventHash, purge.eventHash));
  // The binding is a real stored root metadata reservation; redirecting it is
  // intentional corruption that puts independently rejecting guards together.
  await db
    .update(containerMetadataDocuments)
    .set({ documentId: f.document.id })
    .where(
      eq(containerMetadataDocuments.containerId, f.root.kekState.containerId),
    );
  expect(await f.check([crypto.randomUUID()])).toMatchObject({
    message:
      "Container metadata document must link only to its owning container",
    status: 409,
  });
  await db
    .update(containerMetadataDocuments)
    .set({ containerId: crypto.randomUUID() })
    .where(eq(containerMetadataDocuments.documentId, f.document.id));
  expect(await f.check()).toMatchObject({
    message: "Document ID belongs to a deleted container",
    status: 409,
  });
  const rows = await db
    .update(organizationRosterEntries)
    .set({ profileDocumentId: f.document.id })
    .where(
      and(
        eq(
          organizationRosterEntries.organizationId,
          asVerifiedContainerManifest(f.root.bundle).state.organizationId,
        ),
        eq(organizationRosterEntries.userId, f.owner.userId),
      ),
    )
    .returning();
  expect(rows).toHaveLength(1);
  expect(await f.check()).toMatchObject({
    message: "Bound roster profile document IDs cannot be recreated",
    status: 409,
  });
});
