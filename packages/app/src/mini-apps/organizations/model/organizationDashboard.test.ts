import { expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { buildOrganizationDashboardCards } from "./organizationDashboard";

const METADATA_SLOT = `sys_v1_${"m".repeat(43)}`;
const TRASH_SLOT = `sys_v1_${"t".repeat(43)}`;

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

test("lists the root of a workspace and the topmost shared folders elsewhere", () => {
  const cards = buildOrganizationDashboardCards({
    activeOrganizationId: "personal",
    namesById: new Map([
      ["personal", "Personal Org"],
      ["acme", "Acme"],
    ]),
    nodes: [
      node({ id: "personal-root", organizationId: "personal", parentId: null }),
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

  expect(cards).toEqual([
    {
      active: true,
      folders: [
        {
          id: "personal-root",
          name: "personal-root",
          readOnly: false,
          workspaceRoot: true,
        },
      ],
      name: "Personal Org",
      organizationId: "personal",
      workspace: true,
    },
    {
      active: false,
      folders: [
        {
          id: "acme-design",
          name: "design",
          readOnly: false,
          workspaceRoot: false,
        },
        { id: "acme-team", name: "Team", readOnly: true, workspaceRoot: false },
      ],
      name: "Acme",
      organizationId: "acme",
      workspace: false,
    },
  ]);
});

test("keeps an organization known only through its metadata root", () => {
  const cards = buildOrganizationDashboardCards({
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

  expect(cards).toEqual([
    {
      active: false,
      folders: [],
      name: null,
      organizationId: "members-only",
      workspace: false,
    },
  ]);
});

test("orders the active organization, then workspaces, then named organizations", () => {
  const cards = buildOrganizationDashboardCards({
    activeOrganizationId: "active",
    namesById: new Map([
      ["active", "Zeta"],
      ["workspace", "Yankee"],
      ["beta", "beta"],
      ["alpha", "Alpha"],
    ]),
    nodes: [
      node({ id: "pending", organizationId: "pending", parentId: "hidden" }),
      node({ id: "beta", organizationId: "beta", parentId: "hidden" }),
      node({ id: "alpha", organizationId: "alpha", parentId: "hidden" }),
      node({ id: "workspace", organizationId: "workspace", parentId: null }),
      node({ id: "active", organizationId: "active", parentId: null }),
    ],
  });

  expect(cards.map((card) => card.organizationId)).toEqual([
    "active",
    "workspace",
    "alpha",
    "beta",
    "pending",
  ]);
});
