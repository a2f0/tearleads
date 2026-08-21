import { afterEach, expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { GrantsView } from "./GrantsView";

afterEach(() => cleanup());

const grant: OrganizationContainerGrant = {
  accessLevel: "read",
  containerDisplayName: "Root",
  containerId: "container-1",
  createdAt: "2026-05-20T12:00:00.000Z",
  depth: 0,
  groupId: "group-1",
  groupName: "Readers",
  isBuiltin: false,
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-state-hash",
  metadataDocumentId: null,
  parentId: null,
  signingKeyFingerprint: null,
  subjectId: "group-1",
  subjectType: "group",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: null,
};

test("org manager grant detail links group grants to their group", () => {
  const openedGroupIds: string[] = [];
  const view = render(
    <GrantsView
      canRevokeGrants
      grants={{ grants: [grant], organizationId: "org-1" }}
      pending={false}
      mutating={false}
      openGrantRoute={() => undefined}
      openGroupRoute={(groupId) => openedGroupIds.push(groupId)}
      revokeGrant={() => undefined}
      selectedGrant={grant}
      selectedGrantRef={{
        containerId: grant.containerId,
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      }}
    />,
  );

  expect(view.getAllByText(ORG_MANAGER_LABELS.grantDetail).length).toBe(2);
  const detailTable = view.getByRole("table");
  expect(
    detailTable.classList.contains("mini-app-info-table--borderless"),
  ).toBe(true);
  expect(view.queryByText(ORG_MANAGER_LABELS.signingKey)).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Readers" }));

  expect(openedGroupIds).toEqual(["group-1"]);
});

test("org manager grant detail shows signing keys for user grants", () => {
  const signingKeyFingerprint = "user-signing-key-fingerprint";
  const userGrant: OrganizationContainerGrant = {
    ...grant,
    groupId: null,
    groupName: null,
    signingKeyFingerprint,
    subjectId: "user-1",
    subjectType: "user",
    userId: "user-1",
  };
  const view = render(
    <GrantsView
      canRevokeGrants
      grants={{ grants: [userGrant], organizationId: "org-1" }}
      pending={false}
      mutating={false}
      openGrantRoute={() => undefined}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
      selectedGrant={userGrant}
      selectedGrantRef={{
        containerId: userGrant.containerId,
        subjectId: userGrant.subjectId,
        subjectType: userGrant.subjectType,
      }}
    />,
  );

  expect(view.getByText(ORG_MANAGER_LABELS.signingKey)).toBeTruthy();
  expect(view.getByText(signingKeyFingerprint)).toBeTruthy();
});
