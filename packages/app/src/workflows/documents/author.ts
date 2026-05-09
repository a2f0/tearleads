import { createDocumentSignerDeviceId } from "../../data/documents/documentConstants";
import type { DocumentCreateAuthor } from "../../data/documents/shared/types";

export interface DocumentAuthorRuntime {
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

export function resolveDocumentCreateAuthor(
  runtime: DocumentAuthorRuntime,
): DocumentCreateAuthor | null {
  if (
    !runtime.organizationId ||
    !runtime.signingFingerprint ||
    !runtime.signingKeyPair ||
    !runtime.userId
  ) {
    return null;
  }

  return {
    organizationId: runtime.organizationId,
    signerDeviceId: createDocumentSignerDeviceId(runtime.signingFingerprint),
    signerKeyFingerprint: runtime.signingFingerprint,
    signerPrivateKey: runtime.signingKeyPair.signingPrivateKey,
    signerUserId: runtime.userId,
  };
}
