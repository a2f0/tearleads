import { expect, test } from "bun:test";
import { ContainerMutationRequestSchema } from "@tearleads/validators/request";
import { createMutationResponseFromRequest } from "../../../../test/helpers/containerFixtures";
import { createCurrentShareMetadataFixture } from "../../../../test/helpers/currentShareMetadata";
import { policyBundleAfterMutation } from "../../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { principalPolicies } from "../../../data/sqlite/principalPolicySchema";
import { shareRemoteContainerWithGroup } from "./remote";

async function fixture() {
  const f = await createCurrentShareMetadataFixture();
  let compoundCalls = 0;
  let shareCalls = 0;
  f.options.apiClient.commitOrganizationGroupPolicy = async (
    organizationId,
    groupId,
    request,
  ) => {
    compoundCalls += 1;
    expect(organizationId).toBe(f.organizationId);
    expect(groupId).toBe(f.group.currentState.principalId);
    const mutations = request.groupPolicy.containerMutations ?? [];
    expect(mutations).toHaveLength(1);
    expect(ContainerMutationRequestSchema.safeParse(mutations[0]).success).toBe(
      true,
    );
    return {
      groupPolicy: {
        ...(await policyBundleAfterMutation({
          previous: f.group,
          mutation: request.groupPolicy,
        })),
        containerMutations: await Promise.all(
          mutations.map((mutation) =>
            createMutationResponseFromRequest(mutation),
          ),
        ),
      },
      organizationPolicy: await policyBundleAfterMutation({
        previous: f.directory,
        mutation: request.organizationPolicy,
      }),
    };
  };
  f.options.apiClient.shareContainer = async (_containerId, request) => {
    shareCalls += 1;
    expect(ContainerMutationRequestSchema.safeParse(request).success).toBe(
      true,
    );
    return createMutationResponseFromRequest(request);
  };
  return {
    ...f,
    compoundCalls: () => compoundCalls,
    shareCalls: () => shareCalls,
    input: {
      accessLevel: "read" as const,
      containerId: f.rootProjection.containerId,
      expectedGroupName: f.name,
      previousProjection: f.rootProjection,
      recipientGroupId: f.group.currentState.principalId,
      resolveProjectionUserKey: f.runtime.resolveTrustedUserIdentity,
      runtime: f.runtime,
    },
  };
}

test("runtime group share mints a compound grant using Current evidence and retains exact acknowledgements", async () => {
  const f = await fixture();
  try {
    const shared = await shareRemoteContainerWithGroup(f.input);
    expect(shared).not.toBeNull();
    expect(f.compoundCalls()).toBe(1);
    expect(f.shareCalls()).toBe(0);
    expect(f.fullReads()).toBe(0);
    expect(await f.db.select().from(principalPolicies)).toEqual([]);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        f.group.currentState.principalId,
      ),
    ).toMatchObject({ version: 2 });
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        f.organizationId,
      ),
    ).toMatchObject({ version: 3 });
  } finally {
    f.close();
  }
}, 15_000);

test("runtime group share preserves an existing signed grant without minting policy", async () => {
  const f = await fixture();
  try {
    const shared = await shareRemoteContainerWithGroup({
      ...f.input,
      accessLevel: "admin",
      expectedGroupName: "Admins",
      recipientGroupId: f.admin.currentState.principalId,
    });
    expect(shared).not.toBeNull();
    expect(f.compoundCalls()).toBe(0);
    expect(f.shareCalls()).toBe(1);
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
}, 15_000);

test.each([
  [
    "wrong name",
    "Container share group name does not match the signed group policy",
  ],
  ["no chosen name", "Minting a group grant requires the chosen group name"],
  ["page failure", "page unavailable"],
] as const)(
  "runtime Current share rejects %s without a Full downgrade or commit",
  async (mode, message) => {
    const f = await fixture();
    if (mode === "page failure")
      f.controls.error = new Error("page unavailable");
    try {
      await expect(
        shareRemoteContainerWithGroup({
          ...f.input,
          expectedGroupName:
            mode === "wrong name"
              ? "Another group"
              : mode === "no chosen name"
                ? undefined
                : f.name,
        }),
      ).rejects.toThrow(message);
      expect(f.compoundCalls()).toBe(0);
      expect(f.shareCalls()).toBe(0);
      expect(f.fullReads()).toBe(0);
    } finally {
      f.close();
    }
  },
  15_000,
);

test("Current share rejects a substituted policy receipt without advancing its group checkpoint", async () => {
  const f = await fixture();
  const commit = f.options.apiClient.commitOrganizationGroupPolicy.bind(
    f.options.apiClient,
  );
  f.options.apiClient.commitOrganizationGroupPolicy = async (...args) => {
    const response = await commit(...args);
    if (!response) throw new Error("Missing fixture receipt");
    response.groupPolicy.currentState.stateHash = "f".repeat(64);
    return response;
  };
  try {
    await expect(shareRemoteContainerWithGroup(f.input)).rejects.toThrow(
      "Group policy state acknowledgement mismatch",
    );
    expect(f.compoundCalls()).toBe(1);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        f.group.currentState.principalId,
      ),
    ).toMatchObject({ version: 1, stateHash: f.group.currentState.stateHash });
  } finally {
    f.close();
  }
}, 15_000);

test("Current share cannot report success or admit a receipt after its caller expires", async () => {
  const f = await fixture();
  let current = true;
  const commit = f.options.apiClient.commitOrganizationGroupPolicy.bind(
    f.options.apiClient,
  );
  f.options.apiClient.commitOrganizationGroupPolicy = async (...args) => {
    const response = await commit(...args);
    current = false;
    return response;
  };
  try {
    expect(
      await shareRemoteContainerWithGroup({
        ...f.input,
        stillCurrent: () => current,
      }),
    ).toBeNull();
    expect(f.compoundCalls()).toBe(1);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        f.group.currentState.principalId,
      ),
    ).toMatchObject({ version: 1 });
  } finally {
    f.close();
  }
}, 15_000);
