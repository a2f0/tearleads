import type { BlobInfo } from "@symcrypt/client-sdk";
import { createContext, type PropsWithChildren, useContext } from "react";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";

// A document-types-owned seam for "choose an existing blob for a slot". The
// host (currently the Explorer mini-app, via its blob-browser panel) supplies
// the implementation; document types stay unaware of where blobs are browsed,
// keeping the document-types → mini-apps dependency from inverting.
export interface DocumentBlobPickRequest {
  containerId: string;
  // localId of the document the pick should return to.
  localId: string;
  slot: DocumentAttachmentSlot;
}

interface DocumentBlobPickContextValue {
  // Opens the host's blob picker for the request's slot.
  requestBlobPick: (request: DocumentBlobPickRequest) => void;
  // Reads and clears any blob the host picked for the given document slot.
  // Returns null when nothing was picked for it.
  consumeBlobPick: (localId: string, slotId: string) => BlobInfo | null;
  // Resolves how many blobs exist in the container the picker would browse (the
  // pool it can offer). Lets a document hide "Choose Blob" when there is nothing
  // to pick, so the affordance never routes to an empty picker.
  loadPickableBlobCount: () => Promise<number>;
}

const DocumentBlobPickContext =
  createContext<DocumentBlobPickContextValue | null>(null);

export function DocumentBlobPickProvider(
  params: PropsWithChildren<{ value: DocumentBlobPickContextValue }>,
) {
  return (
    <DocumentBlobPickContext.Provider value={params.value}>
      {params.children}
    </DocumentBlobPickContext.Provider>
  );
}

// Returns null when no host provider is mounted (e.g. a document rendered
// standalone), so the "Choose Blob" affordance is simply unavailable.
export function useDocumentBlobPick(): DocumentBlobPickContextValue | null {
  return useContext(DocumentBlobPickContext);
}
