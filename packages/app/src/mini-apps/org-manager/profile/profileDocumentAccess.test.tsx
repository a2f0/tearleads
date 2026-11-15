import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import {
  createProfileEditorHarness,
  installProfileEditorHost,
  PROFILE_ORGANIZATION_ID,
  profileEditorUser,
} from "../../../../test/helpers/org-manager/profileEditorHarness";
import { RosterProfileEditor } from "../directory/RosterProfileEditor";
import { ORG_MANAGER_LABELS } from "../labels";
import { OrganizationProfileEditor } from "../organization/OrganizationProfileEditor";

for (const kind of ["roster", "organization"] as const) {
  test(`${kind} editor honors persisted read access even when host permits editing`, async () => {
    const f = await createProfileEditorHarness(kind, "read");
    const restoreHost = installProfileEditorHost(f.sdk);
    const before = await f.durableState();
    const view = render(
      kind === "roster" ? (
        <RosterProfileEditor
          canEdit={true}
          isEditing={true}
          organizationId={PROFILE_ORGANIZATION_ID}
          user={profileEditorUser(f.documentId)}
        />
      ) : (
        <OrganizationProfileEditor
          canEdit={true}
          onNameChange={() => undefined}
          organizationId={PROFILE_ORGANIZATION_ID}
          pending={false}
          profileDocumentId={f.documentId}
        />
      ),
    );
    try {
      const input = await view.findByRole("textbox", {
        name:
          kind === "roster"
            ? ORG_MANAGER_LABELS.firstName
            : ORG_MANAGER_LABELS.organizationName,
      });
      if (!(input instanceof HTMLInputElement))
        throw new Error("Expected input");
      expect(input.disabled).toBe(true);
      const after = await f.durableState();
      expect(after.document?.effectiveAccessLevel).toBe("read");
      expect(after.history).toEqual(before.history);
      expect(after.pending).toEqual(before.pending);
      await f.assertOnlyOriginalRecord();
    } finally {
      view.unmount();
      restoreHost();
      f.close();
    }
  });
}

test("an unavailable organization metadata container does not leave the editor loading", async () => {
  const f = await createProfileEditorHarness("organization");
  const restoreHost = installProfileEditorHost(f.sdk, {
    ensureOrganizationMetadataContainer: async () => null,
  });
  const view = render(
    <OrganizationProfileEditor
      canEdit={false}
      onNameChange={() => undefined}
      organizationId={PROFILE_ORGANIZATION_ID}
      pending={false}
      profileDocumentId={f.documentId}
    />,
  );
  try {
    expect(
      await view.findByText(ORG_MANAGER_LABELS.organizationProfileUnavailable),
    ).toBeTruthy();
    expect(
      view.queryByText(ORG_MANAGER_LABELS.loadingOrganizationProfile),
    ).toBeNull();
    await f.assertOnlyOriginalRecord();
  } finally {
    view.unmount();
    restoreHost();
    f.close();
  }
});
