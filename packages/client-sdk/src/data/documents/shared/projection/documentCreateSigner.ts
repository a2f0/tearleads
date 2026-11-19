import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  readAccessEvent,
  readAccessManifest,
} from "../../../keyingProjectionVerification/readers";

/**
 * A retry after a lost create response can only recover the local user's own
 * create: the server serves whatever document holds the stable id we minted,
 * and an honest server only ever committed ours under it. A create event signed
 * by anyone else is a foreign document colliding on that id (a member with
 * write access on the same container, or a dishonest server), which must not be
 * adopted as if it were the pending local write.
 *
 * The create event is located by walking the served head's predecessor chain,
 * not by scanning the history for any parentless manifest: the history is
 * server-supplied, so a dishonest server could splice in a genesis this user
 * signed for a different document. Every manifest on the chain must also name
 * the requested document.
 */
export function assertDocumentCreateSigner(
  input: { documentId: string; expectedSignerUserId: string },
  writerProjection: DocumentWriterProjectionResponse,
): void {
  const label = "Document create conflict";
  const historyByHash = new Map(
    writerProjection.documentManifestHistory.map((bundle) => [
      bundle.manifestHash,
      bundle,
    ]),
  );
  const visited = new Set<string>();
  let bundle = writerProjection.documentManifest;
  for (;;) {
    const manifest = readAccessManifest(bundle.manifest, `${label} manifest`);
    if (
      manifest.objectKind !== "document" ||
      manifest.objectId !== input.documentId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${label} manifest chain names another document`,
      );
    }
    if (manifest.previousManifestHash === null) {
      const createEvent = readAccessEvent(
        bundle.event.event,
        `${label} create event`,
      );
      if (createEvent.signerUserId !== input.expectedSignerUserId) {
        throw new KeyingVerificationError(
          "signer_mismatch",
          `${label} create event was signed by another user`,
        );
      }
      return;
    }
    if (visited.has(bundle.manifestHash)) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `${label} manifest history is cyclic`,
      );
    }
    visited.add(bundle.manifestHash);
    const previous = historyByHash.get(manifest.previousManifestHash);
    if (!previous) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `${label} does not expose its create event`,
      );
    }
    bundle = previous;
  }
}
