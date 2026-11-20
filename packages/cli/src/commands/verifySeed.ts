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
import { checkDocument, checkStoredAttachments } from "../verifySeedContent";
import { withSavedSession } from "./account";

type Assets = Awaited<ReturnType<typeof loadContinuityAssets>>;
type FixtureInput = Parameters<typeof prepareContinuityAttachments>[0];

async function verifyDocument(
  session: CliSession,
  store: DocumentStore,
  fixture: FixtureInput,
  localId: string,
) {
  if (
    !(await store.ensureInitialized()) ||
    !(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000)))
  )
    throw new Error(`Could not sync ${fixture.document.key}`);
  const snapshot = store.getSnapshot();
  const prepared = await prepareContinuityAttachments(fixture);
  const content = await loadPersistedDocumentContent({
    execSql: session.sdk.documents.workflowRuntime().infra.execSql,
    localId,
    persistence: defaultDocumentsPersistence,
  });
  if (!content)
    throw new Error(`Missing stored content: ${fixture.document.key}`);
  try {
    checkStoredAttachments(
      fixture.document.key,
      prepared,
      content.getMap("content").toJSON(),
    );
    checkDocument(
      fixture.document,
      snapshot,
      content.getMap("fields").toJSON(),
      continuitySeedTag(fixture.document, prepared),
      content.getList("rows").toJSON(),
      content.getMap("metadata").toJSON(),
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
    const downloaded =
      storageKey && (await session.sdk.blobs.store.readBytes(storageKey));
    if (!downloaded) throw new Error(`Missing attachment bytes: ${label}`);
    if (!Buffer.from(original).equals(downloaded))
      throw new Error(`Attachment bytes differ: ${label}`);
    bytes += downloaded.byteLength;
    session.tracer.event(
      `verified ${intent.name} (${downloaded.byteLength} bytes)`,
    );
  }
  return bytes;
}

async function* discover(session: CliSession, folders: readonly string[]) {
  for (const containerId of folders) {
    for (;;) {
      const batch =
        await session.sdk.containerContents.discoverContainerDocuments(
          containerId,
        );
      if (!batch) throw new Error("Could not discover documents.");
      if (!batch.length) break;
      for (const row of batch) yield { containerId, row };
    }
  }
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
  for await (const { containerId, row } of discover(session, account.folders)) {
    if (!row.documentId) continue;
    const fixture = expected.get(row.documentId);
    if (!fixture) continue;
    const store = session.sdk.containerContents.documentLinks().openDocument({
      containerId,
      localId: row.id,
      documentId: row.documentId,
    });
    bytes += await session.tracer.span(`read ${fixture.document.key}`, () =>
      verifyDocument(session, store, fixture, row.id),
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
