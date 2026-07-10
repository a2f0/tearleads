import { afterEach, expect, test } from "bun:test";
import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
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
  userId: "550e8400-e29b-41d4-a716-446655440000",
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

function renderUserDetailView(
  props: Partial<Parameters<typeof UserDetailView>[0]> = {},
) {
  return render(
    <UserDetailView
      canEditRosterProfile={false}
      canRevokeGrants={false}
      detail={detail}
      loading={false}
      mutating={false}
      onDismiss={() => undefined}
      onRosterProfileDisplayNameChange={() => undefined}
      openGrantRoute={() => undefined}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedUserId={rosterUser.userId}
      {...props}
    />,
  );
}

test("org manager roster detail can hide its local dismiss button", () => {
  const view = renderUserDetailView({ showDismissButton: false });

  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.back }),
  ).toBeNull();
  expect(view.getByText(ORG_MANAGER_LABELS.disabled)).toBeTruthy();
});
