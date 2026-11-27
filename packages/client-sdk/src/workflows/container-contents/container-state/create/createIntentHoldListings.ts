import type { DomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";

/**
 * Tracks which held create intents this scope's current runtime has already
 * requested a parent listing for, so a hold asks once per runtime instead of
 * waiting on an earlier crawl, and asks again after a runtime reset.
 */
export interface CreateIntentHoldListings {
  /** Returns true the first time this hold is claimed for this runtime. */
  claim(execSql: ExecSql, holdKey: string): boolean;
  /** Clears recorded hold listings when the container store resets. */
  reset(): void;
}

function createCreateIntentHoldListings(): CreateIntentHoldListings {
  let activeExecSql: ExecSql | null = null;
  let requested = new Set<string>();
  return {
    claim(execSql, holdKey) {
      if (activeExecSql !== execSql) {
        activeExecSql = execSql;
        requested = new Set<string>();
      }
      if (requested.has(holdKey)) return false;
      requested.add(holdKey);
      return true;
    },
    reset() {
      activeExecSql = null;
      requested = new Set<string>();
    },
  };
}

const holdListingsByScope = new WeakMap<
  DomainScope,
  CreateIntentHoldListings
>();

/** The scope's create-intent hold listing tracker, created on first use. */
export function getOrCreateCreateIntentHoldListings(
  domainScope: DomainScope,
): CreateIntentHoldListings {
  const existing = holdListingsByScope.get(domainScope);
  if (existing) return existing;
  const created = createCreateIntentHoldListings();
  holdListingsByScope.set(domainScope, created);
  return created;
}
