import { afterEach, expect, test } from "bun:test";
import type { OrganizationDirectory } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ContextType } from "react";
import { OrgManagerContext } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { OrganizationView } from "./OrganizationView";

afterEach(() => cleanup());

const orgManagerActionsStub = {
  ensureOrganizationMetadataContainer: async () => null,
  ensureOrganizationProfileDocument: async () => null,
} as unknown as NonNullable<ContextType<typeof OrgManagerContext>>;

const adminDirectory = {
  currentUser: { isOrgAdmin: true },
  profileDocumentId: null,
} as OrganizationDirectory;

function organizationViewElement(
  props: Partial<Parameters<typeof OrganizationView>[0]> = {},
  actions = orgManagerActionsStub,
) {
  return (
    <OrgManagerContext.Provider value={actions}>
      <OrganizationView
        directory={null}
        groups={[]}
        key={props.organizationId ?? "organization-1"}
        organizationId="organization-1"
        pending={true}
        policyHistory={null}
        policyHistoryPending={false}
        {...props}
      />
    </OrgManagerContext.Provider>
  );
}

function renderOrganizationView(
  props: Partial<Parameters<typeof OrganizationView>[0]> = {},
  actions = orgManagerActionsStub,
) {
  return render(organizationViewElement(props, actions));
}

test("organization detail tabs switch between profile and policy history", async () => {
  const view = renderOrganizationView();
  await act(async () => undefined);
  const tabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.organizationDetailTabsLabel,
  });

  expect(
    within(tabs)
      .getByRole("tab", { name: ORG_MANAGER_LABELS.profile })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.getByRole("tabpanel").textContent).toContain(
    ORG_MANAGER_LABELS.loadingOrganizationProfile,
  );
  expect(
    view.queryByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeNull();

  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.policyHistory }),
  );
  expect(view.getByRole("tabpanel").textContent).toContain(
    ORG_MANAGER_LABELS.policyHistoryUnavailable,
  );
  expect(
    view
      .getByText(ORG_MANAGER_LABELS.loadingOrganizationProfile)
      .closest("[hidden]"),
  ).not.toBeNull();
});

test("returning to Profile reuses the created organization profile document", async () => {
  let ensureCount = 0;
  let metadataCount = 0;
  const actions = {
    ...orgManagerActionsStub,
    ensureOrganizationMetadataContainer: async () => {
      metadataCount += 1;
      return null;
    },
    ensureOrganizationProfileDocument: async () => {
      ensureCount += 1;
      return "profile-document-1";
    },
  } as NonNullable<ContextType<typeof OrgManagerContext>>;
  const view = renderOrganizationView(
    { directory: adminDirectory, pending: false },
    actions,
  );
  const tabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.organizationDetailTabsLabel,
  });

  await waitFor(() => expect(metadataCount).toBe(1));
  expect(ensureCount).toBe(1);
  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.policyHistory }),
  );
  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.profile }),
  );

  await waitFor(() => expect(ensureCount).toBe(1));
});

test("a quick tab switch does not restart profile document creation", async () => {
  let ensureCount = 0;
  let resolveEnsure: (documentId: string) => void = () => undefined;
  const ensurePromise = new Promise<string>((resolve) => {
    resolveEnsure = resolve;
  });
  const actions = {
    ...orgManagerActionsStub,
    ensureOrganizationProfileDocument: () => {
      ensureCount += 1;
      return ensurePromise;
    },
  } as NonNullable<ContextType<typeof OrgManagerContext>>;
  const view = renderOrganizationView(
    { directory: adminDirectory, pending: false },
    actions,
  );
  const tabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.organizationDetailTabsLabel,
  });

  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.policyHistory }),
  );
  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.profile }),
  );
  expect(ensureCount).toBe(1);

  await act(async () => resolveEnsure("profile-document-1"));
  expect(ensureCount).toBe(1);
});

test("changing organizations returns to the Profile tab", async () => {
  const view = renderOrganizationView();
  const tabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.organizationDetailTabsLabel,
  });

  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.policyHistory }),
  );
  await act(async () => {
    view.rerender(
      organizationViewElement({ organizationId: "organization-2" }),
    );
  });

  const nextTabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.organizationDetailTabsLabel,
  });
  expect(
    within(nextTabs)
      .getByRole("tab", { name: ORG_MANAGER_LABELS.profile })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.getByRole("tabpanel").textContent).toContain(
    ORG_MANAGER_LABELS.loadingOrganizationProfile,
  );
});
