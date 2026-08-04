import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type {
  OrganizationContainerGrantResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";
import { ensureContainerTables } from "../data/persistence/containers/containerPersistence";
import { applyOrganizationReadModelResponse } from "../data/persistence/organizations/organizationReadModelPersistence";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import type { ContainerContents } from "./containerContents";

const CREATED_AT = "2026-08-04T12:00:00.000Z";
export const CURRENT_USER_ID = "admin-user";
export const GRANTED_GROUP_ID = "granted-group";
const MEMBERS_GROUP_ID = "members-group";
export const ORGANIZATION_ID = "organization-grant-reshare";

export const EXPECTED_HEAD: ReferencedPrincipalHead = {
  principalType: "group",
  principalId: GRANTED_GROUP_ID,
  stateHash: "granted-group-state-2",
  version: 2,
  keyEpoch: 2,
  keyFingerprint: "granted-group-key-2",
};

function grant(input: {
  readonly containerId: string;
  readonly subjectId: string;
}): OrganizationContainerGrantResponse {
  return {
    accessLevel: "read",
    containerId: input.containerId,
    createdAt: CREATED_AT,
    depth: 1,
    isBuiltin: false,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `manifest-${input.containerId}`,
    metadataDocumentId: `metadata-${input.containerId}`,
    parentId: "root-container",
    updatedAt: CREATED_AT,
    subjectType: "group",
    subjectId: input.subjectId,
    userId: null,
    signingKeyFingerprint: null,
    groupId: input.subjectId,
    groupName: `Group ${input.subjectId}`,
    organizationName: null,
  };
}

function snapshot(): OrganizationReadModelSnapshotResponse {
  return {
    version: 5,
    mode: "snapshot",
    organizationId: ORGANIZATION_ID,
    nextCursor: "cursor-grant-reshare",
    hasMore: false,
    currentUser: { isOrgAdmin: true },
    lanes: {
      directory: {
        organizationId: ORGANIZATION_ID,
        profileDocumentId: "organization-profile",
        users: [
          {
            userId: CURRENT_USER_ID,
            signingKeyFingerprint: `signing-fingerprint-${CURRENT_USER_ID}`,
            signingPublicKey: `signing-key-${CURRENT_USER_ID}`,
            encapsulationPublicKey: `encapsulation-key-${CURRENT_USER_ID}`,
            encapsulationKeyFingerprint: `encapsulation-fingerprint-${CURRENT_USER_ID}`,
            createdAt: CREATED_AT,
            isSelf: true,
            status: "active" as const,
            profileDocumentId: `profile-${CURRENT_USER_ID}`,
            joinedAt: CREATED_AT,
            updatedAt: CREATED_AT,
            disabledAt: null,
            disabledByUserId: null,
          },
        ],
      },
      grants: {
        organizationId: ORGANIZATION_ID,
        grants: [
          grant({ containerId: "container-a", subjectId: GRANTED_GROUP_ID }),
          grant({ containerId: "container-b", subjectId: GRANTED_GROUP_ID }),
          grant({ containerId: "container-other", subjectId: "other-group" }),
        ],
      },
      groups: {
        organizationId: ORGANIZATION_ID,
        memberGroupId: MEMBERS_GROUP_ID,
        groups: [
          {
            groupId: GRANTED_GROUP_ID,
            organizationId: ORGANIZATION_ID,
            name: "Granted",
            createdAt: CREATED_AT,
            isBuiltin: false,
            currentState: {
              stateHash: EXPECTED_HEAD.stateHash,
              version: EXPECTED_HEAD.version,
              keyEpoch: EXPECTED_HEAD.keyEpoch,
              keyFingerprint: EXPECTED_HEAD.keyFingerprint,
              memberCount: 1,
            },
          },
        ],
      },
      groupMemberships: {
        organizationId: ORGANIZATION_ID,
        deletedGroupIds: [],
        groups: [
          {
            groupId: MEMBERS_GROUP_ID,
            stateHash: "members-state",
            members: [],
          },
          {
            groupId: GRANTED_GROUP_ID,
            stateHash: EXPECTED_HEAD.stateHash,
            members: [
              {
                userId: CURRENT_USER_ID,
                role: "admin" as const,
                signingKeyFingerprint: `signing-fingerprint-${CURRENT_USER_ID}`,
                signingPublicKey: `signing-key-${CURRENT_USER_ID}`,
                encapsulationPublicKey: `encapsulation-key-${CURRENT_USER_ID}`,
                encapsulationKeyFingerprint: `encapsulation-fingerprint-${CURRENT_USER_ID}`,
              },
            ],
          },
        ],
      },
      organizationPolicy: {
        organizationId: ORGANIZATION_ID,
        currentState: {
          stateHash: "organization-policy-state",
          version: 1,
          keyEpoch: 1,
          keyFingerprint: "organization-policy-key-fingerprint",
          memberCount: 1,
        },
      },
    },
  };
}

export interface RewrapCall {
  accessLevel: string;
  containerId: string;
  groupId: string;
  requireExistingGrant: boolean | undefined;
}

export function fakeContainerContents(input: {
  currentContainerIds?: ReadonlySet<string>;
  notGrantedContainerIds?: ReadonlySet<string>;
  prepareCalls: RewrapCall[];
  rewrapped: string[];
  throwForContainerIds?: ReadonlySet<string>;
}): ContainerContents {
  return {
    openTree: () => ({
      prepareGroupRewrap: async (
        containerId: string,
        groupId: string,
        accessLevel: string,
        options?: { requireExistingGrant?: boolean } | undefined,
      ) => {
        input.prepareCalls.push({
          accessLevel,
          containerId,
          groupId,
          requireExistingGrant: options?.requireExistingGrant,
        });
        if (input.throwForContainerIds?.has(containerId)) {
          throw new Error(`container ${containerId} is unavailable`);
        }
        if (input.notGrantedContainerIds?.has(containerId)) {
          return { status: "not-granted" as const };
        }
        return {
          status: "prepared" as const,
          isCurrent: async () =>
            input.currentContainerIds?.has(containerId) ?? false,
          rewrap: async () => {
            input.rewrapped.push(containerId);
            return true;
          },
        };
      },
    }),
  } as unknown as ContainerContents;
}

export async function seedReadModel(execSql: ExecSql): Promise<void> {
  await ensureContainerTables(execSql);
  await applyOrganizationReadModelResponse({
    currentUserId: CURRENT_USER_ID,
    execSql,
    requestedCursor: null,
    response: snapshot(),
  });
}

export function fakeRuntime(log: string[]) {
  return {
    infra: { dbStatus: "ready", execSql: null },
    util: {
      log: (message: string) => log.push(message),
      logError: (message: string) => log.push(String(message)),
    },
  };
}
