import {
  type DocumentStore,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  loadPersistedDocumentContent,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
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
import { checkSeedBytes, discoverSeedDocuments } from "../verifySeedDownloads";
import { withSavedSession } from "./account";

type Assets = Awaited<ReturnType<typeof loadContinuityAssets>>;
type FixtureInput = Parameters<typeof prepareContinuityAttachments>[0];

async function verifyDocument(
  session: CliSession,
  store: DocumentStore,
  fixture: FixtureInput,
  localId: string,
  prepared: Awaited<ReturnType<typeof prepareContinuityAttachments>>,
) {
  if (
    !(await store.ensureInitialized()) ||
    !(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000)))
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
        text: content.getText("text").toString(),
      },
      session.userId,
    );
  } finally {
    content.free();
  }
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
    const source =
      storageKey && (await session.sdk.blobs.store.openByteSource(storageKey));
    if (!source) throw new Error(`Missing attachment bytes: ${label}`);
    await checkSeedBytes(source, original, label);
    bytes += original.byteLength;
    session.tracer.event(
      `verified ${intent.name} (${original.byteLength} bytes)`,
    );
  }
  return bytes;
}

async function verifyFixtures(
  session: CliSession,
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
  const documents = expected.size;
  let bytes = 0;
  let attachments = 0;
  for await (const { containerId, row } of discoverSeedDocuments(
    account.folders,
    (id) => session.sdk.containerContents.discoverContainerDocuments(id),
    session.sdk.containerContents.documentQueries()
      .listLinkedContainerIdsByDocumentIds,
  )) {
    if (!row.documentId) continue;
    const fixture = expected.get(row.documentId);
    if (!fixture) continue;
    const prepared = await prepareContinuityAttachments(fixture);
    const runtime = session.sdk.documents.workflowRuntime(containerId);
    const store = session.sdk.documents.open(
      {
        containerId,
        localId: row.id,
        documentId: row.documentId,
      },
      {
        remoteSyncMode: "on-demand",
        workflowRuntime: {
          ...runtime,
          blobAttachments: runtime.blobAttachments.withExpectedDownloads(
            row.documentId,
            new Map(
              prepared.map(({ intent }) => [intent.slotId, intent.byteLength]),
            ),
          ),
        },
      },
    );
    bytes += await session.tracer.span(`read ${fixture.document.key}`, () =>
      verifyDocument(session, store, fixture, row.id, prepared),
    );
    attachments += fixture.document.attachments.length;
    expected.delete(row.documentId);
    if (!expected.size) break;
  }
  if (expected.size)
    throw new Error(
      `Missing fixtures: ${Array.from(expected.values(), ({ document }) => document.key).join(", ")}`,
    );
  session.assertNoFailures();
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
