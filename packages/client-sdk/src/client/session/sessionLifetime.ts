import type { BlobStore } from "../../data/blobs/blobContracts";
import { DatabaseUnavailableError } from "../../data/sqlite/availability/databaseUnavailable";
import { createScopedExecSql, type ExecSql } from "../../data/sqlite/sqlExec";
import { SessionAuthentication } from "./authenticationMachine";
import { createSessionBlobStore } from "./sessionBlobStore";
import type { SessionSnapshot } from "./sessionTypes";

export type SessionTransition = "boundary" | "renewal" | "renewal-refused";

export function sessionBoundary(
  previous: SessionSnapshot,
  next: SessionSnapshot,
  kind?: SessionTransition,
) {
  if (kind === "renewal-refused") return kind;
  if (kind === "boundary" || previous.isAuthenticated !== next.isAuthenticated)
    return "replacement";
  return undefined;
}

class SessionLifetime {
  epoch = 0;
  signInRevision = 0;
  signInCurrent = this.captureSignIn();
  readonly authentication = new SessionAuthentication();
  private hasSignedIn = false;
  onBoundary?: () => void;
  lastRenewal: SessionSnapshot | null = null;
  private stores = new WeakMap<BlobStore, BlobStore>();
  private executors = new WeakMap<ExecSql, ExecSql>();

  private captureSignIn(): () => boolean {
    const revision = this.signInRevision;
    return () => revision === this.signInRevision;
  }

  currentSignIn(purpose?: "restore"): () => boolean {
    const current = this.signInCurrent;
    if (purpose !== "restore") return current;
    const canRestore = this.authentication.captureRestore();
    return () => current() && canRestore();
  }

  guard(): () => void {
    const current = this.capture();
    return () => {
      if (!current())
        throw new DatabaseUnavailableError("Sign-in generation expired");
    };
  }

  capture(): () => boolean {
    const epoch = this.epoch;
    return () => this.epoch === epoch;
  }

  transition(wasSignedIn: boolean, signedIn: boolean): boolean {
    this.signInRevision += 1;
    this.signInCurrent = this.captureSignIn();
    this.authentication.invalidate();
    // The first sign-in adopts the device's unclaimed local work. A client
    // that has already had a sign-in gives every replacement a fresh scope.
    const retire = wasSignedIn || (signedIn && this.hasSignedIn);
    if (signedIn) this.hasSignedIn = true;
    if (!retire) return false;
    this.epoch += 1;
    this.stores = new WeakMap();
    this.executors = new WeakMap();
    return true;
  }

  bindBlobStore(store: BlobStore): BlobStore {
    const existing = this.stores.get(store);
    if (existing) return existing;
    const bound = createSessionBlobStore(store, this.guard());
    this.stores.set(store, bound);
    return bound;
  }

  bind(execSql: ExecSql): ExecSql {
    const existing = this.executors.get(execSql);
    if (existing) return existing;
    const bound = createScopedExecSql(execSql, this.guard());
    this.executors.set(execSql, bound);
    return bound;
  }
}

const lifetimes = new WeakMap<object, SessionLifetime>();

/** Private to the SDK: session epochs are process-local and never restored. */
export function sessionLifetime(session: object): SessionLifetime {
  let lifetime = lifetimes.get(session);
  if (!lifetime) {
    lifetime = new SessionLifetime();
    lifetimes.set(session, lifetime);
  }
  return lifetime;
}
