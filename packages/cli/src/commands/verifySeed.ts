import {
  createDocumentHeadLinkSetLoader,
  type DocumentStore,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  loadPersistedDocumentContent,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  continuityContactsDefinition,
  continuityDocuments,
  continuitySeedTag,
  loadContinuityAssets,
  prepareContinuityAttachments,
} from "app/continuity";
import type { CommandInput } from "../cliContext";
import { resolveSeedAccount, seedLocalId } from "../seedAccount";
import type { CliSession } from "../session";
import {
  checkDocument,
  checkSeedRoots,
  checkStoredAttachments,
} from "../verifySeedContent";
import {
  beforeSeedDeadline,
  checkSeedBytes,
  discoverSeedDocuments,
  hasSeedPlacement,
  verifiedSeedStorageKeys,
} from "../verifySeedDownloads";
import { withSavedSession } from "./account";

type Assets = Awaited<ReturnType<typeof loadContinuityAssets>>;
type FixtureInput = Parameters<typeof prepareContinuityAttachments>[0];

async function verifyDocument(
  session: CliSession,
  store: DocumentStore,
  fixture: FixtureInput,
  localId: string,
  prepared: Awaited<ReturnType<typeof prepareContinuityAttachments>>,
  signal: AbortSignal,
  verified: ReadonlyMap<string, unknown>,
) {
  if (
    !(await store.ensureInitialized()) ||
    !(await store.requestRemoteSyncAndWait(signal))
  )
    throw new Error(`Could not sync ${fixture.document.key}`);
  const snapshot = store.getSnapshot();
  const content = await loadPersistedDocumentContent({
    execSql: session.sdk.documents.workflowRuntime().infra.execSql,
    localId,
    persistence: defaultDocumentsPersistence,
  });
  if (!content)
    throw new Error(`Missing stored content: ${fixture.document.key}`);
  try {
    checkSeedRoots(fixture.document.key, content.getShallowValue());
    checkStoredAttachments(
      fixture.document.key,
      prepared,
      content.getMap("content").toJSON(),
    );
    checkDocument(
      fixture.document,
      snapshot,
      continuitySeedTag(fixture.document, prepared),
      {
        fields: content.getMap("fields").toJSON(),
        rows: content.getList("rows").toJSON(),
        metadata: content.getMap("metadata").toJSON(),
        seedTag: content.getMap("content").get("seedTag"),
        textDelta: content.getText("text").toDelta(),
      },
      session.userId,
    );
  } finally {
    content.free();
  }
  if (!snapshot.documentId)
    throw new Error(`Missing document ID: ${fixture.document.key}`);
  const runtime = session.sdk.documents.workflowRuntime();
  const storageKeys = verifiedSeedStorageKeys(
    fixture.document.key,
    prepared.map(({ intent }) => intent.slotId),
    await runtime.apiClient.listDocumentAttachments(snapshot.documentId, {
      boundedListing: true,
      signal,
    }),
    await defaultDocumentsPersistence.listLocalAttachments(
      runtime.infra.execSql,
      localId,
    ),
    verified,
  );
  let bytes = 0;
  for (const [index, { intent, bytes: original }] of prepared.entries()) {
    const slot = snapshot.attachments[index];
    const label = `${fixture.document.key} / ${intent.name}`;
    if (
      slot?.slotId !== intent.slotId ||
      slot.name !== intent.name ||
      slot.mimeType !== intent.mimeType ||
      slot.contentSha256 !== intent.contentSha256 ||
      slot.byteLength !== intent.byteLength
    )
      throw new Error(`Attachment metadata differs: ${label}`);
    const storageKey = snapshot.attachmentStorageKeyBySlotId[intent.slotId];
    if (!storageKey || storageKey !== storageKeys.get(intent.slotId))
      throw new Error(`Attachment storage key differs: ${label}`);
    const source =
      storageKey &&
      (await session.sdk.blobs.store.openByteSource(storageKey, signal));
    if (!source) throw new Error(`Missing attachment bytes: ${label}`);
    await checkSeedBytes(source, original, label, signal);
    bytes += original.byteLength;
    session.tracer.event(
      `verified ${intent.name} (${original.byteLength} bytes)`,
    );
  }
  return bytes;
}

async function expectedFixtures(
  account: Awaited<ReturnType<typeof resolveSeedAccount>>,
  assets: Assets,
) {
  const expected = new Map<string, FixtureInput>();
  for (const document of continuityDocuments(assets.spec)) {
    const localId = seedLocalId(
      account.signingPrivateKey,
      account.rootId,
      assets.datasetSha256,
      document.key,
    );
    expected.set(await deriveStableDocumentId(localId), {
      document,
      localId,
      readAttachment: assets.readAttachment,
    });
  }
  return expected;
}

