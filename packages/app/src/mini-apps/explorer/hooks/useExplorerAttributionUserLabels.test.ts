import { expect, mock, test } from "bun:test";
import type { OrganizationDirectoryAndGroups } from "@symcrypt/client-sdk";
import { loadExplorerAttributionDirectoryAndGroups } from "./explorerAttributionReadModel";

function readModel(cursor: string): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: "organization-id",
      profileDocumentId: null,
      users: [],
    },
    groups: [],
    memberGroupId: "member-group-id",
    readModelCursor: cursor,
  };
}

test("Explorer attribution uses the local organization projection without reconciling", async () => {
  const local = readModel("local-cursor");
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(local));

  const result = await loadExplorerAttributionDirectoryAndGroups({
    loadLocalDirectoryAndGroups,
  });

  expect(result).toBe(local);
  expect(loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(1);
});

test("Explorer attribution leaves a cold miss to demand-scoped catch-up", async () => {
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(null));

  const result = await loadExplorerAttributionDirectoryAndGroups({
    loadLocalDirectoryAndGroups,
  });

  expect(result).toBeNull();
  expect(loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(1);
});

test("Explorer attribution consumes an authoritative purge without a second request", async () => {
  const loadLocalDirectoryAndGroups = mock(() =>
    Promise.resolve(readModel("stale-cursor")),
  );

  const result = await loadExplorerAttributionDirectoryAndGroups(
    { loadLocalDirectoryAndGroups },
    null,
  );

  expect(result).toBeNull();
  expect(loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(0);
});
