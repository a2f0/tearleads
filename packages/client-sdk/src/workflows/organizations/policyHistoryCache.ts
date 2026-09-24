import type { DomainScope } from "../../data/domainScope";
import {
  isOrganizationPresentationAccessAttemptCurrent,
  isOrganizationPresentationAccessReadable,
  type OrganizationPresentationAccessAttempt,
  type OrganizationPresentationAccessInput,
  organizationAccessScopeKey,
} from "./organizationPresentationAccessState";
import type { OrganizationPolicyHistory } from "./policyHistoryTypes";

interface CachedHistory {
  readonly access: OrganizationPresentationAccessInput;
  readonly attempt: OrganizationPresentationAccessAttempt;
  readonly history: OrganizationPolicyHistory;
}

// Only the latest verified head per account/org is retained. Names and wire
// evidence never enter this cache, and nothing here is written to a database.
const histories = new WeakMap<DomainScope, Map<string, CachedHistory>>();

export function loadCachedPolicyHistory(input: {
  domainScope: DomainScope;
  access: OrganizationPresentationAccessInput;
  stateHash: string;
}): OrganizationPolicyHistory | null {
  const byKey = histories.get(input.domainScope);
  const key = organizationAccessScopeKey(
    input.access.organizationId,
    input.access.requesterUserId,
  );
  const cached = byKey?.get(key);
  if (!cached) return null;
  if (
    cached.access.execSql !== input.access.execSql ||
    cached.history.entries[0]?.stateHash !== input.stateHash ||
    !isOrganizationPresentationAccessAttemptCurrent(
      input.access,
      cached.attempt,
    ) ||
    !isOrganizationPresentationAccessReadable(input.access, "readModel")
  ) {
    byKey?.delete(key);
    return null;
  }
  return structuredClone(cached.history);
}

export function cachePolicyHistory(input: {
  domainScope: DomainScope;
  access: OrganizationPresentationAccessInput;
  attempt: OrganizationPresentationAccessAttempt;
  history: OrganizationPolicyHistory;
}): void {
  if (
    !isOrganizationPresentationAccessAttemptCurrent(
      input.access,
      input.attempt,
    ) ||
    !isOrganizationPresentationAccessReadable(input.access, "readModel")
  )
    return;
  let byKey = histories.get(input.domainScope);
  if (!byKey) {
    byKey = new Map();
    histories.set(input.domainScope, byKey);
  }
  byKey.set(
    organizationAccessScopeKey(
      input.access.organizationId,
      input.access.requesterUserId,
    ),
    {
      access: {
        execSql: input.access.execSql,
        organizationId: input.access.organizationId,
        requesterUserId: input.access.requesterUserId,
      },
      attempt: input.attempt,
      history: structuredClone(input.history),
    },
  );
}
