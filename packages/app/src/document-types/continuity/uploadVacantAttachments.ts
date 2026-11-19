import {
  type BlobBytes,
  type DetachDocumentAttachmentRequest,
  type DocumentAttachment,
  type DocumentSnapshot,
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

async function retireSeedBinding(
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

// Metadata-only edits may keep using the same bytes. Retire this import's
// binding when the edited document no longer claims those bytes.
async function inspectSeedSlot(
  snapshot: DocumentSnapshot,
  intent: DocumentAttachment,
  runtime: DocumentsWorkflowRuntime,
  mutation: Omit<DetachDocumentAttachmentRequest, "blobId">,
) {
  const recorded = snapshot.attachments.find(
    (item) => item.slotId === intent.slotId,
  );
  if (!recorded) {
    await retireSeedBinding(runtime, mutation);
    return false;
  }
  const occupied = snapshot.attachmentStorageKeyBySlotId[intent.slotId];
  if (
    occupied &&
    snapshot.attachmentStatusBySlotId[intent.slotId] !== "intent-mismatch"
  )
    return false;
  if (!matches(recorded, intent)) {
    await retireSeedBinding(runtime, mutation);
    return false;
  }
  if (occupied)
    throw new Error(
      `The bound bytes differ from the seed attachment: ${intent.name}. Run seed again after the edit syncs.`,
    );
  return true;
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
    if (!(await inspectSeedSlot(snapshot, intent, runtime, mutation))) continue;
    const result = await runtime.blobAttachments.uploadDocumentAttachment({
      ...mutation,
      bytes,
      expectedBindingId: null,
    });
    if (!result)
      throw new Error(
        `Could not upload seed attachment: ${intent.name}. Run seed again to resume.`,
      );
    // A successful bind can overlap an encrypted document edit. Verify the
    // new snapshot and reconcile just the binding this seed owns.
    snapshot = await pull(store);
    if (await inspectSeedSlot(snapshot, intent, runtime, mutation)) {
      throw new Error(
        `Could not verify uploaded seed attachment: ${intent.name}. Run seed again to resume.`,
      );
    }
  }
}
