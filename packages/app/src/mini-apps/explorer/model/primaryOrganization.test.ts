import { expect, test } from "bun:test";
import type { ContainerNode } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { resolveExplorerPrimaryOrganizationId } from "./primaryOrganization";

function containerNode(input: {
  id: string;
  organizationId: string;
  parentId: string | null;
}): ContainerNode {
  return {
    id: input.id,
    kind: "container",
    name: input.id,
    organizationId: input.organizationId,
    parentId: input.parentId,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}

test("explorer primary organization follows the personal root container", () => {
  expect(
    resolveExplorerPrimaryOrganizationId({
      currentOrganizationId: "org-work",
      nodes: [
        containerNode({
          id: "personal-root",
          organizationId: "org-personal",
          parentId: null,
        }),
        containerNode({
          id: "work-root",
          organizationId: "org-work",
          parentId: null,
        }),
      ],
      personalRootContainerId: "personal-root",
    }),
  ).toBe("org-personal");
});

test("explorer primary organization follows the first local organization summary", () => {
  expect(
    resolveExplorerPrimaryOrganizationId({
      currentOrganizationId: "org-work",
      nodes: [
        containerNode({
          id: "work-root",
          organizationId: "org-work",
          parentId: null,
        }),
        containerNode({
          id: "personal-root",
          organizationId: "org-personal",
          parentId: null,
        }),
      ],
      personalRootContainerId: "work-root",
      primaryLocalOrganizationId: "org-personal",
    }),
  ).toBe("org-personal");
});

test("explorer primary organization falls back to the active organization before personal root hydration", () => {
  expect(
    resolveExplorerPrimaryOrganizationId({
      currentOrganizationId: "org-work",
      nodes: [],
      personalRootContainerId: "personal-root",
    }),
  ).toBe("org-work");
});

test("explorer primary organization remains authoritative before its root hydrates", () => {
  expect(
    resolveExplorerPrimaryOrganizationId({
      currentOrganizationId: "org-work",
      nodes: [
        containerNode({
          id: "work-root",
          organizationId: "org-work",
          parentId: null,
        }),
      ],
      personalRootContainerId: "work-root",
      primaryLocalOrganizationId: "org-personal",
    }),
  ).toBe("org-personal");
});

test("explorer primary organization does not fall back after personal root hydration", () => {
  expect(
    resolveExplorerPrimaryOrganizationId({
      currentOrganizationId: "org-work",
      nodes: [
        containerNode({
          id: "personal-root",
          organizationId: "",
          parentId: null,
        }),
      ],
      personalRootContainerId: "personal-root",
    }),
  ).toBeNull();
});
