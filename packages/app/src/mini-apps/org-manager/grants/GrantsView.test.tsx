import { afterEach, expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
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
  organizationName: null,
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
      loading={false}
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
      selectGrantRef={() => undefined}
    />,
  );

  expect(view.getAllByText(ORG_MANAGER_LABELS.grantDetail).length).toBe(2);
  fireEvent.click(view.getByRole("button", { name: "Readers" }));

  expect(openedGroupIds).toEqual(["group-1"]);
});
