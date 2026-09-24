import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ContextType } from "react";
import { OrgManagerContext } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { OrganizationView } from "./OrganizationView";

afterEach(() => cleanup());

const orgManagerActionsStub = {
  ensureOrganizationMetadataContainer: async () => null,
  ensureOrganizationProfileDocument: async () => null,
} as unknown as NonNullable<ContextType<typeof OrgManagerContext>>;

function renderOrganizationView(organizationId = "organization-1") {
  return render(
    <OrgManagerContext.Provider value={orgManagerActionsStub}>
      <OrganizationView
        directory={null}
        groups={[]}
        organizationId={organizationId}
        pending={true}
        policyHistory={null}
        policyHistoryPending={false}
      />
    </OrgManagerContext.Provider>,
  );
}

test("organization detail tabs switch between profile and policy history", () => {
  const view = renderOrganizationView();
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
    view.queryByText(ORG_MANAGER_LABELS.loadingOrganizationProfile),
  ).toBeNull();
});
