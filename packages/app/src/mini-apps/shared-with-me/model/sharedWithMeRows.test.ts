import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  buildSharedWithMeRows,
  type SharedWithMeRow,
} from "./sharedWithMeRows";

const METADATA_SLOT = `sys_v1_${"m".repeat(43)}`;
const TRASH_SLOT = `sys_v1_${"t".repeat(43)}`;
const NO_SYNC_CHOICES = {
  leavableOrganizationIds: new Set<string>(),
  leaveRequestedOrganizationIds: new Set<string>(),
  pausedOrganizationIds: new Set<string>(),
};

function node(
  input: Pick<ContainerNode, "id" | "organizationId" | "parentId"> &
    Partial<ContainerNode>,
): ContainerNode {
  return {
    kind: "container",
    name: input.id,
    syncState: syncedContainerDocumentObjectSyncState,
    ...input,
  };
}

function organizationIds(rows: ReadonlyArray<SharedWithMeRow>): string[] {
  return [...new Set(rows.map((row) => row.organization.organizationId))];
}

test("lists the root of a workspace and the topmost shared folders elsewhere", () => {
  const personal = {
    canAskToLeave: false,
    leaveRequested: false,
    name: "Personal Org",
    organizationId: "personal",
    syncPaused: false,
  };
  const acme = {
    canAskToLeave: false,
    leaveRequested: false,
    name: "Acme",
    organizationId: "acme",
    syncPaused: false,
  };
  const rows = buildSharedWithMeRows({
    ...NO_SYNC_CHOICES,
    activeOrganizationId: "personal",
    namesById: new Map([
      ["personal", "Personal Org"],
      ["acme", "Acme"],
    ]),
    nodes: [
      node({
        effectiveAccessLevel: "admin",
        id: "personal-root",
        organizationId: "personal",
        parentId: null,
      }),
      node({
        id: "personal-trash",
        organizationId: "personal",
        parentId: "personal-root",
        systemSlot: TRASH_SLOT,
      }),
      node({
        id: "personal-child",
        organizationId: "personal",
        parentId: "personal-root",
      }),
      node({
        id: "acme-metadata",
        organizationId: "acme",
        parentId: null,
        systemSlot: METADATA_SLOT,
      }),
      node({
        effectiveAccessLevel: "read",
        id: "acme-team",
        name: "Team",
        organizationId: "acme",
        parentId: "acme-root",
      }),
      node({
        id: "acme-team-child",
        organizationId: "acme",
        parentId: "acme-team",
      }),
      node({
        effectiveAccessLevel: "write",
        id: "acme-design",
        name: "design",
        organizationId: "acme",
        parentId: "acme-projects",
      }),
    ],
  });

  expect(rows).toEqual([
    {
      folder: {
        accessLevel: "admin",
        id: "personal-root",
        name: "personal-root",
        workspaceRoot: true,
      },
      key: "folder:personal-root",
      kind: "folder",
      organization: personal,
    },
    {
      folder: {
        accessLevel: "write",
        id: "acme-design",
        name: "design",
        workspaceRoot: false,
      },
      key: "folder:acme-design",
      kind: "folder",
      organization: acme,
    },
    {
      folder: {
        accessLevel: "read",
        id: "acme-team",
        name: "Team",
        workspaceRoot: false,
      },
      key: "folder:acme-team",
      kind: "folder",
      organization: acme,
    },
  ]);
});

test("treats a folder with no synced access level as read only", () => {
  const [row] = buildSharedWithMeRows({
    ...NO_SYNC_CHOICES,
    activeOrganizationId: null,
    namesById: new Map(),
    nodes: [node({ id: "shared", organizationId: "acme", parentId: "hidden" })],
  });

  expect(row?.kind === "folder" && row.folder.accessLevel).toBe("read");
});

test("gives an organization known only through its metadata root one organization row", () => {
  const rows = buildSharedWithMeRows({
    ...NO_SYNC_CHOICES,
    activeOrganizationId: null,
    namesById: new Map(),
    nodes: [
      node({
        id: "members-metadata",
        organizationId: "members-only",
        parentId: null,
        systemSlot: METADATA_SLOT,
      }),
    ],
  });

  expect(rows).toEqual([
    {
      key: "organization:members-only",
      kind: "organization",
      organization: {
        canAskToLeave: false,
        leaveRequested: false,
        name: null,
        organizationId: "members-only",
        syncPaused: false,
      },
    },
  ]);
});

