import { Buffer } from "node:buffer";
import { hkdfSync, randomBytes } from "node:crypto";
import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import {
  PRINCIPAL_HISTORY_VERIFICATION_REVISION,
  type PrincipalPolicyHistoryInput,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { readConfiguredDocumentSyncCursorHmacKey } from "../../utils/serverSecrets";
import { sha256Hex } from "../../utils/sha256";

// Bump when stored signer resolution or authority-shape rules tighten. Crypto
// binds its own rule revision as well. Old generations are never lookup hits.
const STORED_PRINCIPAL_HISTORY_REVISION = 1;
const DOMAIN = "tearleads.stored-principal-history.v1";
const processKey = randomBytes(32);
let derived: { readonly secret: string; readonly key: Buffer } | undefined;

function localKey(): Uint8Array {
  const secret = readConfiguredDocumentSyncCursorHmacKey();
  if (secret === null) return new Uint8Array(processKey);
  if (derived?.secret !== secret) {
    derived?.key.fill(0);
    derived = {
      secret,
      key: Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), DOMAIN, 32)),
    };
  }
  return new Uint8Array(derived.key);
}

/** Private server capability, never derived from a request or database row. */
export function principalHistoryProtection(
  input: Pick<
    PrincipalPolicyHistoryInput,
    "principalType" | "principalId" | "retainedReferences"
  >,
  verificationKind: PrincipalHistoryVerificationKind,
) {
  const context = serializeKeyingCanonicalJson([
    DOMAIN,
    STORED_PRINCIPAL_HISTORY_REVISION,
    PRINCIPAL_HISTORY_VERIFICATION_REVISION,
    verificationKind,
  ]);
  const key = localKey();
  const references = [...(input.retainedReferences ?? [])].sort(
    (left, right) => left.version - right.version,
  );
  const inputHash = sha256Hex(
    serializeKeyingCanonicalJson([
      input.principalType,
      input.principalId,
      references.map((head) => [
        head.principalType,
        head.principalId,
        head.version,
        head.keyEpoch,
        head.stateHash,
        head.keyFingerprint,
      ]),
    ]),
  );
  return {
    protection: { localKey: key, context },
    scope: {
      principalType: input.principalType,
      principalId: input.principalId,
      verificationKind,
      inputHash,
      protectionId: sha256Hex(
        serializeKeyingCanonicalJson([context, sha256Hex(key)]),
      ),
    },
  };
}
