import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type {
  OrgManagerDirectory,
  OrgManagerDirectoryUser,
  OrgManagerUserDetail,
} from "../../stores/org-manager/OrgManagerProvider";
import { DirectoryView } from "./DirectoryView";
import { ORG_MANAGER_LABELS } from "./labels";

afterEach(() => cleanup());

const rosterUser: OrgManagerDirectoryUser = {
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

const directory: OrgManagerDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "organization-1",
  users: [rosterUser],
};

const detail: OrgManagerUserDetail = {
  grants: {
    directGrants: [],
    groupGrants: [],
    organizationGrants: [],
  },
  groups: [],
  organizationId: "organization-1",
  user: rosterUser,
};

test("org manager roster view exposes roster metadata and profile binding", () => {
  const drafts: string[] = [];

  const view = render(
    <DirectoryView
      canRevokeGrants={false}
      canUpdateRosterEntry
      detail={detail}
      directory={directory}
      loading={false}
      loadingUserDetail={false}
      mutating={false}
      openGroupRoute={() => undefined}
      profileDocumentIdDraft={rosterUser.profileDocumentId ?? ""}
      profileDocumentIdDraftChanged={false}
      revokeGrant={() => undefined}
      selectedUserId={rosterUser.userId}
      selectUser={() => undefined}
      setProfileDocumentIdDraft={(profileDocumentId) => {
        drafts.push(profileDocumentId);
      }}
      updateRosterProfileDocument={() => undefined}
    />,
  );

  expect(
    view.getByRole("table", { name: ORG_MANAGER_LABELS.directory }),
  ).toBeTruthy();
  expect(view.getAllByText(ORG_MANAGER_LABELS.disabled).length).toBe(2);
  expect(view.getAllByText(ORG_MANAGER_LABELS.profileDocument).length).toBe(2);
  expect(view.getByText(ORG_MANAGER_LABELS.disabledAt)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.disabledBy)).toBeTruthy();

  const profileDocumentInput = view.getByLabelText(
    ORG_MANAGER_LABELS.profileDocumentId,
  ) as HTMLInputElement;
  expect(profileDocumentInput.value).toBe(rosterUser.profileDocumentId ?? "");

  fireEvent.change(profileDocumentInput, { target: { value: "" } });
  expect(drafts).toEqual([""]);
});
