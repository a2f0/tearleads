import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { OrgSwitcher } from "./OrgSwitcher";
import type { OrgSwitcherState } from "./orgSwitcherTypes";
import { resolveOrgSwitcherSessionContext } from "./useOrgSwitcherController";

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
    interactionDisabled: false,
    isCreateOrganizationDialogOpen: false,
    openCreateOrganizationDialog: () => {},
    organizations: [
      { name: "Acme", organizationId: "org-a", rootContainerId: "c-a" },
      { name: null, organizationId: "org-b", rootContainerId: "c-b" },
    ],
    organizationsError: null,
    organizationsLoading: false,
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

test("org switcher resolves the selected org root for the session context", () => {
  expect(
    resolveOrgSwitcherSessionContext(
      [
        { name: "Acme", organizationId: "org-a", rootContainerId: "c-a" },
        { name: null, organizationId: "org-b", rootContainerId: "c-b" },
      ],
      "org-b",
    ),
  ).toEqual({ containerId: "c-b", organizationId: "org-b" });

  expect(resolveOrgSwitcherSessionContext([], "org-missing")).toBeNull();
});

test("org switcher stays openable with no organizations so the first can be created", () => {
  let opened = 0;
  const view = render(
    <OrgSwitcher
      switcher={createSwitcher({
        activeOrganizationId: null,
        openCreateOrganizationDialog: () => {
          opened += 1;
        },
        organizations: [],
      })}
    />,
  );

  const trigger = getTrigger(view);
  expect((trigger as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(trigger);
  // The listbox opens even with zero options because a footer action exists.
  expect(view.getByRole("listbox")).toBeTruthy();
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.newOrganizationAction));

  expect(opened).toBe(1);
});

test("org switcher closes when focus leaves the control", () => {
  const view = render(<OrgSwitcher switcher={createSwitcher()} />);

  const trigger = getTrigger(view);
  fireEvent.click(trigger);
  expect(view.getByRole("listbox")).toBeTruthy();

  // Focus moving out of the control (e.g. tabbing past it) closes the menu;
  // focus moving to the footer action inside it does not.
  fireEvent.focusOut(trigger, { relatedTarget: document.body });
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

test("org switcher exposes list loading and disables interaction", () => {
  const view = render(
    <OrgSwitcher
      switcher={createSwitcher({
        interactionDisabled: true,
        organizations: [],
        organizationsLoading: true,
      })}
    />,
  );

  expect((getTrigger(view) as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByText(ORG_MANAGER_LABELS.loadingOrganizations)).toBeTruthy();
});

test("org switcher exposes organization-list failures", () => {
  const view = render(
    <OrgSwitcher
      switcher={createSwitcher({
        organizationsError: ORG_MANAGER_LABELS.failedLoadOrganizations,
      })}
    />,
  );

  expect(
    view.getByText(ORG_MANAGER_LABELS.failedLoadOrganizations),
  ).toBeTruthy();
});
