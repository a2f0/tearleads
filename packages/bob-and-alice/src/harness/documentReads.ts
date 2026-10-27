import type { DocumentStore } from "@tearleads/client-sdk";
import type { Device } from "./device";

interface DocumentRef {
  readonly documentId: string;
  /** Every container the document is linked into, any of which may grant. */
  readonly containerIds: readonly string[];
}

async function discover(
  device: Device,
  document: DocumentRef,
): Promise<{ containerId: string; localId: string } | null> {
  const tree = await device.tree();
  await tree.refresh().catch(() => false);
  // Start from folders this device discovered, never a folder id supplied by
  // the reference model. Otherwise a broken shared tree can pass cold reads.
  for (const { id: containerId } of tree.getSnapshot().nodes) {
    if (!document.containerIds.includes(containerId)) continue;
    const discovered = await device.sdk.containerContents
      .discoverContainerDocuments(containerId)
      .catch(() => null);
    const summary = discovered?.find(
      (candidate) => candidate.documentId === document.documentId,
    );
    if (summary) return { containerId, localId: summary.id };
  }
  return null;
}

/**
 * Opens `document` on `device` the way a host would: the copy already held
 * locally, or else the one discovery finds through a linked container.
 * Returns null when the device has never seen the document and cannot
 * discover it.
 */
export async function readDocument(
  device: Device,
  document: DocumentRef,
): Promise<DocumentStore | null> {
  const localId = await device.sdk.documents.findLocalIdByDocumentId(
    document.documentId,
  );
  const held = localId
    ? (await device.sdk.documents.list())?.rows.find(
        (row) => row.id === localId,
      )
    : undefined;
  const found = localId
    ? {
        containerId: held?.containerId ?? document.containerIds[0] ?? null,
        localId,
      }
    : await discover(device, document);
  if (!found) return null;
  const store = device.sdk.documents.open(
    {
      containerId: found.containerId,
      documentId: document.documentId,
      localId: found.localId,
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
  return store?.getSnapshot().text ?? null;
}
