import {
  type DatabaseSession,
  isDatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";

interface StoredSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: string;
}

/** Request-scoped signer rows by user id, for walks over long histories. */
export type SignerCache = Map<string, Promise<StoredSigner | undefined>>;

const transactionSigners = new WeakMap<DatabaseSession, SignerCache>();

// A user's fingerprint and signing key are never updated and users are never
// deleted, so one transaction needs each signer row once. The cache dies with
// the transaction; root-executor reads only share a cache their caller scopes
// to one request.
function signerCacheFor(
  executor: DatabaseSession,
  requestCache: SignerCache | undefined,
): SignerCache | undefined {
  if (!isDatabaseTransaction(executor)) return requestCache;
  const existing = transactionSigners.get(executor);
  if (existing) return existing;
  const cache: SignerCache = new Map();
  transactionSigners.set(executor, cache);
  return cache;
}

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
  requestCache?: SignerCache,
): Promise<Uint8Array> {
  const cache = signerCacheFor(executor, requestCache);
  let signer = cache?.get(input.userId);
  if (!signer) {
    signer = selectSigner(executor, input.userId);
    cache?.set(input.userId, signer);
  }
  const user = await signer;
  if (!user) {
    // A later statement in the same transaction may insert this user.
    if (cache?.get(input.userId) === signer) cache.delete(input.userId);
    throw input.error("Forbidden", 403);
  }
  if (user.fingerprint !== input.fingerprint) {
    throw input.error("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}
