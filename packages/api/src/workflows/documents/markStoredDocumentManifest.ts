import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import { createContainerWriterProjectionContext } from "../containers/writerProjection/context";
import { toManifestBundleResponse } from "../containers/writerProjection/records";
import { databaseVerificationMarkerStore } from "../containers/writerProjection/verificationMarkers";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "./storedDocumentManifestVerification";

/**
 * Run the stored-history verifier over a document manifest this transaction
 * just stored, and write the markers for it and its unmarked document history.
 * Container markers the walk earns are not written: this transaction holds
 * its document lock and container heads for share, not the organization lock
 * container mutations mark under, and document marker rows belong to one
 * document whose writers that lock already serializes.
 */
export async function markStoredDocumentManifest(
  executor: DatabaseSession,
  manifestHash: string,
): Promise<void> {
  const stored = await getAccessManifestBundle(manifestHash, executor);
  if (stored?.manifest.objectKind !== "document") {
    throw new StoredDocumentManifestError(
      "stored document manifest is missing",
    );
  }
  const documentMarkers = databaseVerificationMarkerStore(executor, {
    recordsMarkers: true,
  });
  await verifyStoredDocumentManifest({
    bundle: toManifestBundleResponse(stored),
    containerContext: createContainerWriterProjectionContext(executor),
    documentMarkers,
  });
  await documentMarkers.flush();
}
