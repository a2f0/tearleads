import {
  type DatabaseSession,
  isDatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  requestSignerCache,
  type SignerCache,
  type StoredSigner,
} from "../../../utils/principalHistoryWork";

const transactionSigners = new WeakMap<DatabaseSession, SignerCache>();

// A user's fingerprint and signing key are never updated and users are never
// deleted, so one transaction needs each signer row once. The memo dies with
// the transaction, and a transaction never reads a request's rows. Root-executor
// reads share the authenticated request's cache, or else a cache their caller
// scopes to one request.
function signerCacheFor(
  executor: DatabaseSession,
  callerCache: SignerCache | undefined,
): SignerCache | undefined {
  if (!isDatabaseTransaction(executor)) {
    return requestSignerCache() ?? callerCache;
  }
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

/**
 * A user's signer row, read once per transaction or request. A miss or a
 * failed read is forgotten: a later statement may insert the user.
 */
export async function loadSignerRow(
  executor: DatabaseSession,
  userId: string,
  callerCache?: SignerCache,
): Promise<StoredSigner | undefined> {
  const cache = signerCacheFor(executor, callerCache);
  let signer = cache?.get(userId);
  if (!signer) {
    signer = selectSigner(executor, userId);
    cache?.set(userId, signer);
  }
  const forget = () => {
    if (cache?.get(userId) === signer) cache.delete(userId);
  };
  let user: StoredSigner | undefined;
  try {
    user = await signer;
  } catch (error) {
    forget();
    throw error;
  }
  if (!user) forget();
  return user;
}
