import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { OrgSwitcherState } from "./hooks/useOrgSwitcher";
import { ORG_MANAGER_LABELS } from "./labels";
import { OrgSwitcher } from "./OrgSwitcher";

afterEach(() => cleanup());

function createSwitcher(
  overrides: Partial<OrgSwitcherState> = {},
): OrgSwitcherState {
  return {
    activeOrganizationId: "org-a",
    closeCreateOrganizationDialog: () => {},
    createOrganization: async () => {
      throw new Error("Unexpected direct create");
    },
    createOrganizationError: null,
    creating: false,
    isCreateOrganizationDialogOpen: false,
    openCreateOrganizationDialog: () => {},
    organizations: [
      { name: "Acme", organizationId: "org-a", rootContainerId: "c-a" },
      { name: null, organizationId: "org-b", rootContainerId: "c-b" },
    ],
    selectOrganization: () => {},
    ...overrides,
  };
}

function getTrigger(view: ReturnType<typeof render>) {
  return view.getByRole("combobox", {
    name: ORG_MANAGER_LABELS.organizations,
  });
}

test("org switcher trigger shows the active organization name", () => {
  const view = render(<OrgSwitcher switcher={createSwitcher()} />);

  expect(getTrigger(view).textContent).toContain("Acme");
  // The list of organizations stays collapsed until the trigger is opened.
  expect(view.queryByRole("listbox")).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.unnamedOrganization)).toBeNull();
});

test("org switcher opens a listbox and drives selection", () => {
  const selected: string[] = [];
  const view = render(
    <OrgSwitcher
      switcher={createSwitcher({
        selectOrganization: (organizationId) => selected.push(organizationId),
      })}
    />,
  );

  fireEvent.click(getTrigger(view));

  expect(view.getByRole("listbox")).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.newOrganizationAction)).toBeTruthy();

  fireEvent.click(
    view.getByRole("option", {
      name: ORG_MANAGER_LABELS.unnamedOrganization,
    }),
  );

  expect(selected).toEqual(["org-b"]);
  // Selecting an organization closes the listbox.
  expect(view.queryByRole("listbox")).toBeNull();
});

test("org switcher opens the create-organization dialog from the footer", () => {
  let opened = 0;
  const view = render(
    <OrgSwitcher
      switcher={createSwitcher({
        openCreateOrganizationDialog: () => {
          opened += 1;
        },
      })}
    />,
  );

  fireEvent.click(getTrigger(view));
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.newOrganizationAction));

  expect(opened).toBe(1);
});
