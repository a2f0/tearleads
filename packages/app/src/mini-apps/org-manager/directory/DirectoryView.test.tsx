import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ContextType, PropsWithChildren } from "react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../../components/window/WindowMenuContext";
import { OrgManagerContext } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { DirectoryView } from "./DirectoryView";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

const rosterUser: OrganizationDirectoryUser = {
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

const directory: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "organization-1",
  profileDocumentId: null,
  users: [rosterUser],
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

function renderDirectoryView(
  props: Partial<Parameters<typeof DirectoryView>[0]> = {},
) {
  return render(
    <DirectoryView
      canImportRosterUser={false}
      canRevokeGrants={false}
      canUpdateSelectedRosterEntry={false}
      closeImportUserDialog={() => undefined}
      detail={null}
      directory={directory}
      error={null}
      importRosterUser={() => undefined}
      importUserIdDraft=""
      isImportUserDialogOpen={false}
      loadingUserDetail={false}
      organizationId={directory.organizationId}
      pending={false}
      mutating={false}
      openGrantRoute={() => undefined}
      openGroupRoute={() => undefined}
      profileDisplayNamesByUserId={new Map()}
      revokeGrant={() => undefined}
      rosterProfileEditRequest={null}
      selectedUserId={null}
      selectUser={() => undefined}
      setSelectedProfileDisplayName={() => undefined}
      setImportUserIdDraft={() => undefined}
      syncSeatUserIds={null}
      {...props}
    />,
    { wrapper: TestProviders },
  );
}

function installClipboardWriteMock(): string[] {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (value: string) => {
        writes.push(value);
        return Promise.resolve();
      },
    },
  });
  return writes;
}

test("org manager roster view exposes roster metadata", () => {
  // The detail "Back" affordance lives in the shared toolbar (registered by
  // OrgManagerRoutedChrome), not inline in DirectoryView.
  const view = renderDirectoryView({
    detail,
    selectedUserId: rosterUser.userId,
  });

  expect(
    view.queryByRole("table", { name: ORG_MANAGER_LABELS.directory }),
  ).toBeNull();
  expect(view.getByText(ORG_MANAGER_LABELS.disabled)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.disabledAt)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.disabledBy)).toBeTruthy();
  expect(
    view.container.querySelector(
      ".org-manager-roster-row.mini-app-row--framed",
    ),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.back }),
  ).toBeNull();
});

test("org manager roster view copies the selected user id", () => {
  const clipboardWrites = installClipboardWriteMock();
  const view = renderDirectoryView({
    detail,
    selectedUserId: rosterUser.userId,
  });

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.copyUserIdAction }),
  );

  expect(clipboardWrites).toEqual([rosterUser.userId]);
});

test("org manager roster view toggles roster profile editing", async () => {
  const view = renderDirectoryView({
    canUpdateSelectedRosterEntry: true,
    detail,
    selectedUserId: rosterUser.userId,
  });

  // The unresolved profile container keeps the editor on its loading status.
  expect(
    view.getByText(ORG_MANAGER_LABELS.loadingProfileDocument),
  ).toBeTruthy();
  expect(view.queryByText(ORG_MANAGER_LABELS.directory)).toBeNull();

  const editButton = await waitFor(() =>
    view.getByRole("button", { name: ORG_MANAGER_LABELS.edit }),
  );
  fireEvent.click(editButton);

  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.done }),
  ).toBeTruthy();
});

test("org manager roster view opens selected detail in edit mode from edit requests", async () => {
  const view = renderDirectoryView({
    canUpdateSelectedRosterEntry: true,
    detail,
    rosterProfileEditRequest: { key: 1, userId: rosterUser.userId },
    selectedUserId: rosterUser.userId,
  });

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: ORG_MANAGER_LABELS.done }),
    ).toBeTruthy();
  });
});

