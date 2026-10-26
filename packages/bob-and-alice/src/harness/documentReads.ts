import type { DocumentStore } from "@tearleads/client-sdk";
import type { Device } from "./device";

interface DocumentRef {
  readonly documentId: string;
  readonly containerId: string;
}

/**
 * Opens `document` on `device` the way a host would: the copy already held
 * locally, or else the one discovery finds in its container. Returns null
 * when the device has never seen the document and cannot discover it.
 */
export async function readDocument(
  device: Device,
  document: DocumentRef,
): Promise<DocumentStore | null> {
  let localId = await device.sdk.documents.findLocalIdByDocumentId(
    document.documentId,
  );
  if (!localId) {
    const tree = await device.tree();
    await tree.refresh().catch(() => false);
    const discovered = await device.sdk.containerContents
      .discoverContainerDocuments(document.containerId)
      .catch(() => null);
    localId =
      discovered?.find((summary) => summary.documentId === document.documentId)
        ?.id ?? null;
  }
  if (!localId) return null;
  const store = device.sdk.documents.open(
    {
      containerId: document.containerId,
      documentId: document.documentId,
      localId,
    },
    { remoteSyncMode: "on-demand" },
  );
  await store
    .requestRemoteSyncAndWait(new AbortController().signal)
    .catch(() => false);
  return store;
}

/** The text `device` ends up with after one pull, or null if it has none. */
export async function readText(
  device: Device,
  document: DocumentRef,
): Promise<string | null> {
  const store = await readDocument(device, document);
  const text = store?.getSnapshot().text ?? "";
  return text === "" ? null : text;
}
