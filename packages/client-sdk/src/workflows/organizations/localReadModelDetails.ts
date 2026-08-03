import type {
  OrganizationContainerGrantResponse,
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { loadContainerDisplayNamesByIds } from "../../data/persistence/containers/containerPersistence";
import { loadOrganizationReadModelProjection } from "../../data/persistence/organizations/organizationReadModelPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { runOrganizationPresentationRead } from "./organizationPresentationAccessState";
import {
  buildOrganizationGroupPolicyHistory,
  buildOrganizationPolicyHistory,
} from "./policyHistoryReadModel";
import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationGroupContainer,
  OrganizationGroupContainers,
  OrganizationGroupPolicyHistory,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
} from "./readModel";

interface LocalReadModelInput {
  readonly currentUserId: string;
  readonly execSql: ExecSql;
  readonly organizationId: string;
}

type PolicyPrincipalType = ReferencedPrincipalStateResponse["principalType"];

const DISPLAY_NAME_BATCH_SIZE = 400;

function uniqueContainerIds(
  grants: readonly OrganizationContainerGrantResponse[],
): string[] {
  return [...new Set(grants.map((grant) => grant.containerId))];
}

async function enrichGrants(
  execSql: ExecSql,
  grants: readonly OrganizationContainerGrantResponse[],
): Promise<OrganizationContainerGrant[]> {
  const containerIds = uniqueContainerIds(grants);
  const displayNames = new Map<string, string>();
  for (
    let index = 0;
    index < containerIds.length;
    index += DISPLAY_NAME_BATCH_SIZE
  ) {
    const batch = await loadContainerDisplayNamesByIds(
      execSql,
      containerIds.slice(index, index + DISPLAY_NAME_BATCH_SIZE),
    );
    for (const [containerId, displayName] of batch) {
      displayNames.set(containerId, displayName);
    }
  }
  return grants.map((grant) => ({
    ...grant,
    containerDisplayName: displayNames.get(grant.containerId) ?? null,
  }));
}

function toGroupContainer(
  grant: OrganizationContainerGrant,
): OrganizationGroupContainer {
  return {
    accessLevel: grant.accessLevel,
    containerId: grant.containerId,
    containerDisplayName: grant.containerDisplayName,
    createdAt: grant.createdAt,
    depth: grant.depth,
    isBuiltin: grant.isBuiltin,
    metadataAccessEpoch: grant.metadataAccessEpoch,
    metadataAccessStateHash: grant.metadataAccessStateHash,
    metadataDocumentId: grant.metadataDocumentId,
    parentId: grant.parentId,
    updatedAt: grant.updatedAt,
  };
}

function memberKey(type: "group" | "user", id: string): string {
  return `${type}\0${id}`;
}

function reachableGroupIds(input: {
  readonly edges: ReadonlyArray<{
    readonly groupId: string;
    readonly userId: string;
  }>;
  readonly userId: string;
}): Set<string> {
  const parentsByMember = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge.userId !== "group" && edge.userId !== "user") {
      throw new Error("Stored organization membership type is invalid");
    }
    const key = memberKey(edge.userId, edge.userId);
    const parents = parentsByMember.get(key) ?? [];
    parents.push(edge.groupId);
    parentsByMember.set(key, parents);
  }

  const reachable = new Set<string>();
  const visited = new Set<string>();
  const queue = [memberKey("user", input.userId)];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const key = queue[queueIndex];
    queueIndex += 1;
    if (!key) {
      break;
    }
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    for (const groupId of parentsByMember.get(key) ?? []) {
      reachable.add(groupId);
      queue.push(memberKey("group", groupId));
    }
  }
  return reachable;
}

export async function loadLocalOrganizationContainerGrants(
  input: LocalReadModelInput,
): Promise<OrganizationContainerGrants | null> {
  return runOrganizationPresentationRead(
    { ...input, requesterUserId: input.currentUserId },
    async () => {
      const projection = await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      );
      if (!projection?.requester) {
        return null;
      }
      return {
        organizationId: input.organizationId,
        grants: await enrichGrants(input.execSql, projection.grants.grants),
      };
    },
  );
}

export async function loadLocalOrganizationGroupContainers(
  input: LocalReadModelInput & { readonly groupId: string },
): Promise<OrganizationGroupContainers | null> {
  return runOrganizationPresentationRead(
    { ...input, requesterUserId: input.currentUserId },
    async () => {
      const projection = await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      );
      if (!projection?.requester) {
        return null;
      }
      const groupIsInOrganization =
        input.groupId === projection.groups.memberGroupId ||
        projection.groups.groups.some(
          (group) => group.groupId === input.groupId,
        );
      if (!groupIsInOrganization) {
        return null;
      }
      const grants = projection.grants.grants.filter(
        (grant) =>
          grant.subjectType === "group" && grant.subjectId === input.groupId,
      );
      return {
        organizationId: input.organizationId,
        groupId: input.groupId,
        containers: (await enrichGrants(input.execSql, grants)).map(
          toGroupContainer,
        ),
      };
    },
  );
}

