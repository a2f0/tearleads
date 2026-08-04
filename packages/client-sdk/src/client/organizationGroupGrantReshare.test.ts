import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  OrganizationContainerGrantResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";
import { ensureContainerTables } from "../data/persistence/containers/containerPersistence";
import { applyOrganizationReadModelResponse } from "../data/persistence/organizations/organizationReadModelPersistence";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import type { ContainerContents } from "./containerContents";
import { reshareGroupContainerGrantsAfterRotation } from "./organizationGroupGrantReshare";

const CREATED_AT = "2026-08-04T12:00:00.000Z";
const CURRENT_USER_ID = "admin-user";
const GRANTED_GROUP_ID = "granted-group";
const MEMBERS_GROUP_ID = "members-group";
const ORGANIZATION_ID = "organization-grant-reshare";

const EXPECTED_HEAD: ReferencedPrincipalHead = {
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

interface RewrapCall {
  accessLevel: string;
  containerId: string;
  groupId: string;
  requireExistingGrant: boolean | undefined;
}

function fakeContainerContents(input: {
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

async function seedReadModel(execSql: ExecSql): Promise<void> {
  await ensureContainerTables(execSql);
  await applyOrganizationReadModelResponse({
    currentUserId: CURRENT_USER_ID,
    execSql,
    requestedCursor: null,
    response: snapshot(),
  });
}

async function run(input: {
  contents: ContainerContents;
  execSql: ExecSql;
}): Promise<void> {
  await reshareGroupContainerGrantsAfterRotation({
    containerContents: input.contents,
    currentUserId: CURRENT_USER_ID,
    execSql: input.execSql,
    expectedGroupHead: EXPECTED_HEAD,
    log: () => undefined,
    mutatedGroupId: GRANTED_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });
}

test("re-wraps every container the rotated group is directly granted", async () => {
  const { close, execSql } = await createTestExecSql("group-grant-reshare-all");
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    await run({
      contents: fakeContainerContents({ prepareCalls, rewrapped }),
      execSql,
    });

    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
    // A grant naming a different group is never touched by this group's sweep.
    expect(
      prepareCalls.some((call) => call.containerId === "container-other"),
    ).toBe(false);
    // Never mint a grant: the signed manifest, not the server-fed read model,
    // decides whether the group already holds one.
    expect(prepareCalls.every((call) => call.requireExistingGrant)).toBe(true);
    expect(
      prepareCalls.every((call) => call.groupId === GRANTED_GROUP_ID),
    ).toBe(true);
  } finally {
    close();
  }
});

test("skips a container already carrying the committed head", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-current",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    await run({
      contents: fakeContainerContents({
        currentContainerIds: new Set(["container-a"]),
        prepareCalls,
        rewrapped,
      }),
      execSql,
    });

    // container-a stands in for the root container the root coordinator
    // already repaired on this same mutation: prepared, but not re-shared.
    expect(rewrapped).toEqual(["container-b"]);
  } finally {
    close();
  }
});

test("a container whose manifest withholds the grant is left alone", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-not-granted",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    await run({
      contents: fakeContainerContents({
        notGrantedContainerIds: new Set(["container-a"]),
        prepareCalls,
        rewrapped,
      }),
      execSql,
    });

    expect(rewrapped).toEqual(["container-b"]);
  } finally {
    close();
  }
});

test("an unreachable container does not abort the rest of the sweep", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-failure",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const logged: string[] = [];
    await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls,
        rewrapped,
        throwForContainerIds: new Set(["container-a"]),
      }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: (message) => logged.push(message),
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
    });

    expect(rewrapped).toEqual(["container-b"]);
    expect(logged.some((message) => message.includes("container-a"))).toBe(
      true,
    );
  } finally {
    close();
  }
});
