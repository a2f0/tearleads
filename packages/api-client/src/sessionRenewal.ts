import {
  authChallengeSigningBytes,
  canonicalAuthOrigin,
} from "@tearleads/crypto";
import type { RequestResultOptions } from "./types";

export function sessionAuthChallengeBytes(
  baseUrl: string,
  challengeHex: string,
  fingerprint: string,
): Uint8Array {
  let apiOrigin: string;
  try {
    apiOrigin = canonicalAuthOrigin(
      new URL(baseUrl || "/", globalThis.location?.href).href,
    );
  } catch {
    throw new Error("The API origin is unavailable for authentication");
  }
  return authChallengeSigningBytes({ apiOrigin, challengeHex, fingerprint });
}

export type SessionBoundary = "replacement" | "renewal-refused";

type RenewSession = (() => boolean | Promise<boolean>) | null;

/** An identity change invalidates renewal evidence, including an awaited callback. */
export class SessionRenewalTracker {
  private revision = 0;
  private sessionRequests = new AbortController();
  private renewalWaiters = new AbortController();
  private readonly sourceSignals = new WeakMap<
    AbortSignal,
    AbortSignal | undefined
  >();
  private readonly refusedSessions = new WeakSet<AbortSignal>();
  private known: { from: string; to: string } | null = null;
  private inFlight: { from: string; promise: Promise<boolean> } | null = null;

  constructor(private readonly readToken: () => string | null) {}

  get signal(): AbortSignal {
    return this.sessionRequests.signal;
  }

  withSessionSignal(options: RequestResultOptions): RequestResultOptions {
    const scoped = withSignal(options, this.sessionRequests.signal);
    this.sourceSignals.set(scoped.signal, this.callerSignal(options));
    return scoped;
  }

  withRenewalWaitSignal(options: RequestResultOptions): RequestResultOptions {
    return withSignal(
      { ...options, signal: this.callerSignal(options) },
      this.renewalWaiters.signal,
    );
  }

  private callerSignal(options: RequestResultOptions): AbortSignal | undefined {
    const signal = options.signal;
    return signal && this.sourceSignals.has(signal)
      ? this.sourceSignals.get(signal)
      : signal;
  }

  refused(session: AbortSignal): boolean {
    return this.refusedSessions.has(session);
  }

  tokenChanged(boundary?: SessionBoundary): void {
    if (boundary) {
      if (boundary === "renewal-refused") {
        this.refusedSessions.add(this.sessionRequests.signal);
      } else {
        this.renewalWaiters.abort();
        this.renewalWaiters = new AbortController();
      }
      this.sessionRequests.abort();
      this.sessionRequests = new AbortController();
      this.inFlight = null;
    }
    this.revision += 1;
    this.known = null;
  }

  isKnown(from: string, to: string): boolean {
    return this.known?.from === from && this.known.to === to;
  }

  currentToken(from: string | null): string | null {
    const token = this.readToken();
    return from && token && this.isKnown(from, token) ? token : null;
  }

  pending(from: string): Promise<boolean> | null {
    return this.inFlight?.from === from ? this.inFlight.promise : null;
  }

  async renew(handler: RenewSession): Promise<boolean> {
    const from = this.readToken();
    if (!from) return false;
    const existing = this.pending(from);
    if (existing) return existing;
    const pending = {
      from,
      promise: this.complete(from, this.revision, handler),
    };
    this.inFlight = pending;
    try {
      return await pending.promise;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  private async complete(
    from: string,
    revision: number,
    handler: RenewSession,
  ): Promise<boolean> {
    const session = this.sessionRequests;
    const renewed = await (handler?.() ?? false);
    if (session !== this.sessionRequests) return false;
    const to = this.readToken();
    // The trusted callback authenticates the same identity and installs one
    // replacement token. A second transition cannot borrow that renewal.
    if (renewed && to && from !== to && this.revision === revision + 1)
      this.known = { from, to };
    return renewed;
  }
}

function withSignal(options: RequestResultOptions, sessionSignal: AbortSignal) {
  return {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, sessionSignal])
      : sessionSignal,
  };
}
