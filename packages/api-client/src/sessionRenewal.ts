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
  private lastUnverifiedChange = 0;
  private sessionRequests = new AbortController();
  private renewalWaiters = new AbortController();
  private readonly sourceSignals = new WeakMap<
    AbortSignal,
    AbortSignal | undefined
  >();
  private readonly refusedSessions = new WeakSet<AbortSignal>();
  private known: { from: string; to: string } | null = null;
  private inFlight: {
    from: string;
    revision: number;
    previousUnverifiedChange: number;
    promise: Promise<boolean>;
  } | null = null;

  constructor(private readonly readToken: () => string | null) {}

  private provisionalRenewal() {
    const renewal = this.inFlight;
    return renewal && this.revision === renewal.revision + 1 ? renewal : null;
  }

  captureCredential(): () => boolean | Promise<boolean> {
    // A request born after the handler installs a candidate still belongs to
    // the last verified credential until that handler confirms the change.
    const revision = this.provisionalRenewal()?.revision ?? this.revision;
    return () => {
      const renewal = this.provisionalRenewal();
      if (renewal && renewal.previousUnverifiedChange <= revision)
        return renewal.promise;
      return this.lastUnverifiedChange <= revision;
    };
  }

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
    this.lastUnverifiedChange = this.revision;
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
    // An expiry on the candidate bearer joins its outstanding verification.
    // Only a sign-in boundary can release the slot before that callback settles.
    if (this.inFlight) return this.inFlight.promise;
    const confirmation = Promise.withResolvers<boolean>();
    const pending = {
      from,
      revision: this.revision,
      previousUnverifiedChange: this.lastUnverifiedChange,
      promise: confirmation.promise,
    };
    this.inFlight = pending;
    try {
      confirmation.resolve(this.complete(from, pending.revision, handler));
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
    const previousUnverifiedChange = this.lastUnverifiedChange;
    const renewed = await (handler?.() ?? false);
    if (session !== this.sessionRequests) return false;
    const to = this.readToken();
    // The trusted callback authenticates the same identity and installs one
    // replacement token. A second transition cannot borrow that renewal.
    if (renewed && to && from !== to && this.revision === revision + 1) {
      this.known = { from, to };
      // Requests keep their original ownership through consecutive verified
      // renewals without retaining a history of bearer tokens.
      this.lastUnverifiedChange = previousUnverifiedChange;
    }
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
