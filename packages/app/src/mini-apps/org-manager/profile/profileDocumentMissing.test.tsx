import { expect, test } from "bun:test";
import { deriveStableDocumentId } from "@tearleads/client-sdk";
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
  test(`${kind} editor refuses a missing explicit pointer without creating a record`, async () => {
    const f = await createProfileEditorHarness(kind);
    const restoreHost = installProfileEditorHost(f.sdk);
    const missingId = await deriveStableDocumentId("missing-profile-pointer");
    const before = await f.durableState();
    const view = render(
      kind === "roster" ? (
        <RosterProfileEditor
          canEdit={true}
          isEditing={true}
          organizationId={PROFILE_ORGANIZATION_ID}
          user={profileEditorUser(missingId)}
        />
      ) : (
        <OrganizationProfileEditor
          canEdit={true}
          onNameChange={() => undefined}
          organizationId={PROFILE_ORGANIZATION_ID}
          pending={false}
          profileDocumentId={missingId}
        />
      ),
    );
    try {
      expect(
        await view.findByText(
          kind === "roster"
            ? ORG_MANAGER_LABELS.profileDocumentUnavailable
            : ORG_MANAGER_LABELS.organizationProfileUnavailable,
        ),
      ).toBeTruthy();
      expect(view.queryByRole("textbox")).toBeNull();
      await f.assertOnlyOriginalRecord();
      expect(await f.durableState()).toEqual(before);
    } finally {
      view.unmount();
      restoreHost();
      f.close();
    }
  });
}
