import { DatabaseUnavailableError } from "../../data/sqlite/availability/databaseUnavailable";
import { createScopedExecSql, type ExecSql } from "../../data/sqlite/sqlExec";
import type { SessionSnapshot } from "./sessionTypes";

class SessionLifetime {
  epoch = 0;
  onBoundary?: () => void;
  lastRenewal: SessionSnapshot | null = null;
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

  advance(): void {
    this.epoch += 1;
    this.executors = new WeakMap();
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
