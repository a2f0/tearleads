import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DirectoryView } from "./DirectoryView";
import { ORG_MANAGER_LABELS } from "./labels";

afterEach(() => cleanup());

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
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

const directory: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "organization-1",
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
  expect(view.getByText(ORG_MANAGER_LABELS.disabledAt)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.disabledBy)).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: ORG_MANAGER_LABELS.back }));
  expect(selections).toEqual([null]);
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

function compactRosterUserId(): string {
  return `${rosterUser.userId.slice(0, 10)}...${rosterUser.userId.slice(-6)}`;
}