async function checkSeedPlacement(
  session: CliSession,
  documentId: string,
  containerId: string,
  expectedFolder: string,
  fixtureKey: string,
  deadline: AbortSignal,
) {
  const lookup = createDocumentHeadLinkSetLoader(
    session.sdk.containerContents.workflowRuntime(),
    undefined,
    undefined,
    deadline,
  );
  const head = await beforeSeedDeadline(
    lookup(documentId, undefined, session.userId),
    deadline,
    `Timed out verifying creator and placement: ${fixtureKey}.`,
  );
  if (
    !head ||
    head === "not-found" ||
    !head.accessStateHash ||
    head.organizationId !== session.sdk.session.organizationId ||
    !hasSeedPlacement(head.linkedContainerIds, containerId, expectedFolder)
  ) {
    throw new Error(
      `Could not verify seed creator and placement: ${fixtureKey}`,
    );
  }
}

function prepareBeforeDeadline(fixture: FixtureInput, deadline: AbortSignal) {
  return beforeSeedDeadline(
    prepareContinuityAttachments(fixture),
    deadline,
    `Timed out reading local fixtures for ${fixture.document.key}.`,
  );
}

async function readFixture(
  session: CliSession,
  fixture: FixtureInput,
  containerId: string,
  localId: string,
  documentId: string,
  deadline: AbortSignal,
) {
  const prepared = await prepareBeforeDeadline(fixture, deadline);
  const runtime = session.sdk.documents.workflowRuntime(containerId);
  const verified = new Map<string, unknown>();
  const store = session.sdk.documents.open(
    {
      containerId,
      localId: localId,
      documentId: documentId,
    },
    {
      remoteSyncMode: "on-demand",
      workflowRuntime: {
        ...runtime,
        // Replaying history can mark a previously downloaded binding for detach.
        // Permit only pulls, including continuation pages, on the verifier's device.
        util: {
          ...runtime.util,
          deferAttachmentDetaches: true,
          isRemoteSyncBlocked: (organizationId, direction) =>
            direction !== "pull" ||
            (runtime.util.isRemoteSyncBlocked?.(organizationId, direction) ??
              false),
        },
        blobAttachments: runtime.blobAttachments.withExpectedDownloads(
          documentId,
          new Map(
            prepared.map(({ intent }) => [intent.slotId, intent.byteLength]),
          ),
          deadline,
          (binding) => verified.set(binding.slotId, structuredClone(binding)),
        ),
      },
    },
  );
  return session.tracer.span(`read ${fixture.document.key}`, () =>
    beforeSeedDeadline(
      verifyDocument(
        session,
        store,
        fixture,
        localId,
        prepared,
        deadline,
        verified,
      ),
      deadline,
      `Timed out verifying ${fixture.document.key}.`,
    ),
  );
}

async function verifyFixtures(
  session: CliSession,
  account: Awaited<ReturnType<typeof resolveSeedAccount>>,
  assets: Assets,
) {
  const expected = await expectedFixtures(account, assets);
  const { systemSlot } = await continuityContactsDefinition(session.sdk);
  const contacts = account.folders.find(
    (node) =>
      node.parentId === account.rootId && node.systemSlot === systemSlot,
  );
  if (!contacts) throw new Error("Missing seeded Contacts folder.");
  const documents = expected.size;
  let bytes = 0;
  let attachments = 0;
  for await (const { containerId, row } of discoverSeedDocuments(
    [account.rootId, contacts.id],
    (id, onPending, signal) =>
      session.sdk.containerContents.discoverContainerDocuments(id, {
        signal,
        onPendingDiscovery: (delay) => {
          session.tracer.event(
            `waiting ${delay} ms for document discovery in ${id}`,
          );
          onPending(delay);
        },
      }),
    session.sdk.containerContents.documentQueries()
      .listLinkedContainerIdsByDocumentIds,
  )) {
    if (!row.documentId) continue;
    const fixture = expected.get(row.documentId);
    if (!fixture) continue;
    const deadline = AbortSignal.timeout(120_000);
    await checkSeedPlacement(
      session,
      row.documentId,
      containerId,
      fixture.document.kind === "contact" ? contacts.id : account.rootId,
      fixture.document.key,
      deadline,
    );
    bytes += await readFixture(
      session,
      fixture,
      containerId,
      row.id,
      row.documentId,
      deadline,
    );
    attachments += fixture.document.attachments.length;
    expected.delete(row.documentId);
    if (!expected.size) break;
  }
  if (expected.size)
    throw new Error(
      `Missing fixtures: ${Array.from(expected.values(), ({ document }) => document.key).join(", ")}`,
    );
  // A descriptor 404 can be followed by a successful authenticated byte transfer.
  // Every expected fixture has now been independently read and compared in full.
  return { bytes, attachments, documents };
}

/** Discover from an empty device and compare decrypted content with the pinned fixture. */
export async function verifySeed(input: CommandInput) {
  const result = await withSavedSession(
    input,
    async (session) =>
      verifyFixtures(
        session,
        await resolveSeedAccount(session, input.organizationId),
        await loadContinuityAssets(),
      ),
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  input.context.stdout(
    `Verified ${result.documents} documents, ${result.attachments} attachments and ${result.bytes} plaintext bytes.`,
  );
}
