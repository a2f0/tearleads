import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { base64ToBytes } from "@tearleads/encoding";
import { loadSignerRow } from "../access/read/signerRows";
import type { SignerCache } from "../utils/principalHistoryWork";

export type { SignerCache };

export async function loadSignerPublicKey(
  executor: DatabaseSession,
  input: {
    readonly error: (message: string, status: 403) => Error;
    readonly fingerprint: string;
    readonly userId: string;
  },
  requestCache?: SignerCache,
): Promise<Uint8Array> {
  const user = await loadSignerRow(executor, input.userId, requestCache);
  if (!user || user.fingerprint !== input.fingerprint) {
    throw input.error("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}
