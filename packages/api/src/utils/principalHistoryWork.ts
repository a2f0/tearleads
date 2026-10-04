import { AsyncLocalStorage } from "node:async_hooks";

interface HistoryRequest {
  readonly beginVerification: (() => void) | undefined;
  started: boolean;
}

const requests = new AsyncLocalStorage<HistoryRequest>();

/** Authentication installs a capability; ordinary handlers never invoke it. */
export function withPrincipalHistoryRequest<T>(
  beginVerification: (() => void) | undefined,
  work: () => T,
): T {
  return requests.run({ beginVerification, started: false }, work);
}

/** Shared policy workflows opt in, including indirect authorization reads. */
export function beginPrincipalHistoryVerification(): void {
  const request = requests.getStore();
  if (!request || request.started) return;
  request.started = true;
  request.beginVerification?.();
}
