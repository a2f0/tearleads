import {
  type BlobBytes,
  type DocumentAttachment,
  type DocumentSnapshot,
  type DocumentStore,
  type DocumentsWorkflowRuntime,
  resolveDocumentCreateAuthor,
  type Tearleads,
} from "@tearleads/client-sdk";

import { requireFoundingSeed } from "./foundingSeed";
import type { SeedDocument } from "./seedDocuments";

async function pull(store: DocumentStore, stillCurrent: () => boolean) {
  if (!stillCurrent()) throw new Error("The Continuity writer scope changed.");
  if (!(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000))))
    throw new Error("Could not sync the seed document.");
  if (!stillCurrent()) throw new Error("The Continuity writer scope changed.");
  return store.getSnapshot();
}

function fixtureAttachmentState(
  snapshot: DocumentSnapshot,
  fixture: DocumentAttachment,
) {
  const { slotId } = fixture;
  const recorded = snapshot.attachments.find((item) => item.slotId === slotId);
  const occupied = snapshot.attachmentStorageKeyBySlotId[slotId];
  if (
    recorded &&
    occupied &&
    snapshot.attachmentStatusBySlotId[slotId] === "intent-mismatch"
  )
    throw new Error(
      `The bound bytes differ from the edited attachment: ${recorded.name}. Resolve the attachment on the web, then run seed again.`,
    );
  // Only the digest and length select bytes. Renaming an attachment or
  // changing its MIME type leaves the authenticated plaintext unchanged.
  if (
    !recorded ||
    recorded.contentSha256 !== fixture.contentSha256 ||
    recorded.byteLength !== fixture.byteLength
  )
    return "changed";
  return occupied ? "held" : "missing";
}

function uploadResultMessage(
  result: "held" | "changed",
  name: string,
  started: number,
) {
  return result === "held"
    ? `confirmed ${name} in ${Math.round(performance.now() - started)}ms`
    : `uploaded ${name} (slot changed before confirmation)`;
}

async function requireVacantBinding(
  runtime: DocumentsWorkflowRuntime,
  documentId: string,
  intent: DocumentAttachment,
) {
  const bindings = await runtime.apiClient.listDocumentAttachments(documentId, {
    refresh: true,
  });
  if (!bindings) throw new Error("Could not verify seed attachment bindings.");
  if (bindings.some((binding) => binding.slotId === intent.slotId))
    throw new Error(
      `The bound attachment could not be verified locally: ${intent.name}. Run seed again when the bytes are available.`,
    );
}

/** Upload only into a vacant slot whose signed content still identifies the fixture. */
export async function uploadVacantAttachments(
  input: {
    sdk: Tearleads;
    containerId: string;
    document: SeedDocument;
    /** A placement found from an earlier run, whose founding must be proven. */
    existing?: { localId: string } | undefined;
    traceAttachment?: (event: string) => void;
  },
  store: DocumentStore,
  attachments: readonly { bytes: BlobBytes; intent: DocumentAttachment }[],
  stillCurrent: () => boolean,
  seedTag: string,
) {
  const first = await pull(store, stillCurrent);
  const links = input.sdk.containerContents.documentLinks();
  const runtime = links.documentRuntime(input.containerId);
  const author = resolveDocumentCreateAuthor(runtime);
  const { documentId } = first;
  if (!documentId || !author)
    throw new Error("Missing seed document or writer");
  // A create in this run already had its exact seed acknowledged.
  if (input.existing)
    await requireFoundingSeed({
      sdk: input.sdk,
      document: input.document,
      localId: input.existing.localId,
      writerUserId: author.signerUserId,
      seedTag,
      intents: attachments.map(({ intent }) => intent),
      stillCurrent,
    });
  for (const [index, { bytes, intent }] of attachments.entries()) {
    const snapshot = index === 0 ? first : await pull(store, stillCurrent);
    if (fixtureAttachmentState(snapshot, intent) !== "missing") {
      input.traceAttachment?.(`skipped ${intent.name} (held or edited slot)`);
      continue;
    }
    const started = performance.now();
    input.traceAttachment?.(
      `uploading ${intent.name} (${bytes.byteLength} bytes)`,
    );
    await requireVacantBinding(runtime, documentId, intent);
    if (!stillCurrent())
      throw new Error("The Continuity writer scope changed.");
    const uploaded = await runtime.blobAttachments.uploadDocumentAttachment({
      author,
      bytes,
      documentId,
      slotId: intent.slotId,
      expectedBindingId: null,
      // Staging can take time. Recheck before sending the encrypted parts.
      onStageResolved: async () => {
        input.traceAttachment?.(`stage opened for ${intent.name}`);
        if (
          !stillCurrent() ||
          fixtureAttachmentState(await pull(store, stillCurrent), intent) !==
            "missing"
        )
          throw new Error(
            `The attachment changed during upload: ${intent.name}. Run seed again to resume.`,
          );
      },
      stillCurrent,
      isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
      resolveProjectionUserKey: links.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    });
    const result =
      uploaded &&
      fixtureAttachmentState(await pull(store, stillCurrent), intent);
    if (!result || result === "missing")
      throw new Error(
        `Could not upload seed attachment: ${intent.name}. Run seed again to resume.`,
      );
    input.traceAttachment?.(uploadResultMessage(result, intent.name, started));
  }
}
