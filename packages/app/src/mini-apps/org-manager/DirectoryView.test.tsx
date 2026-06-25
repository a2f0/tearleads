import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { DirectoryView } from "./DirectoryView";
import { ORG_MANAGER_LABELS } from "./labels";

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
  accountStatus: "trialing",
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
    organizationGrants: [],
  },
  groups: [],
  organizationId: "organization-1",
  user: rosterUser,
};

const noopOpenGrantRoute = () => undefined;

function ProfileDisplayNameReporter({
  displayName,
  onDisplayNameChange,
}: {
  displayName: string;
  onDisplayNameChange: (displayName: string | null) => void;
}) {
  useEffect(() => {
    onDisplayNameChange(displayName);
  }, [displayName, onDisplayNameChange]);

  return <span>{displayName}</span>;
}

function DirectoryViewDisplayNameHarness({
  detail,
  directory,
  displayName,
}: {
  detail: OrganizationUserDetail;
  directory: OrganizationDirectory;
  displayName: string;
}) {
  const [profileDisplayNamesByUserId, setProfileDisplayNamesByUserId] =
    useState<ReadonlyMap<string, string>>(new Map());
  const setSelectedProfileDisplayName = useCallback(
    (nextDisplayName: string | null) => {
      const trimmedDisplayName = nextDisplayName?.trim() ?? "";
      setProfileDisplayNamesByUserId((current) => {
        const existing = current.get(detail.user.userId) ?? "";
        if (existing === trimmedDisplayName) {
          return current;
        }

        const next = new Map(current);
        if (trimmedDisplayName.length > 0) {
          next.set(detail.user.userId, trimmedDisplayName);
        } else {
          next.delete(detail.user.userId);
        }
        return next;
      });
    },
    [detail.user.userId],
  );

  return (
    <DirectoryView
      canRevokeGrants={false}
      canUpdateSelectedRosterEntry
      detail={detail}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      profileDisplayNamesByUserId={profileDisplayNamesByUserId}
      renderRosterProfileEditor={({ onDisplayNameChange }) => (
        <ProfileDisplayNameReporter
          displayName={displayName}
          onDisplayNameChange={onDisplayNameChange}
        />
      )}
      revokeGrant={() => undefined}
      selectedUserId={detail.user.userId}
      selectUser={() => undefined}
      setSelectedProfileDisplayName={setSelectedProfileDisplayName}
    />
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

test("org manager roster view exposes roster metadata and dismisses detail", () => {
  const selections: Array<string | null> = [];

  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={detail}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={rosterUser.userId}
      selectUser={(userId) => {
        selections.push(userId);
      }}
    />,
  );

  expect(
    view.queryByRole("table", { name: ORG_MANAGER_LABELS.directory }),
  ).toBeNull();
  expect(view.getByText(ORG_MANAGER_LABELS.disabled)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.account)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.trial)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.disabledAt)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.disabledBy)).toBeTruthy();
  expect(
    view.container.querySelector(
      ".org-manager-roster-row.mini-app-row--framed",
    ),
  ).toBeNull();

  fireEvent.click(view.getByRole("button", { name: ORG_MANAGER_LABELS.back }));
  expect(selections).toEqual([null]);
});

test("org manager roster view copies the selected user id", () => {
  const clipboardWrites = installClipboardWriteMock();
  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={detail}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={rosterUser.userId}
      selectUser={() => undefined}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.copyUserIdAction }),
  );

  expect(clipboardWrites).toEqual([rosterUser.userId]);
});

test("org manager roster view can render an editable encrypted profile editor", () => {
  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      canUpdateSelectedRosterEntry
      detail={detail}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      renderRosterProfileEditor={({ isEditing, user }) => (
        <span>
          {user.profileDocumentId}:{isEditing ? "editable" : "readonly"}
        </span>
      )}
      revokeGrant={() => undefined}
      selectedUserId={rosterUser.userId}
      selectUser={() => undefined}
    />,
  );

  expect(view.queryByText(ORG_MANAGER_LABELS.profileDocument)).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.directory)).toBeNull();
  expect(
    view.getByText(`${rosterUser.profileDocumentId}:readonly`),
  ).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: ORG_MANAGER_LABELS.edit }));

  expect(
    view.getByText(`${rosterUser.profileDocumentId}:editable`),
  ).toBeTruthy();
});

