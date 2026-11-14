import { expect, test } from "bun:test";
import { type DatabaseTransaction, db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import {
  requireAndRefreshCurrentDocumentContentKeyBundle,
  storeDocumentContentKeyBundleInTransaction,
} from "../../../access/write/documentContentKeyStore";
import { createDocumentWithExecutor } from "./createDocument";
import { takeCreatedDocumentSeed } from "./shared/createdDocumentSeed";
import { toStoredContentKeyBundleInput } from "./shared/records";

async function fixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  return { owner, root, request: await createDocumentRequest({ owner, root }) };
}

function create(
  executor: DatabaseTransaction,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  return createDocumentWithExecutor({
    executor,
    fingerprint: f.owner.fingerprint,
    userId: f.owner.userId,
    request: f.request,
  });
}

function readSeed(
  executor: DatabaseTransaction,
  result: Awaited<ReturnType<typeof create>>,
) {
  const read = takeCreatedDocumentSeed({
    executor,
    documentId: result.created.id,
    seed: result.createdDocumentSeed,
  });
  if (!read) throw new Error("Expected genuine create evidence");
  return read;
}

function requireBundle(
  executor: DatabaseTransaction,
  read: ReturnType<typeof readSeed>,
  overrides: Partial<
    Parameters<typeof requireAndRefreshCurrentDocumentContentKeyBundle>[0]
  > = {},
) {
  return requireAndRefreshCurrentDocumentContentKeyBundle({
    documentId: read.frontier.documentId,
    contentKeyEpoch: read.bundle.contentKeyEpoch,
    expectedLinkSetManifestHash: read.frontier.linkSetManifestHash,
    expectedTargetHash: read.targets.targets.documentKeyTargetHash,
    executor,
    resolvedTargets: read.targets,
    createdBundle: read.bundle,
    ...overrides,
  });
}

test("a created bundle for another document falls back to the stored bundle", async () => {
  const f = await fixture();
  const otherRequest = await createDocumentRequest(f);
  await db.transaction(async (executor) => {
    const first = readSeed(executor, await create(executor, f));
    const other = readSeed(
      executor,
      await create(executor, { ...f, request: otherRequest }),
    );
    expect(other.bundle.linkSetManifestHash).not.toBe(
      first.bundle.linkSetManifestHash,
    );
    const result = requireBundle(executor, first, {
      createdBundle: other.bundle,
    });
    await expect(result).resolves.toMatchObject({
      documentId: first.bundle.documentId,
    });
    expect((await result).targets).toEqual(first.bundle.targets);
  });
});

test("a created bundle cannot stand in for an unstored epoch", async () => {
  const f = await fixture();
  await db.transaction(async (executor) => {
    const read = readSeed(executor, await create(executor, f));
    await expect(
      requireBundle(executor, read, { contentKeyEpoch: 2 }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Document content-key bundle missing",
    });
  });
});

test("created bundle reuse still checks the link-set hash", async () => {
  const f = await fixture();
  const otherRequest = await createDocumentRequest(f);
  await db.transaction(async (executor) => {
    const first = readSeed(executor, await create(executor, f));
    const other = readSeed(
      executor,
      await create(executor, { ...f, request: otherRequest }),
    );
    expect(other.frontier.linkSetManifestHash).not.toBe(
      first.frontier.linkSetManifestHash,
    );
    await expect(
      requireBundle(executor, first, {
        expectedLinkSetManifestHash: other.frontier.linkSetManifestHash,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Document link-set manifest hash is stale",
    });
  });
});

test("a supplied bundle store ignores another document's created bundle", async () => {
  const f = await fixture();
  const otherRequest = await createDocumentRequest(f);
  await db.transaction(async (executor) => {
    const first = readSeed(executor, await create(executor, f));
    const other = readSeed(
      executor,
      await create(executor, { ...f, request: otherRequest }),
    );
    expect(other.bundle.documentId).not.toBe(first.bundle.documentId);
    const result = storeDocumentContentKeyBundleInTransaction(
      {
        ...toStoredContentKeyBundleInput(
          first.bundle.documentId,
          f.request.contentKeyBundle,
        ),
        resolvedTargets: first.targets,
        createdBundle: other.bundle,
      },
      executor,
    );
    await expect(result).resolves.toMatchObject({
      documentId: first.bundle.documentId,
    });
    expect((await result).targets).toEqual(first.bundle.targets);
  });
});

// These test the internal handoff lifetime, not HTTP admission. All tokens and
// transaction identities come from real creates; no fake verified records.
test("a created document handoff is consumed once", async () => {
  const f = await fixture();
  await db.transaction(async (executor) => {
    const { created, createdDocumentSeed: seed } = await create(executor, f);
    const input = { executor, documentId: created.id, seed };
    const read = takeCreatedDocumentSeed(input);
    expect(read?.frontier.documentId).toBe(created.id);
    expect(read?.frontier.linkSetManifestHash).toBe(
      f.request.contentKeyBundle.linkSetManifestHash,
    );
    expect(read?.targets.allowHistoricalParentEpochs).toBe(false);
    expect(read?.targets.targets.documentId).toBe(created.id);
    expect(read?.bundle.documentId).toBe(created.id);
    expect(takeCreatedDocumentSeed(input)).toBeUndefined();
  });
});

test("a created document handoff cannot serve another real document", async () => {
  const f = await fixture();
  const otherRequest = await createDocumentRequest(f);
  await db.transaction(async (executor) => {
    const first = await create(executor, f);
    const other = await create(executor, { ...f, request: otherRequest });
    expect(other.created.id).not.toBe(first.created.id);
    expect(
      takeCreatedDocumentSeed({
        executor,
        documentId: other.created.id,
        seed: first.createdDocumentSeed,
      }),
    ).toBeUndefined();
  });
});

test("a created document handoff cannot cross transactions", async () => {
  const f = await fixture();
  const first = await db.transaction((executor) => create(executor, f));
  await db.transaction(async (executor) => {
    expect(
      takeCreatedDocumentSeed({
        executor,
        documentId: first.created.id,
        seed: first.createdDocumentSeed,
      }),
    ).toBeUndefined();
  });
});
