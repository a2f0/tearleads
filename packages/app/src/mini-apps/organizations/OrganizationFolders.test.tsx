import { afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { ORGANIZATIONS_LABELS } from "./labels";
import type { OrganizationDashboardCard } from "./model/organizationDashboard";
import { OrganizationFolders } from "./OrganizationFolders";

afterEach(cleanup);

const card: OrganizationDashboardCard = {
  active: false,
  canAskToLeave: false,
  canChangeSync: false,
  folders: [
    { accessLevel: "admin", id: "root", name: "root", workspaceRoot: true },
    {
      accessLevel: "write",
      id: "design",
      name: "Design",
      workspaceRoot: false,
    },
    { accessLevel: "read", id: "team", name: "Team", workspaceRoot: false },
  ],
  leaveRequested: false,
  name: "Acme",
  organizationId: "acme",
  syncPaused: false,
  workspace: true,
};

test("labels each folder with the user's effective permission on it", () => {
  const view = render(
    <OrganizationFolders card={card} name="Acme" onOpenFolder={() => {}} />,
  );
  const list = view.getByRole("list", {
    name: ORGANIZATIONS_LABELS.foldersIn("Acme"),
  });
  const permissionOf = (folderLabel: string) => {
    const row = within(list).getByText(folderLabel).closest("button");
    if (!row) throw new Error(`No row for ${folderLabel}`);
    return within(row).getByTitle(ORGANIZATIONS_LABELS.permission).textContent;
  };

  expect(permissionOf(ORGANIZATIONS_LABELS.workspaceRoot)).toBe(
    ORGANIZATIONS_LABELS.permissionAdmin,
  );
  expect(permissionOf("Design")).toBe(ORGANIZATIONS_LABELS.permissionWrite);
  expect(permissionOf("Team")).toBe(ORGANIZATIONS_LABELS.permissionRead);
});