test("org manager roster detail uses profile names before self fallback labels", () => {
  const selfRosterUser: OrganizationDirectoryUser = {
    ...rosterUser,
    isSelf: true,
  };

  const view = renderDirectoryView({
    detail: { ...detail, user: selfRosterUser },
    directory: { ...directory, users: [selfRosterUser] },
    profileDisplayNamesByUserId: new Map([[selfRosterUser.userId, "Countess"]]),
    selectedUserId: selfRosterUser.userId,
  });

  expect(view.getByText("Countess")).toBeTruthy();
  expect(view.queryByText(ORG_MANAGER_LABELS.self)).toBeNull();
});

test("org manager roster view labels unnamed self users as You", () => {
  const selfRosterUser: OrganizationDirectoryUser = {
    ...rosterUser,
    isSelf: true,
  };

  const view = renderDirectoryView({
    directory: { ...directory, users: [selfRosterUser] },
  });

  expect(view.getByText(ORG_MANAGER_LABELS.self)).toBeTruthy();
  expect(view.queryByText(compactRosterUserId())).toBeNull();
});

test("org manager roster view hides user detail until a user is selected", () => {
  const selections: Array<string | null> = [];

  const view = renderDirectoryView({
    selectUser: (userId) => {
      selections.push(userId);
    },
  });

  expect(
    view.getByRole("table", { name: ORG_MANAGER_LABELS.directory }),
  ).toBeTruthy();
  expect(view.container.querySelector(".org-manager-panel--detail")).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.disabledAt)).toBeNull();

  fireEvent.click(view.getByText(compactRosterUserId()));
  expect(selections).toEqual([rosterUser.userId]);
});

test("org manager roster view opens import user from whitespace below users", () => {
  let directoryContextMenuCount = 0;
  const view = renderDirectoryView({
    openDirectoryContextMenu: (event) => {
      event.preventDefault();
      directoryContextMenuCount += 1;
    },
  });
  const directorySection = view.getByRole("region", {
    name: ORG_MANAGER_LABELS.directory,
  });

  expect(
    directorySection.classList.contains("org-manager-panel--context-target"),
  ).toBe(true);
  fireEvent.contextMenu(directorySection);

  expect(directoryContextMenuCount).toBe(1);
});

test("org manager roster view does not open import user from user rows", () => {
  let directoryContextMenuCount = 0;
  const view = renderDirectoryView({
    openDirectoryContextMenu: () => {
      directoryContextMenuCount += 1;
    },
  });

  fireEvent.contextMenu(view.getByText(compactRosterUserId()));

  expect(directoryContextMenuCount).toBe(0);
});

test("org manager roster view opens row context menus from user rows", () => {
  let directoryContextMenuCount = 0;
  const rowContextMenuUserIds: string[] = [];
  const view = renderDirectoryView({
    openDirectoryContextMenu: () => {
      directoryContextMenuCount += 1;
    },
    openRosterUserContextMenu: (event, userId) => {
      event.preventDefault();
      rowContextMenuUserIds.push(userId);
    },
  });

  fireEvent.contextMenu(view.getByText(compactRosterUserId()));

  expect(directoryContextMenuCount).toBe(0);
  expect(rowContextMenuUserIds).toEqual([rosterUser.userId]);
});

test("org manager roster import dialog submits the user id draft", () => {
  const drafts: string[] = [];
  let importCount = 0;
  const view = renderDirectoryView({
    canImportRosterUser: true,
    importRosterUser: () => {
      importCount += 1;
    },
    importUserIdDraft: "user-2",
    isImportUserDialogOpen: true,
    setImportUserIdDraft: (userId) => drafts.push(userId),
  });

  expect(
    view.getByRole("dialog", { name: ORG_MANAGER_LABELS.importUserAction }),
  ).toBeTruthy();
  fireEvent.change(view.getByLabelText(ORG_MANAGER_LABELS.userId), {
    target: { value: "user-3" },
  });
  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.importUserSubmitAction,
    }),
  );

  expect(drafts).toEqual(["user-3"]);
  expect(importCount).toBe(1);
});

function compactRosterUserId(): string {
  return `${rosterUser.userId.slice(0, 10)}...${rosterUser.userId.slice(-6)}`;
}
