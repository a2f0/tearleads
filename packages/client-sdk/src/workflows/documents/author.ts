import { createDocumentSignerDeviceId } from "../../data/documents/documentConstants";
import type { DocumentCreateAuthor } from "../../data/documents/shared/types";

interface DocumentAuthorRuntime {
  auth: {
    organizationId?: string | null;
    userId?: string | null;
  };
  crypto: {
    signingFingerprint?: string | null;
    signingKeyPair?:
      | {
          signingPrivateKey: Uint8Array;
        }
      | null
      | undefined;
  };
}

export function resolveDocumentCreateAuthor(
  runtime: DocumentAuthorRuntime,
): DocumentCreateAuthor | null {
  if (
    !runtime.auth.organizationId ||
    !runtime.crypto.signingFingerprint ||
    !runtime.crypto.signingKeyPair ||
    !runtime.auth.userId
  ) {
    return null;
  }

  return {
    organizationId: runtime.auth.organizationId,
    signerDeviceId: createDocumentSignerDeviceId(
      runtime.crypto.signingFingerprint,
    ),
    signerKeyFingerprint: runtime.crypto.signingFingerprint,
    signerPrivateKey: runtime.crypto.signingKeyPair.signingPrivateKey,
    signerUserId: runtime.auth.userId,
  };
}
