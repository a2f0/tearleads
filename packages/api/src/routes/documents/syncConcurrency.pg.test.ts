import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  blobContentKeyTargets,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { lockAccessManifestHeadsForUpdate } from "../../access/read/accessManifestStore";
import { resolveCurrentDocumentKekTargets } from "../../access/read/documentKekTargets";
import { routeApp } from "../../routeApp";
import { errorCauseChain } from "../../utils/databaseErrors";
import { lockSyncDocumentWriteFrontier } from "../../workflows/documents/mutations/syncWriteFrontier";

// These races only exist on a multi-connection backend: the default pglite
// test database serializes every transaction, so every concurrency finding in
// the #1613 scrub (H2, H3, L2, L7) was invisible to the regular suite. The
// dedicated Postgres and remote Turso lanes run this file against their real
// services; under pglite and local SQLite the tests skip.
const databaseKind = getDefaultApiDatabaseKind();
const onConcurrencyBackend =
  databaseKind === "postgres" || databaseKind === "turso";
const concurrencyTimeoutMs = databaseKind === "turso" ? 120_000 : 30_000;

const syncErrorCodes: readonly string[] = Object.values(
  DOCUMENT_SYNC_ERROR_CODES,
);

const RACE_ROUNDS = 4;
const CONCURRENT_SUBMISSIONS = 6;

function postDocumentSync(
  owner: TestUser,
  documentId: string,
  request: DocumentSyncRequest,
) {
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

// H3 regression (#1613, fixed in #1616): a concurrent insert of the same
// update id surfaced the raw unique-violation as an unmapped 500. The fix
// inserts with onConflictDoNothing and byte-compares skipped ids, so identical
// retries settle idempotently and only genuine byte conflicts 409.
test.skipIf(!onConcurrencyBackend)(
  "concurrent identical sync submissions settle without server errors",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);

    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const created = await createDocument({ owner, root });
      const { request, updateId } = await createSignedDocumentSyncRequest({
        created,
        owner,
        root,
      });

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_SUBMISSIONS }, () =>
          postDocumentSync(owner, created.id, request),
        ),
      );

      for (const response of responses) {
        expect([200, 409]).toContain(response.status);
        if (response.status === 409) {
          const body = (await response.json()) as { code?: string };
          expect(syncErrorCodes).toContain(body.code ?? "");
        }
      }
      expect(responses.some((response) => response.status === 200)).toBe(true);

      const storedUpdates = await db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.id, updateId));
      expect(storedUpdates).toHaveLength(1);
    }
  },
  concurrencyTimeoutMs,
);

test.skipIf(databaseKind !== "turso")(
  "remote Turso sync reads do not wait on replica watermarks",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const { request } = await createSignedDocumentSyncRequest({
      created,
      owner,
      root,
    });

    const legacyResponse = await postDocumentSync(owner, created.id, {
      ...request,
      minLsn: "FFFFFFFF/FFFFFFFF",
    });
    expect(legacyResponse.status).toBe(200);
    const legacyBody = await legacyResponse.json();
    expect(legacyBody).toMatchObject({
      commitLsn: "FFFFFFFF/FFFFFFFF",
    });
    expect(legacyBody).not.toHaveProperty("commitLsnMode");

    const response = await postDocumentSync(owner, created.id, {
      ...request,
      minLsn: "FFFFFFFF/FFFFFFFF",
      supportsUntrackedCommitLsn: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      commitLsn: "0/0",
      commitLsnMode: "untracked",
    });
  },
  concurrencyTimeoutMs,
);

test.skipIf(databaseKind !== "turso")(
  "remote Turso sessions enforce foreign key constraints",
  async () => {
    let insertionError: unknown;
    try {
      await db.insert(blobContentKeyTargets).values({
        bindingId: crypto.randomUUID(),
        blobContentKeyEpochId: crypto.randomUUID(),
        containerId: crypto.randomUUID(),
        containerKeyEpoch: 1,
        containerKeyEpochId: crypto.randomUUID(),
        containerManifestHash: "foreign-key-test-manifest",
        documentId: crypto.randomUUID(),
        wrappedKey: "foreign-key-test-wrapped-key",
        wrappingMetadata: {},
      });
    } catch (error) {
      insertionError = error;
    }

    expect(
      errorCauseChain(insertionError).some(
        (candidate) =>
          candidate.message.includes("FOREIGN KEY constraint failed") ||
          Reflect.get(candidate, "extendedCode") ===
            "SQLITE_CONSTRAINT_FOREIGNKEY",
      ),
    ).toBe(true);
  },
  concurrencyTimeoutMs,
);

