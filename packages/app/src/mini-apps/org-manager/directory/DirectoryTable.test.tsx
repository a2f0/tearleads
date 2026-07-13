import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { DirectoryTable } from "./DirectoryTable";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
  globalThis.localStorage.clear();
});

const rosterUser: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

const directory: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "organization-1",
  profileDocumentId: null,
  users: [rosterUser],
};

test("org manager directory table has no kebab on the desktop layout", () => {
  const view = render(
    <DirectoryTable
      directory={directory}
      loading={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  expect(
    view.queryByRole("button", {
      name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
    }),
  ).toBeNull();
});

test("org manager directory table opens the row context menu from the touch kebab", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const contextMenuUserIds: string[] = [];
  const view = render(
    <DirectoryTable
      directory={directory}
      loading={false}
      openRosterUserContextMenu={(event, userId) => {
        event.preventDefault();
        contextMenuUserIds.push(userId);
      }}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
    }),
  );

  expect(contextMenuUserIds).toEqual([rosterUser.userId]);
});

test("org manager directory kebab keeps keyboard activation off the row", () => {
  // Enter/Space on the focused kebab must not bubble to the row's onKeyDown and
  // navigate into the user detail instead of opening the kebab menu.
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const selectedUserIds: string[] = [];
  const view = render(
    <DirectoryTable
      directory={directory}
      loading={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={(userId) => selectedUserIds.push(userId)}
    />,
  );
  const actionsButton = view.getByRole("button", {
    name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
  });

  fireEvent.keyDown(actionsButton, { key: "Enter" });
  fireEvent.keyDown(actionsButton, { key: " " });

  expect(selectedUserIds).toEqual([]);
});
