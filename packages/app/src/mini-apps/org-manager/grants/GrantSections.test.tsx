import { afterEach, expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { AppFeatureFlagsProvider } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "../../../providers/feature-flags/appFeatureFlags";
import { GrantSections } from "./GrantSections";

const HIDE_SYSTEM_GRANTS_KEY = appFeatureFlagStorageKey(
  "hide-org-manager-system-grants",
);
const MEMBERS = "group-members";

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem(HIDE_SYSTEM_GRANTS_KEY);
});

function groupGrant(input: {
  containerDisplayName: string;
  containerId: string;
  groupName: string;
  isBuiltin: boolean;
  subjectId: string;
}): OrganizationContainerGrant {
  return {
    accessLevel: "admin",
    containerDisplayName: input.containerDisplayName,
    containerId: input.containerId,
    createdAt: "2026-05-20T12:00:00.000Z",
    depth: 0,
    groupId: input.subjectId,
    groupName: input.groupName,
    isBuiltin: input.isBuiltin,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "access-state-hash",
    metadataDocumentId: null,
    parentId: null,
    signingKeyFingerprint: null,
    subjectId: input.subjectId,
    subjectType: "group",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId: null,
  };
}

const grants = [
  groupGrant({
    containerDisplayName: "Org Root",
    containerId: "container-root",
    groupName: "Admins",
    isBuiltin: true,
    subjectId: "group-admins",
  }),
  groupGrant({
    containerDisplayName: "Org Metadata",
    containerId: "container-metadata",
    groupName: "Admins",
    isBuiltin: true,
    subjectId: "group-admins",
  }),
  groupGrant({
    containerDisplayName: "Org Metadata",
    containerId: "container-metadata",
    groupName: "Members",
    isBuiltin: true,
    subjectId: MEMBERS,
  }),
];

function renderSections() {
  return render(
    <AppFeatureFlagsProvider>
      <GrantSections
        canRevokeGrants={false}
        memberGroupId={MEMBERS}
        mutating={false}
        openGrantRoute={() => undefined}
        revokeGrant={() => undefined}
        sections={[{ emptyLabel: "None", grants, label: "Group links" }]}
      />
    </AppFeatureFlagsProvider>,
  );
}

test("shows organization metadata system grants with the flag off", () => {
  saveAppFeatureFlag(HIDE_SYSTEM_GRANTS_KEY, "disabled");
  const view = renderSections();

  expect(view.getAllByText("Org Metadata").length).toBeGreaterThan(0);
  expect(view.getAllByText("Members").length).toBeGreaterThan(0);
  expect(view.getAllByText("Org Root").length).toBeGreaterThan(0);
});

test("hides organization metadata system grants but not root Admins by default", () => {
  const view = renderSections();

  expect(view.queryByText("Org Metadata")).toBeNull();
  expect(view.queryByText("Members")).toBeNull();
  expect(view.getAllByText("Org Root").length).toBeGreaterThan(0);
  expect(view.getAllByText("Admins").length).toBeGreaterThan(0);
});
