import type { BlobStore } from "../../data/blobs/blobContracts";
import { DatabaseUnavailableError } from "../../data/sqlite/availability/databaseUnavailable";
import { createScopedExecSql, type ExecSql } from "../../data/sqlite/sqlExec";
import { SessionAuthentication } from "./authenticationMachine";
import { createSessionBlobStore } from "./sessionBlobStore";
import type { SessionSnapshot } from "./sessionTypes";

class SessionLifetime {
  epoch = 0;
  readonly authentication = new SessionAuthentication();
  private hasSignedIn = false;
  onBoundary?: () => void;
  lastRenewal: SessionSnapshot | null = null;
  private stores = new WeakMap<BlobStore, BlobStore>();
  private executors = new WeakMap<ExecSql, ExecSql>();

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
