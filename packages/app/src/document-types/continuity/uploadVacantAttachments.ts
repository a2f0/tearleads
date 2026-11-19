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
  if (!(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000))))
    throw new Error("Could not sync the seed document.");
  return store.getSnapshot();
}

function slotAction(snapshot: DocumentSnapshot, fixture: DocumentAttachment) {
  const { slotId } = fixture;
  const recorded = snapshot.attachments.find((item) => item.slotId === slotId);
  const occupied = snapshot.attachmentStorageKeyBySlotId[slotId];
  if (
    recorded &&
    occupied &&
    snapshot.attachmentStatusBySlotId[slotId] !== "intent-mismatch"
  )
    return "complete";
  if (
    !recorded ||
    recorded.contentSha256 !== fixture.contentSha256 ||
    recorded.name !== fixture.name ||
    recorded.mimeType !== fixture.mimeType ||
    recorded.byteLength !== fixture.byteLength
  )
    return "retire";
  if (occupied)
    throw new Error(
      `The bound bytes differ from the seed attachment: ${fixture.name}. Run seed again after the edit syncs.`,
    );
  return "upload";
}

type SlotMutation = Omit<
  DetachDocumentAttachmentRequest,
  "blobId" | "bindingId"
>;

// Every upload has its own binding ID. The secret seed ID lets a later run
// recognize its own signed binding after an interrupted upload.
function seedBindingId(localId: string, slotId: string, blobId: string) {
  return deriveStableDocumentId(`${localId}/binding/${slotId}/${blobId}`);
}

async function loadSeedBinding(
  runtime: DocumentsWorkflowRuntime,
  mutation: SlotMutation,
  localId: string,
) {
  const bindings = await runtime.apiClient.listDocumentAttachments(
    mutation.documentId,
    { refresh: true },
  );
  if (!bindings) throw new Error("Could not verify seed attachment bindings.");
  const observed = bindings.find(
    (binding) => binding.slotId === mutation.slotId,
  );
  if (
    observed &&
    observed.bindingId ===
      (await seedBindingId(localId, mutation.slotId, observed.blobId))
  )
    return observed;
  return null;
}

async function bindSeedBytes(
  runtime: DocumentsWorkflowRuntime,
  mutation: SlotMutation,
  localId: string,
  fixture: DocumentAttachment,
  bytes: BlobBytes,
) {
  const blobId = crypto.randomUUID();
  const uploaded = await runtime.blobAttachments.uploadDocumentAttachment({
    ...mutation,
    blobId,
    bindingId: await seedBindingId(localId, fixture.slotId, blobId),
    bytes,
    expectedBindingId: null,
  });
  if (!uploaded)
    throw new Error(
      `Could not upload seed attachment: ${fixture.name}. Run seed again to resume.`,
    );
}

async function reconcileSlot(
  store: DocumentStore,
  runtime: DocumentsWorkflowRuntime,
  mutation: SlotMutation,
  localId: string,
  fixture: DocumentAttachment,
  bytes: BlobBytes,
) {
  // A successful bind or detach can overlap a remote document edit. Re-read
  // after either mutation and bound the work when a slot is actively edited.
  for (let attempt = 0; attempt < 4; attempt++) {
    const action = slotAction(await pull(store), fixture);
    if (action === "complete") return;
    if (action === "upload") {
      await bindSeedBytes(runtime, mutation, localId, fixture, bytes);
      continue;
    }
    const observed = await loadSeedBinding(runtime, mutation, localId);
    if (!observed) return;
    // Capture the exact generation before verifying the current intent. The
    // API refuses a detach if a newer binding replaces this generation.
    if (slotAction(await pull(store), fixture) !== "retire") continue;
    const detached = await runtime.blobAttachments.detachDocumentAttachment({
      ...mutation,
      bindingId: observed.bindingId,
      blobId: observed.blobId,
    });
    if (!detached)
      throw new Error(
        `Could not retire stale seed attachment: ${fixture.name}.`,
      );
  }
  const final = slotAction(await pull(store), fixture);
  if (
    final === "complete" ||
    (final === "retire" && !(await loadSeedBinding(runtime, mutation, localId)))
  )
    return;
  throw new Error(
    `The attachment kept changing: ${fixture.name}. Run seed again to resume.`,
  );
}

/** Bind bytes without authoring a second document-content update. */
export async function uploadVacantAttachments(
  input: { sdk: Tearleads; containerId: string; localId: string },
  store: DocumentStore,
  attachments: readonly { bytes: BlobBytes; intent: DocumentAttachment }[],
) {
  const { documentId } = await pull(store);
  const links = input.sdk.containerContents.documentLinks();
  const runtime = links.documentRuntime(input.containerId);
  const author = resolveDocumentCreateAuthor(runtime);
  if (!documentId || !author)
    throw new Error("Missing seed document or writer");
  for (const { bytes, intent } of attachments) {
    await reconcileSlot(
      store,
      runtime,
      {
        author,
        documentId,
        slotId: intent.slotId,
        resolveProjectionUserKey: links.resolveProjectionUserKey,
        warmReferencedPrincipalPolicies:
          runtime.principalPolicies.createWarmer(),
      },
      input.localId,
      intent,
      bytes,
    );
  }
}
