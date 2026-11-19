import {
  type BlobBytes,
  type DetachDocumentAttachmentRequest,
  type DocumentAttachment,
  type DocumentStore,
  type DocumentsWorkflowRuntime,
  deriveStableDocumentId,
  resolveDocumentCreateAuthor,
  type Tearleads,
} from "@tearleads/client-sdk";

async function pull(store: DocumentStore) {
  if (!(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000)))) {
    throw new Error("Could not sync the seed document.");
  }
  return store.getSnapshot();
}

function matches(
  recorded: DocumentAttachment | undefined,
  intent: DocumentAttachment,
) {
  return (
    recorded?.contentSha256 === intent.contentSha256 &&
    recorded.name === intent.name &&
    recorded.mimeType === intent.mimeType &&
    recorded.byteLength === intent.byteLength
  );
}

async function retireRemovedSeedBinding(
  runtime: DocumentsWorkflowRuntime,
  mutation: Omit<DetachDocumentAttachmentRequest, "blobId">,
) {
  const bindings = await runtime.apiClient.listDocumentAttachments(
    mutation.documentId,
    { refresh: true },
  );
  if (!bindings) throw new Error("Could not verify seed attachment bindings.");
  const own = bindings.find(
    (binding) =>
      binding.bindingId === mutation.bindingId &&
      binding.slotId === mutation.slotId,
  );
  if (!own) return;
  if (
    !(await runtime.blobAttachments.detachDocumentAttachment({
      ...mutation,
      blobId: own.blobId,
    }))
  ) {
    throw new Error("Could not retire the removed seed attachment.");
  }
}

/** Bind bytes without ever authoring a second document-content update. */
export async function uploadVacantAttachments(
  input: { sdk: Tearleads; containerId: string; localId: string },
  store: DocumentStore,
  attachments: readonly { bytes: BlobBytes; intent: DocumentAttachment }[],
) {
  let snapshot = await pull(store);
  const documentId = snapshot.documentId;
  const links = input.sdk.containerContents.documentLinks();
  const runtime = links.documentRuntime(input.containerId);
  const author = resolveDocumentCreateAuthor(runtime);
  if (!documentId || !author)
    throw new Error("Missing seed document or writer");
  for (const { bytes, intent } of attachments) {
    const { slotId } = intent;
    const recorded = snapshot.attachments.find(
      (item) => item.slotId === slotId,
    );
    const bindingId = await deriveStableDocumentId(
      `${input.localId}/binding/${slotId}`,
    );
    const mutation = {
      author,
      documentId,
      slotId,
      bindingId,
      resolveProjectionUserKey: links.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    };
    // Also handles a previous run that stopped after committing a bind.
    if (!recorded) {
      await retireRemovedSeedBinding(runtime, mutation);
      continue;
    }
    if (snapshot.attachmentStorageKeyBySlotId[slotId]) continue;
    if (!matches(recorded, intent))
      throw new Error(`Could not recover edited attachment: ${intent.name}`);
    const result = await runtime.blobAttachments.uploadDocumentAttachment({
      ...mutation,
      bytes,
      expectedBindingId: null,
    });
    if (!result)
      throw new Error(
        `Could not upload seed attachment: ${intent.name}. Run seed again to resume.`,
      );
    // A removal of an unbound slot changes only the encrypted document. It
    // can race even a successful vacant bind. Retire only our own binding.
    snapshot = await pull(store);
    if (!snapshot.attachments.some((item) => item.slotId === slotId)) {
      await retireRemovedSeedBinding(runtime, mutation);
    }
  }
}