export async function loadLocalOrganizationGroupPolicyHistory(
  input: LocalReadModelInput & { readonly groupId: string },
): Promise<OrganizationGroupPolicyHistory | null> {
  return runOrganizationPresentationRead(
    { ...input, requesterUserId: input.currentUserId },
    async () => {
      const projection = await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      );
      if (!projection?.requester) {
        return null;
      }

      const projectedHead = projection.policyHeads.find(
        (head) =>
          head.principalType === "group" && head.principalId === input.groupId,
      );
      if (!projectedHead) {
        return null;
      }

      const bundle = await loadPrincipalPolicyBundle(
        input.execSql,
        "group",
        input.groupId,
      );
      return policyBundleMatchesProjectedHead(bundle, projectedHead)
        ? buildOrganizationGroupPolicyHistory(bundle, input.organizationId)
        : null;
    },
  );
}

function policyBundleMatchesProjectedHead(
  bundle: PrincipalPolicyBundleResponse | null,
  projectedHead: {
    readonly keyEpoch: number;
    readonly keyFingerprint: string;
    readonly memberCount: number;
    readonly principalId: string;
    readonly principalType: PolicyPrincipalType;
    readonly stateHash: string;
    readonly version: number;
  },
): bundle is PrincipalPolicyBundleResponse {
  const storedHead = bundle?.currentState;
  return Boolean(
    storedHead &&
      storedHead.principalType === projectedHead.principalType &&
      storedHead.principalId === projectedHead.principalId &&
      storedHead.stateHash === projectedHead.stateHash &&
      storedHead.version === projectedHead.version &&
      storedHead.keyEpoch === projectedHead.keyEpoch &&
      storedHead.keyFingerprint === projectedHead.keyFingerprint &&
      storedHead.memberCount === projectedHead.memberCount,
  );
}

export async function loadLocalOrganizationPolicyHistory(
  input: LocalReadModelInput,
): Promise<OrganizationPolicyHistory | null> {
  return runOrganizationPresentationRead(
    { ...input, requesterUserId: input.currentUserId },
    async () => {
      const projection = await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      );
      if (!projection?.requester) {
        return null;
      }
      const projectedHead = projection.policyHeads.find(
        (head) =>
          head.principalType === "organization" &&
          head.principalId === input.organizationId,
      );
      if (!projectedHead) {
        return null;
      }
      const bundle = await loadPrincipalPolicyBundle(
        input.execSql,
        "organization",
        input.organizationId,
      );
      return policyBundleMatchesProjectedHead(bundle, projectedHead)
        ? buildOrganizationPolicyHistory(bundle)
        : null;
    },
  );
}

export async function loadLocalOrganizationPolicyReference(
  input: LocalReadModelInput & {
    readonly principalId: string;
    readonly principalType: PolicyPrincipalType;
  },
): Promise<ReferencedPrincipalStateResponse | null> {
  return runOrganizationPresentationRead(
    { ...input, requesterUserId: input.currentUserId },
    async () => {
      const projection = await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      );
      if (!projection?.requester) {
        return null;
      }
      const head = projection.policyHeads.find(
        (candidate) =>
          candidate.principalType === input.principalType &&
          candidate.principalId === input.principalId,
      );
      return head
        ? {
            principalType: head.principalType,
            principalId: head.principalId,
            stateHash: head.stateHash,
            version: head.version,
            keyEpoch: head.keyEpoch,
            keyFingerprint: head.keyFingerprint,
          }
        : null;
    },
  );
}

export async function loadLocalOrganizationUserDetail(
  input: LocalReadModelInput & { readonly userId: string },
): Promise<OrganizationUserDetail | null> {
  return runOrganizationPresentationRead(
    { ...input, requesterUserId: input.currentUserId },
    async () => {
      const projection = await loadOrganizationReadModelProjection(
        input.execSql,
        input.organizationId,
        input.currentUserId,
      );
      const user = projection?.directory.users.find(
        (candidate) => candidate.userId === input.userId,
      );
      if (!projection?.requester || !user) {
        return null;
      }

      const reachable = reachableGroupIds({
        edges: projection.membershipEdges,
        userId: input.userId,
      });
      const groups = projection.groups.groups.filter((group) =>
        reachable.has(group.groupId),
      );
      const relevantGrants = projection.grants.grants.filter(
        (grant) =>
          (grant.subjectType === "user" && grant.subjectId === input.userId) ||
          (grant.subjectType === "group" && reachable.has(grant.subjectId)) ||
          (grant.subjectType === "organization" &&
            grant.subjectId === input.organizationId),
      );
      const grants = await enrichGrants(input.execSql, relevantGrants);
      return {
        organizationId: input.organizationId,
        user,
        groups,
        grants: {
          directGrants: grants.filter(
            (grant) =>
              grant.subjectType === "user" && grant.subjectId === input.userId,
          ),
          groupGrants: grants.filter(
            (grant) =>
              grant.subjectType === "group" && reachable.has(grant.subjectId),
          ),
          organizationGrants: grants.filter(
            (grant) =>
              grant.subjectType === "organization" &&
              grant.subjectId === input.organizationId,
          ),
        },
      };
    },
  );
}
