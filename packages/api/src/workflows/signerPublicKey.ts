import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";

interface StoredSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: string;
}

/** Request-scoped signer rows by user id, for walks over long histories. */
export type SignerCache = Map<string, Promise<StoredSigner | undefined>>;

async function selectSigner(
  executor: DatabaseSession,
  userId: string,
): Promise<StoredSigner | undefined> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

export async function loadSignerPublicKey(
  executor: DatabaseSession,
  input: {
    readonly error: (message: string, status: 403) => Error;
    readonly fingerprint: string;
    readonly userId: string;
  },
  cache?: SignerCache,
): Promise<Uint8Array> {
  let signer = cache?.get(input.userId);
  if (!signer) {
    signer = selectSigner(executor, input.userId);
    cache?.set(input.userId, signer);
  }
  const user = await signer;
  if (!user || user.fingerprint !== input.fingerprint) {
    throw input.error("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}
