import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import { createMarkingVerificationContext } from "../containers/writerProjection/markStoredManifest";
import { toManifestBundleResponse } from "../containers/writerProjection/records";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "./storedDocumentManifestVerification";

/**
 * Run the stored-history verifier over a document manifest this transaction
 * just stored and mark it, with any unmarked history it depends on. See
 * `markStoredContainerManifest`.
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
  const containerContext = createMarkingVerificationContext(executor);
  await verifyStoredDocumentManifest({
    bundle: toManifestBundleResponse(stored),
    containerContext,
  });
  await containerContext.verificationMarkers.flush?.();
}