test("org manager roster view opens selected detail in edit mode from edit requests", () => {
  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      canUpdateSelectedRosterEntry
      detail={detail}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      renderRosterProfileEditor={({ isEditing, user }) => (
        <span>
          {user.profileDocumentId}:{isEditing ? "editable" : "readonly"}
        </span>
      )}
      revokeGrant={() => undefined}
      rosterProfileEditRequest={{ key: 1, userId: rosterUser.userId }}
      selectedUserId={rosterUser.userId}
      selectUser={() => undefined}
    />,
  );

  expect(
    view.getByText(`${rosterUser.profileDocumentId}:editable`),
  ).toBeTruthy();
});

test("org manager roster detail uses profile names before self fallback labels", async () => {
  const selfRosterUser: OrganizationDirectoryUser = {
    ...rosterUser,
    isSelf: true,
  };
  const selfDetail: OrganizationUserDetail = {
    ...detail,
    user: selfRosterUser,
  };

  const view = render(
    <DirectoryViewDisplayNameHarness
      detail={selfDetail}
      directory={{ ...directory, users: [selfRosterUser] }}
      displayName="Countess"
    />,
  );

  await waitFor(() => {
    expect(view.getAllByText("Countess").length).toBe(2);
  });
  expect(view.queryByText(ORG_MANAGER_LABELS.self)).toBeNull();
});

test("org manager roster view labels unnamed self users as You", () => {
  const selfRosterUser: OrganizationDirectoryUser = {
    ...rosterUser,
    isSelf: true,
  };

  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={null}
      directory={{ ...directory, users: [selfRosterUser] }}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  expect(view.getByText(ORG_MANAGER_LABELS.self)).toBeTruthy();
  expect(view.queryByText(compactRosterUserId())).toBeNull();
});

test("org manager roster view hides user detail until a user is selected", () => {
  const selections: Array<string | null> = [];

  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={null}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={null}
      selectUser={(userId) => {
        selections.push(userId);
      }}
    />,
  );

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
  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={null}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openDirectoryContextMenu={(event) => {
        event.preventDefault();
        directoryContextMenuCount += 1;
      }}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
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
  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={null}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openDirectoryContextMenu={() => {
        directoryContextMenuCount += 1;
      }}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  fireEvent.contextMenu(view.getByText(compactRosterUserId()));

  expect(directoryContextMenuCount).toBe(0);
});

test("org manager roster view opens row context menus from user rows", () => {
  let directoryContextMenuCount = 0;
  const rowContextMenuUserIds: string[] = [];
  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      detail={null}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openDirectoryContextMenu={() => {
        directoryContextMenuCount += 1;
      }}
      openRosterUserContextMenu={(event, userId) => {
        event.preventDefault();
        rowContextMenuUserIds.push(userId);
      }}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  fireEvent.contextMenu(view.getByText(compactRosterUserId()));

  expect(directoryContextMenuCount).toBe(0);
  expect(rowContextMenuUserIds).toEqual([rosterUser.userId]);
});

test("org manager roster import dialog submits the user id draft", () => {
  const drafts: string[] = [];
  let importCount = 0;
  const view = render(
    <DirectoryView
      canImportRosterUser
      canRevokeGrants={false}
      detail={null}
      directory={directory}
      importRosterUser={() => {
        importCount += 1;
      }}
      importUserIdDraft="user-2"
      isImportUserDialogOpen
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGrantRoute={noopOpenGrantRoute}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
      setImportUserIdDraft={(userId) => drafts.push(userId)}
    />,
  );

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
