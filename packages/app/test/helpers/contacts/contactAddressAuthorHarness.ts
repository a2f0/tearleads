import type { DocumentsRuntime } from "@tearleads/client-sdk";
import {
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { createAddressRetryHarness } from "./contactAddressRetryHarness";

type Harness = Awaited<ReturnType<typeof createAddressRetryHarness>>;

// Load the signer before authentication, so signing in does not replace the
// fingerprint, database executor or domain. This models an offline, same-store
// author transition, not a real server login or registration.
export async function prepareAddressAuthor(f: Harness) {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const loaded = {
    ...f.runtime.documents,
    crypto: {
      ...f.runtime.documents.crypto,
      signingKeyPair,
      signingFingerprint,
    },
  };
  const runtimeFor = (userId: string | null): DocumentsRuntime => ({
    ...loaded,
    auth: {
      ...loaded.auth,
      isAuthenticated: userId !== null,
      organizationId: userId === null ? null : "address-organization",
      userId,
    },
  });
  const apply = (userId: string | null) => {
    const documents = runtimeFor(userId);
    f.store.updateRuntime({ ...f.runtime, documents });
    f.changeWriteScope();
    return documents;
  };
  apply(null);
  return { apply, runtimeFor };
}
