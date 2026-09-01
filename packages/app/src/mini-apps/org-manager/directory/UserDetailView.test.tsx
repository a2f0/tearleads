import { afterEach, expect, test } from "bun:test";
import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ContextType, PropsWithChildren } from "react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../../components/window/WindowMenuContext";
import { OrgManagerContext } from "../../../stores/org-manager/OrgManagerProvider";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { ORG_MANAGER_LABELS } from "../labels";
import { UserDetailView } from "./UserDetailView";

afterEach(() => cleanup());

const rosterUser: OrganizationUserDetail["user"] = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: "2026-05-24T12:00:00.000Z",
  disabledByUserId: "550e8400-e29b-41d4-a716-446655440002",
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
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

// The inlined RosterProfileEditor only needs the container ensure; resolving
// null keeps it on its loading status without mounting a document store.
const orgManagerActionsStub = {
  ensureRosterProfileContainer: async () => null,
} as unknown as NonNullable<ContextType<typeof OrgManagerContext>>;

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
    <OrgManagerContext.Provider value={orgManagerActionsStub}>
      <WindowMenuProvider>
        <ToolbarProbe />
        {children}
      </WindowMenuProvider>
    </OrgManagerContext.Provider>
  );
}

function renderUserDetailView(
  props: Partial<Parameters<typeof UserDetailView>[0]> = {},
) {
  return render(
    <UserDetailView
      canEditRosterProfile={false}
      canRevokeGrants={false}
      detail={detail}
      pending={false}
      mutating={false}
      onRosterProfileDisplayNameChange={() => undefined}
      openGrantRoute={() => undefined}
      openGroupRoute={() => undefined}
      organizationId={detail.organizationId}
      profileDisplayName={undefined}
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
