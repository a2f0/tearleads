import { expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
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
  test(`${kind} editor opens a profile discovered after its first lookup`, async () => {
    const f = await createProfileEditorHarness(kind, "write", "undiscovered");
    const restoreHost = installProfileEditorHost(f.sdk);
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
    const label =
      kind === "roster"
        ? ORG_MANAGER_LABELS.firstName
        : ORG_MANAGER_LABELS.organizationName;
    try {
      expect(
        await view.findByText(
          kind === "roster"
            ? ORG_MANAGER_LABELS.profileDocumentUnavailable
            : ORG_MANAGER_LABELS.organizationProfileUnavailable,
        ),
      ).toBeTruthy();
      expect(await f.sdk.documents.findLocalIdByDocumentId(f.documentId)).toBe(
        null,
      );
      await act(async () => {
        await f.discover();
      });
      const input = await view.findByRole("textbox", { name: label });
      if (!(input instanceof HTMLInputElement))
        throw new Error("Expected input");
      expect(input.value).toBe(
        kind === "roster" ? "Ada" : "Existing organization",
      );
      await f.assertOnlyOriginalRecord();
    } finally {
      view.unmount();
      restoreHost();
      f.close();
    }
  });
}