test.skipIf(databaseKind !== "turso")(
  "remote Turso root reads do not wait for a writer reservation",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    await bootstrapRoot(owner);

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const writer = db.transaction(async (tx) => {
      await tx.select({ id: documents.id }).from(documents).limit(1);
      markHeld();
      await hold;
    });

    await held;
    let readerSettled = false;
    const reader = db
      .select({ id: documents.id })
      .from(documents)
      .limit(1)
      .then(() => {
        readerSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const settledWhileWriterHeld = readerSettled;
    releaseHold();
    await Promise.all([reader, writer]);

    expect(settledWhileWriterHeld).toBe(true);
  },
  concurrencyTimeoutMs,
);

test("sync rejects a plaintext hash not committed by signed metadata", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const update = request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected a signed outgoing update");
  }

  const response = await postDocumentSync(owner, created.id, {
    ...request,
    outgoingUpdates: [{ ...update, plaintextHash: "unsigned-plaintext-hash" }],
  });

  expect(response.status).toBe(400);
  expect(((await response.json()) as { error?: string }).error).toBe(
    "Document update metadata hash mismatch",
  );
});

test("an idempotent retry rejects a changed plaintext hash", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const update = request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected a signed outgoing update");
  }

  const accepted = await postDocumentSync(owner, created.id, request);
  expect(accepted.status).toBe(200);

  const response = await postDocumentSync(owner, created.id, {
    ...request,
    outgoingUpdates: [
      { ...update, plaintextHash: "retry-plaintext-hash-conflict" },
    ],
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
    error: "Document update id conflict",
  });
});

// The UUID guard on authorizing refs is code-level, so this pin runs on every
// backend: a malformed container id must 400 before it reaches the uuid-typed
// lock query, where it would surface as an uncaught SQLSTATE 22P02 500.
test("sync rejects a malformed authorizing container id with 400", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const response = await postDocumentSync(owner, created.id, {
    ...request,
    authorizingContainerPathRefs: [
      [{ containerId: "not-a-uuid", manifestHash: "manifest-hash" }],
    ],
  });
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error?: string }).error).toBe(
    "Document container id is invalid",
  );
});

// L2 regression (#1613): the sync write frontier must pin every authorizing
// ancestor container head, not only the directly linked targets — an
// unlocked ancestor lets a concurrent access mutation (e.g. a root revoke)
// advance that head under an in-flight write it no longer authorizes. The
// stand-in ancestor here is a second root container that is not in the
// document's target set; before the fix the contender acquires its head
// immediately and the blocked assertion fails. On Turso, BEGIN IMMEDIATE's
// database-wide writer reservation supplies the blocking instead; that run is
// an adapter isolation smoke test, not a test of frontier-lock specificity.
test.skipIf(!onConcurrencyBackend)(
  "sync write frontier blocks head updates on authorizing ancestors",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const ancestor = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const holder = db.transaction(async (tx) => {
      const currentTargets = await resolveCurrentDocumentKekTargets(
        created.id,
        tx,
      );
      await lockSyncDocumentWriteFrontier({
        authorizingContainerIds: [ancestor.kekState.containerId],
        currentTargets,
        documentId: created.id,
        tx,
      });
      markHeld();
      await hold;
    });

    await held;
    let contenderSettled = false;
    const contender = db
      .transaction(async (tx) => {
        await lockAccessManifestHeadsForUpdate(
          "container",
          [ancestor.kekState.containerId],
          tx,
        );
      })
      .then(() => {
        contenderSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(contenderSettled).toBe(false);

    releaseHold();
    await holder;
    await contender;
    expect(contenderSettled).toBe(true);
  },
  concurrencyTimeoutMs,
);

// H2 regression (#1613, fixed in #1616): purge without the manifest-head lock
// could commit a snapshot that missed a concurrently inserted update, leaving
// orphan rows that permanently wedged re-creation. Whichever way the race
// serializes, the document row and every update row must be gone afterwards,
// and neither side may surface a server error (a deadlock's 503 backstop
// fails this too — consistent lock ordering must prevent it).
test.skipIf(!onConcurrencyBackend)(
  "concurrent purge and sync leave no orphan document rows",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);

    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const created = await createDocument({ owner, root });
      const { request } = await createSignedDocumentSyncRequest({
        created,
        owner,
        root,
      });

      const [purgeResponse, syncResponse] = await Promise.all([
        routeApp.request(`/documents/${created.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${owner.token}` },
        }),
        postDocumentSync(owner, created.id, request),
      ]);

      expect(purgeResponse.status).toBe(200);
      expect(syncResponse.status).toBeLessThan(500);
      if (syncResponse.status === 404) {
        // The only 404 a document route may emit is the positively coded
        // deletion signal that gates the client's destructive local wipe.
        const body = (await syncResponse.json()) as { code?: string };
        expect(body.code).toBe(DOCUMENT_NOT_FOUND_ERROR_CODE);
      }

      const documentRows = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, created.id));
      const updateRows = await db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.documentId, created.id));
      expect(documentRows).toHaveLength(0);
      expect(updateRows).toHaveLength(0);
    }
  },
  concurrencyTimeoutMs,
);
