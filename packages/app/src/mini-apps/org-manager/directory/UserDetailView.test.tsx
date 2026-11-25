import { afterEach, beforeEach, expect, test } from "bun:test";
import { type OrganizationUserDetail, Tearleads } from "@tearleads/client-sdk";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "@tearleads/windowing";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { installProfileEditorHost } from "../../../../test/helpers/org-manager/profileEditorHarness";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { ORG_MANAGER_LABELS } from "../labels";
import { UserDetailView } from "./UserDetailView";

let closeSdkHost = () => {};
beforeEach(() => {
  const sdk = new Tearleads();
  sdk.network.setOnline(false);
  const restoreHost = installProfileEditorHost(sdk, {
    ensureRosterProfileContainer: async () => null,
  });
  closeSdkHost = () => {
    restoreHost();
    sdk.dispose();
  };
});
afterEach(() => {
  cleanup();
  closeSdkHost();
});

const rosterUser: OrganizationUserDetail["user"] = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: "2026-05-24T12:00:00.000Z",
  disabledByUserId: "550e8400-e29b-41d4-a716-446655440002",
  twoFactorRequired: false,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  isPersonalOrganizationOwner: false,
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  leaveRequest: null,
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  status: "disabled",
  updatedAt: "2026-05-24T12:00:00.000Z",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

const detail: OrganizationUserDetail = {
  grants: {
    directGrants: [],
    groupGrants: [],
  },
  groups: [],
  organizationId: "organization-1",
  user: rosterUser,
};

function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

function TestProviders({ children }: PropsWithChildren) {
  return (
    <WindowMenuProvider>
      <ToolbarProbe />
      {children}
    </WindowMenuProvider>
  );
}

function renderUserDetailView(
  props: Partial<Parameters<typeof UserDetailView>[0]> = {},
) {
  return render(
    <UserDetailView
      memberGroupId={null}
      canEditRosterProfile={false}
      canRevokeGrants={false}
      detail={detail}
      twoFactorRequirement={null}
      pending={false}
      mutating={false}
      onRosterProfileDisplayNameChange={() => undefined}
      openGrantRoute={() => undefined}
      openGroupRoute={() => undefined}
      organizationId={detail.organizationId}
      profileDisplayNamesByUserId={new Map()}
      revokeGrant={() => undefined}
      rosterProfileEditRequestKey={null}
      syncSeatAssigned={null}
      {...props}
    />,
    { wrapper: TestProviders },
  );
}

test("org manager roster detail renders no inline back button", () => {
  // The detail "Back" affordance lives in the shared toolbar (registered by
  // OrgManagerRoutedChrome), not inline in the pane.
  const view = renderUserDetailView();

  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.back }),
  ).toBeNull();
  expect(view.getByText(ORG_MANAGER_LABELS.disabled)).toBeTruthy();
});

test("a seatless active user keeps the joined date beside the sync warning", () => {
  const view = renderUserDetailView({
    detail: {
      ...detail,
      user: { ...rosterUser, disabledAt: null, status: "active" },
    },
    syncSeatAssigned: false,
  });

  expect(
    view.getAllByText(formatMiniAppDate(rosterUser.joinedAt)),
  ).toHaveLength(2);
  expect(view.getByText(ORG_MANAGER_LABELS.syncSeatUnavailable)).toBeTruthy();
});

test("roster profile editing is controlled from the toolbar", async () => {
  const view = renderUserDetailView({ canEditRosterProfile: true });
  const toolbar = view.getByRole("toolbar", { name: "Toolbar" });
  const detailHeader = view.container.querySelector(
    ".org-manager-detail-header",
  );

  expect(detailHeader).not.toBeNull();
  expect(
    within(detailHeader as HTMLElement).queryByRole("button", {
      name: ORG_MANAGER_LABELS.edit,
    }),
  ).toBeNull();
  await waitFor(() => {
    expect(
      within(toolbar).getByRole("button", { name: ORG_MANAGER_LABELS.edit }),
    ).toBeTruthy();
  });

  fireEvent.click(
    within(toolbar).getByRole("button", { name: ORG_MANAGER_LABELS.edit }),
  );

  expect(
    within(toolbar).getByRole("button", { name: ORG_MANAGER_LABELS.done }),
  ).toBeTruthy();
});

