import { AsyncLocalStorage } from "node:async_hooks";

/** A users-table signer row. Its signing columns are never updated. */
export interface StoredSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: string;
}

/** Signer rows by user id, for one request or one transaction. */
export type SignerCache = Map<string, Promise<StoredSigner | undefined>>;

interface HistoryRequest {
  readonly beginVerification: (() => void) | undefined;
  /** Signer rows this request read on the root executor. */
  readonly signers: SignerCache;
  started: boolean;
}

const requests = new AsyncLocalStorage<HistoryRequest>();

/** Authentication installs a capability; ordinary handlers never invoke it. */
export function withPrincipalHistoryRequest<T>(
  beginVerification: (() => void) | undefined,
  work: () => T,
): T {
  return requests.run(
    { beginVerification, signers: new Map(), started: false },
    work,
  );
}

/** Shared policy workflows opt in, including indirect authorization reads. */
export function beginPrincipalHistoryVerification(): void {
  const request = requests.getStore();
  if (!request || request.started) return;
  request.started = true;
  request.beginVerification?.();
}

/** The current authenticated request's signer cache, if any. */
export function requestSignerCache(): SignerCache | undefined {
  return requests.getStore()?.signers;
}
