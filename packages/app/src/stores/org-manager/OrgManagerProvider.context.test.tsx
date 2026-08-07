import { expect, mock, test } from "bun:test";
import type { Organizations } from "@tearleads/client-sdk";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  createOrgManagerContextValue,
  OrgManagerContext,
  useOrgManagerActions,
} from "./OrgManagerProvider";

class TestOrganizations {
  readonly addUserToGroup = mock(async () => null as never);
  readonly removeUserFromGroup = mock(async () => null as never);

  constructor(private readonly prefix: string) {}

  async createGroup(name: string) {
    return { name: `${this.prefix}:${name}` } as never;
  }
}

function organizationsFacade(): Organizations {
  const unused = async () => null as never;
  return Object.assign(new TestOrganizations("org"), {
    deleteGroup: unused,
    importUserById: unused,
    loadBilling: unused,
    loadDataUsage: unused,
    loadDirectoryAndGroups: unused,
    loadDirectoryAndGroupsAfterMutation: unused,
    loadGrants: unused,
    loadGroupContainers: unused,
    loadGroupMembers: unused,
    loadGroupPresentationDetails: unused,
    loadLocalDataUsage: unused,
    loadLocalDirectoryAndGroups: unused,
    loadPolicyHistory: unused,
    loadUserDetail: unused,
    revokeGrant: unused,
    updateProfile: unused,
    updateRosterEntry: unused,
  }) as unknown as Organizations;
}

test("Org Manager keeps its narrow bound surface and positional adapters", async () => {
  const organizations = organizationsFacade();
  const unused = async () => null;
  const behavior = {
    captureOperationScope: () => null,
    ensureOrganizationMetadataContainer: unused,
    ensureOrganizationProfileDocument: unused,
    ensureRosterProfileContainer: unused,
    ensureRosterProfileDocument: unused,
    isOperationScopeActive: () => true,
  };
  const value = createOrgManagerContextValue(organizations, behavior);
  function OrgManagerTestProvider({ children }: PropsWithChildren) {
    return (
      <OrgManagerContext.Provider value={value}>
        {children}
      </OrgManagerContext.Provider>
    );
  }
  const view = renderHook(() => useOrgManagerActions(), {
    wrapper: OrgManagerTestProvider,
  });

  expect(Object.keys(view.result.current).sort()).toEqual(
    [
      "addUserToGroup",
      "captureOperationScope",
      "createGroup",
      "deleteGroup",
      "ensureOrganizationMetadataContainer",
      "ensureOrganizationProfileDocument",
      "ensureRosterProfileContainer",
      "ensureRosterProfileDocument",
      "importUserById",
      "isOperationScopeActive",
      "loadDataUsage",
      "loadDirectoryAndGroups",
      "loadDirectoryAndGroupsAfterMutation",
      "loadGrants",
      "loadGroupContainers",
      "loadGroupMembers",
      "loadGroupPresentationDetails",
      "loadLocalDataUsage",
      "loadLocalDirectoryAndGroups",
      "loadPolicyHistory",
      "loadUserDetail",
      "removeUserFromGroup",
      "revokeGrant",
      "updateProfile",
      "updateRosterEntry",
    ].sort(),
  );
  const { createGroup } = view.result.current;
  expect((await createGroup("admins")).name).toBe("org:admins");
  expect("loadBilling" in view.result.current).toBe(false);

  await view.result.current.addUserToGroup("group-1", "user-1");
  await view.result.current.removeUserFromGroup("group-1", "user-2");
  expect(organizations.addUserToGroup).toHaveBeenCalledWith({
    groupId: "group-1",
    targetUserId: "user-1",
  });
  expect(organizations.removeUserFromGroup).toHaveBeenCalledWith({
    groupId: "group-1",
    removedUserId: "user-2",
  });
});
