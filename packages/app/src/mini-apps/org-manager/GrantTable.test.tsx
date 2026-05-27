import { afterEach, expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { GrantTable } from "./GrantTable";
import { ORG_MANAGER_LABELS } from "./labels";

afterEach(() => cleanup());

const grant: OrganizationContainerGrant = {
  accessLevel: "admin",
  containerDisplayName: "Root",
  containerId: "container-1",
  createdAt: "2026-05-20T12:00:00.000Z",
  depth: 0,
  groupId: "group-1",
  groupName: "Admins",
  isBuiltin: true,
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

function renderGrantTable(grants: ReadonlyArray<OrganizationContainerGrant>) {
  return render(
    <GrantTable
      canRevokeGrants
      emptyLabel={ORG_MANAGER_LABELS.noDirectContainerLinks}
      grants={grants}
      label={ORG_MANAGER_LABELS.grants}
      mutating={false}
      openGroupRoute={() => undefined}
      revokeGrant={() => undefined}
    />,
  );
}

test("org manager grant table renders built-in grants as plain text", () => {
  const view = renderGrantTable([grant]);

  expect(view.getByText(ORG_MANAGER_LABELS.builtIn)).toBeTruthy();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.builtIn }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  ).toBeNull();
});

test("org manager grant table keeps revoke action for custom grants", () => {
  const view = renderGrantTable([{ ...grant, isBuiltin: false }]);

  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  ).toBeTruthy();
});