test("roster detail tabs show only the selected section", async () => {
  const view = renderUserDetailView({ canEditRosterProfile: true });
  const tabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.rosterDetailTabsLabel,
  });
  const toolbar = view.getByRole("toolbar", { name: "Toolbar" });

  expect(
    within(tabs)
      .getByRole("tab", { name: ORG_MANAGER_LABELS.profile })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.getByText(ORG_MANAGER_LABELS.joined)).toBeTruthy();
  expect(view.queryByText(ORG_MANAGER_LABELS.noGroups)).toBeNull();
  const profileSection = view.container.querySelector(
    ".org-manager-roster-detail",
  );

  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.groups }),
  );
  expect(view.getByRole("tabpanel").textContent).toContain(
    ORG_MANAGER_LABELS.noGroups,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.joined).closest("[hidden]"),
  ).not.toBeNull();
  await waitFor(() => {
    expect(
      within(toolbar).queryByRole("button", { name: ORG_MANAGER_LABELS.edit }),
    ).toBeNull();
  });

  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.groupLinksTab }),
  );
  expect(view.getByRole("tabpanel").textContent).toContain(
    ORG_MANAGER_LABELS.noUserContainerLinks,
  );
  expect(view.getByRole("tabpanel").textContent).toContain(
    ORG_MANAGER_LABELS.noGroupContainerLinks,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.noGroups)).toBeNull();
  expect(view.container.querySelector(".org-manager-roster-detail")).toBe(
    profileSection,
  );
});

test("a roster edit request opens the profile tab", async () => {
  const view = renderUserDetailView({ canEditRosterProfile: true });
  const tabs = view.getByRole("tablist", {
    name: ORG_MANAGER_LABELS.rosterDetailTabsLabel,
  });

  fireEvent.click(
    within(tabs).getByRole("tab", { name: ORG_MANAGER_LABELS.groups }),
  );
  view.rerender(
    <UserDetailView
      memberGroupId={null}
      canEditRosterProfile={true}
      canRevokeGrants={false}
      detail={detail}
      twoFactorRequirement={null}
      pending={false}
      mutating={false}
      onRosterProfileDisplayNameChange={() => undefined}
      openGrantRoute={() => undefined}
      openGroupRoute={() => undefined}
      organizationId={detail.organizationId}
      profileDisplayNamesByUserId={new Map()}
      revokeGrant={() => undefined}
      rosterProfileEditRequestKey={1}
      syncSeatAssigned={null}
    />,
  );

  await waitFor(() => {
    expect(
      within(tabs)
        .getByRole("tab", { name: ORG_MANAGER_LABELS.profile })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      within(view.getByRole("toolbar", { name: "Toolbar" })).getByRole(
        "button",
        { name: ORG_MANAGER_LABELS.done },
      ),
    ).toBeTruthy();
  });
});

test("an administrator requires two-factor of an active member", () => {
  const activeDetail: OrganizationUserDetail = {
    ...detail,
    user: {
      ...detail.user,
      disabledAt: null,
      disabledByUserId: null,
      status: "active",
    },
  };
  const requested: Array<[string, boolean]> = [];
  const view = renderUserDetailView({
    detail: activeDetail,
    twoFactorRequirement: {
      mutating: false,
      set: async (userId, required) => {
        requested.push([userId, required]);
      },
    },
  });

  expect(view.getByText(ORG_MANAGER_LABELS.twoFactorNotRequired)).toBeTruthy();
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.twoFactorRequire }),
  );
  expect(requested).toEqual([[activeDetail.user.userId, true]]);
});

test("a member sees the two-factor requirement without a control", () => {
  const view = renderUserDetailView({
    detail: {
      ...detail,
      user: { ...detail.user, twoFactorRequired: true },
    },
  });

  expect(view.getByText(ORG_MANAGER_LABELS.twoFactorRequired)).toBeTruthy();
  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.twoFactorStopRequiring,
    }),
  ).toBeNull();
});