test("lists a Contacts folder shared on its own, but not roster profiles", () => {
  const rows = buildSharedWithMeRows({
    ...NO_SYNC_CHOICES,
    activeOrganizationId: null,
    namesById: new Map(),
    nodes: [
      node({
        id: "acme-metadata",
        organizationId: "acme",
        parentId: null,
        systemSlot: METADATA_SLOT,
      }),
      node({
        id: "acme-roster-profiles",
        name: "Roster Profiles",
        organizationId: "acme",
        parentId: "acme-root",
        systemSlot: `sys_v1_${"r".repeat(43)}`,
      }),
      node({
        id: "acme-contacts",
        name: "Contacts",
        organizationId: "acme",
        parentId: "acme-root",
        systemSlot: `sys_v1_${"c".repeat(43)}`,
      }),
    ],
  });

  expect(rows.map((row) => row.key)).toEqual(["folder:acme-contacts"]);
});

test("groups the active organization, then workspaces, then named organizations", () => {
  const rows = buildSharedWithMeRows({
    ...NO_SYNC_CHOICES,
    activeOrganizationId: "active",
    namesById: new Map([
      ["active", "Zeta"],
      ["workspace", "Yankee"],
      ["beta", "beta"],
      ["alpha", "Alpha"],
    ]),
    nodes: [
      node({ id: "pending", organizationId: "pending", parentId: "hidden" }),
      node({ id: "beta-2", organizationId: "beta", parentId: "hidden" }),
      node({ id: "alpha", organizationId: "alpha", parentId: "hidden" }),
      node({ id: "beta-1", organizationId: "beta", parentId: "hidden" }),
      node({ id: "workspace", organizationId: "workspace", parentId: null }),
      node({ id: "active", organizationId: "active", parentId: null }),
    ],
  });

  expect(rows.map((row) => row.key)).toEqual([
    "folder:active",
    "folder:workspace",
    "folder:alpha",
    "folder:beta-1",
    "folder:beta-2",
    "folder:pending",
  ]);
});

test("marks every row of an organization paused on this device, active and personal included", () => {
  const rows = buildSharedWithMeRows({
    activeOrganizationId: "active",
    namesById: new Map(),
    nodes: [
      node({ id: "active", organizationId: "active", parentId: null }),
      node({ id: "personal", organizationId: "personal", parentId: null }),
      node({ id: "live", organizationId: "live", parentId: null }),
      node({
        id: "paused-metadata",
        organizationId: "paused",
        parentId: null,
        systemSlot: METADATA_SLOT,
      }),
    ],
    ...NO_SYNC_CHOICES,
    pausedOrganizationIds: new Set(["active", "paused", "personal"]),
  });

  expect(
    rows.map(({ key, organization }) => ({
      key,
      syncPaused: organization.syncPaused,
    })),
  ).toEqual([
    { key: "folder:active", syncPaused: true },
    { key: "folder:live", syncPaused: false },
    { key: "folder:personal", syncPaused: true },
    { key: "organization:paused", syncPaused: true },
  ]);
});

test("offers a leave request only for listed, non-personal memberships", () => {
  const rows = buildSharedWithMeRows({
    activeOrganizationId: "personal",
    ...NO_SYNC_CHOICES,
    leavableOrganizationIds: new Set(["acme", "asked"]),
    leaveRequestedOrganizationIds: new Set(["asked"]),
    namesById: new Map([
      ["acme", "Acme"],
      ["asked", "Asked"],
      ["unlisted", "Unlisted"],
    ]),
    nodes: [
      node({ id: "personal", organizationId: "personal", parentId: null }),
      node({ id: "acme", organizationId: "acme", parentId: null }),
      node({ id: "asked", organizationId: "asked", parentId: null }),
      node({ id: "unlisted", organizationId: "unlisted", parentId: null }),
    ],
  });

  expect(
    rows.map(({ organization }) => ({
      canAskToLeave: organization.canAskToLeave,
      leaveRequested: organization.leaveRequested,
      organizationId: organization.organizationId,
    })),
  ).toEqual([
    { canAskToLeave: false, leaveRequested: false, organizationId: "personal" },
    { canAskToLeave: true, leaveRequested: false, organizationId: "acme" },
    { canAskToLeave: true, leaveRequested: true, organizationId: "asked" },
    { canAskToLeave: false, leaveRequested: false, organizationId: "unlisted" },
  ]);
});

test("shows only the account organization while the device root is reconciled", () => {
  const deviceRoot = node({
    id: "local-root",
    organizationId: "",
    parentId: null,
  });
  const accountRoot = node({
    id: "account-root",
    organizationId: "personal",
    parentId: null,
  });
  const listed = (nodes: ContainerNode[]) =>
    organizationIds(
      buildSharedWithMeRows({
        ...NO_SYNC_CHOICES,
        activeOrganizationId: "personal",
        namesById: new Map(),
        nodes,
      }),
    );

  expect(listed([deviceRoot, accountRoot])).toEqual(["personal"]);
  expect(listed([deviceRoot])).toEqual([]);
  expect(listed([accountRoot])).toEqual(["personal"]);
});
