import {
  type BlobBytes,
  type DocumentAttachment,
  type DocumentSnapshot,
  type DocumentStore,
  type DocumentsWorkflowRuntime,
  resolveDocumentCreateAuthor,
  type Tearleads,
} from "@tearleads/client-sdk";

async function pull(store: DocumentStore) {
  if (!(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000))))
    throw new Error("Could not sync the seed document.");
  return store.getSnapshot();
}

function needsFixtureBytes(
  snapshot: DocumentSnapshot,
  fixture: DocumentAttachment,
) {
  const { slotId } = fixture;
  const recorded = snapshot.attachments.find((item) => item.slotId === slotId);
  const occupied = snapshot.attachmentStorageKeyBySlotId[slotId];
  if (recorded && occupied) {
    if (snapshot.attachmentStatusBySlotId[slotId] === "intent-mismatch")
      throw new Error(
        `The bound bytes differ from the edited attachment: ${recorded.name}. Resolve the attachment on the web, then run seed again.`,
      );
    return false;
  }
  // Only the digest and length select bytes. Renaming an attachment or
  // changing its MIME type leaves the authenticated plaintext unchanged.
  if (
    !recorded ||
    recorded.contentSha256 !== fixture.contentSha256 ||
    recorded.byteLength !== fixture.byteLength
  )
    return false;
  return true;
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
  input: { sdk: Tearleads; containerId: string },
  store: DocumentStore,
  attachments: readonly { bytes: BlobBytes; intent: DocumentAttachment }[],
  stillCurrent: () => boolean,
) {
  const first = await pull(store);
  if (!stillCurrent()) throw new Error("The Continuity writer scope changed.");
  const links = input.sdk.containerContents.documentLinks();
  const runtime = links.documentRuntime(input.containerId);
  const author = resolveDocumentCreateAuthor(runtime);
  const { documentId } = first;
  if (!documentId || !author)
    throw new Error("Missing seed document or writer");
  for (const [index, { bytes, intent }] of attachments.entries()) {
    const snapshot = index === 0 ? first : await pull(store);
    if (!needsFixtureBytes(snapshot, intent)) continue;
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
        if (!stillCurrent() || !needsFixtureBytes(await pull(store), intent))
          throw new Error(
            `The attachment changed during upload: ${intent.name}. Run seed again to resume.`,
          );
      },
      stillCurrent,
      isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
      resolveProjectionUserKey: links.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    });
    if (!uploaded || needsFixtureBytes(await pull(store), intent))
      throw new Error(
        `Could not upload seed attachment: ${intent.name}. Run seed again to resume.`,
      );
  }
}
