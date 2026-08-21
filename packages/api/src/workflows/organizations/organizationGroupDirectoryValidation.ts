import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { groups } from "@symcrypt/api-shared/schema";
import type { PrincipalProjectionMember } from "@symcrypt/crypto";
import { asc, eq } from "drizzle-orm";
import { getCurrentPrincipalStates } from "../../access/read/principalStateStore";
import { PrincipalPolicyError } from "../principals/shared";
import { OrganizationManagerError } from "./errors";
import type { OrganizationGroupHead } from "./organizationAuthorityDescriptor";

export async function loadAuthoritativeOrganizationGroupHeads(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<OrganizationGroupHead[]> {
  const groupRows = await input.executor
    .select({ groupId: groups.id })
    .from(groups)
    .where(eq(groups.organizationId, input.organizationId))
    .orderBy(asc(groups.id));
  const states = await getCurrentPrincipalStates(
    "group",
    groupRows.map(({ groupId }) => groupId),
    input.executor,
  );
  return groupRows.map(({ groupId }) => {
    const state = states.get(groupId);
    if (!state) {
      throw new OrganizationManagerError(
        "Organization group policy is missing",
        409,
      );
    }
    return {
      principalType: "group",
      principalId: groupId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash: state.stateHash,
      keyFingerprint: state.keyFingerprint,
    };
  });
}

export function principalProjectionsEqual(
  left: readonly PrincipalProjectionMember[],
  right: readonly PrincipalProjectionMember[],
): boolean {
  const normalize = (projection: readonly PrincipalProjectionMember[]) =>
    [...projection]
      .map(({ role, userId }) => ({ role, userId }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function groupHeadsEqual(
  left: OrganizationGroupHead,
  right: OrganizationGroupHead,
): boolean {
  return (
    left.principalId === right.principalId &&
    left.version === right.version &&
    left.keyEpoch === right.keyEpoch &&
    left.stateHash === right.stateHash &&
    left.keyFingerprint === right.keyFingerprint
  );
}

export async function assertOrganizationGroupDirectoryCurrent(input: {
  readonly directory: readonly OrganizationGroupHead[];
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<void> {
  const authoritativeHeads = await loadAuthoritativeOrganizationGroupHeads({
    executor: input.executor,
    organizationId: input.organizationId,
  });
  const directoryById = new Map(
    input.directory.map((head) => [head.principalId, head]),
  );
  if (
    authoritativeHeads.some((head) => {
      const committed = directoryById.get(head.principalId);
      return !committed || !groupHeadsEqual(committed, head);
    })
  ) {
    throw new PrincipalPolicyError(
      "Organization authority descriptor must commit every current group head",
      409,
    );
  }

  const allowedIds = new Set(
    authoritativeHeads.map((head) => head.principalId),
  );
  if (input.directory.some((head) => !allowedIds.has(head.principalId))) {
    throw new PrincipalPolicyError(
      "Organization authority descriptor contains an unknown group",
      409,
    );
  }
}
