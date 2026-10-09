import { expect, test } from "bun:test";
import { missingPrincipalRecoveryFixture } from "../../../test/helpers/missingPrincipalRecovery";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import type { ContainerContents } from "../containerContents";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import {
  addUserToOrganizationGroup,
  createGroupForOrganization,
  deleteGroupForOrganization,
  removeUserFromOrganizationGroup,
  revokeOrganizationGrant,
} from "./principalMutations";

for (const missing of ["custody", "pages"] as const) {
  test.each(["add", "remove", "create", "delete", "revoke"] as const)(
    `%s refuses missing ${missing} before any policy read or write`,
    async (operation) => {
      const f = await missingPrincipalRecoveryFixture(missing);
      const unexpectedHost = new Proxy(
        {},
        {
          get(_target, property) {
            return () => {
              f.calls.push(`host:${String(property)}`);
              throw new Error(`Unexpected host call: ${String(property)}`);
            };
          },
        },
      );
      const input = {
        runtime: f.runtime,
        groupId: "group-1",
        expectedGroupName: "Operators",
        stillCurrent: () => true,
        containerContents: unexpectedHost as ContainerContents,
        readModelCoordinator:
          unexpectedHost as OrganizationReadModelCoordinator,
      };
      try {
        const pending = {
          add: () =>
            addUserToOrganizationGroup({ ...input, targetUserId: "peer" }),
          remove: () =>
            removeUserFromOrganizationGroup({
              ...input,
              removedUserId: "peer",
            }),
          create: () =>
            createGroupForOrganization({ ...input, name: "New group" }),
          delete: () => deleteGroupForOrganization(input),
          revoke: () =>
            revokeOrganizationGrant({
              ...input,
              containerId: "container-1",
              subjectId: input.groupId,
              subjectType: "group",
            }),
        }[operation]();
        const outcome = await pending.catch((error: unknown) => error);
        expect(f.calls).toEqual([]);
        expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
      } finally {
        f.close();
      }
    },
  );
}
