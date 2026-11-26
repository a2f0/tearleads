import type { WriteHeader } from "@tearleads/crypto";
import { sha256Hex } from "../utils/sha256";

/**
 * One hash of every write-header field that decides whether its writer may
 * write: the object, the access manifest and key-target set it was signed
 * for, the content-key epoch and suite, the writer and signing key, and the
 * container manifests it cites. Two headers with the same hash are
 * authorized, or refused, by exactly the same checks.
 *
 * A staged segment's header cannot be authorized when it is staged, because
 * the manifest a rotation writes does not exist yet. The commit verifies its
 * own final segment in full and then requires this hash of every staged
 * header to equal the final segment's, in one statement over the stage. The
 * fields that differ between segments (the content record, its hashes and
 * nonce domain, the signing time and the signature) are not in it; the
 * device id is not either, since no check reads it.
 */
export function writeHeaderAuthorizationHash(header: WriteHeader): string {
  return sha256Hex(
    JSON.stringify([
      "tearleads.document.write-header-authorization.v1",
      header.version,
      header.organizationId,
      header.objectKind,
      header.objectId,
      header.accessManifestHash,
      header.targetHash,
      header.contentKeyEpoch,
      header.encryptionSuite,
      header.writerUserId,
      header.writerKeyFingerprint,
      [...header.dependencyManifestHashes],
    ]),
  );
}
