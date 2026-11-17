import { expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
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
  test(`${kind} editor keeps an unblurred draft across non-scope runtime notifications`, async () => {
    const f = await createProfileEditorHarness(kind);
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
    const loading =
      kind === "roster"
        ? ORG_MANAGER_LABELS.loadingProfileDocument
        : ORG_MANAGER_LABELS.loadingOrganizationProfile;
    const name =
      kind === "roster"
        ? ORG_MANAGER_LABELS.firstName
        : ORG_MANAGER_LABELS.organizationName;
    // Type in the first microtask after the commit that inserts the field.
    // React yields to the host after that commit and runs its passive effects
    // in a later task, so this is the earliest keystroke a user can land on
    // the painted field; nothing the field defers past mount may replace it.
    const typeOnInsertion = new MutationObserver(() => {
      const field = view.queryByRole("textbox", { name });
      if (!field) return;
      typeOnInsertion.disconnect();
      fireEvent.change(field, { target: { value: "Unsaved draft" } });
    });
    typeOnInsertion.observe(view.container, { childList: true, subtree: true });
    try {
      const input = await view.findByRole("textbox", { name });
      if (!(input instanceof HTMLInputElement))
        throw new Error("Expected input");
      const version = f.sdk.runtime.version;
      // Session sync mode notifies the runtime without changing the documents
      // scope (domain, database, principal, or signing keys).
      await act(async () => {
        f.sdk.session.setSyncEnabled(false);
      });
      expect(f.sdk.runtime.version).not.toBe(version);
      expect(view.queryByText(loading)).toBeNull();
      expect(input.isConnected).toBe(true);
      expect(input.value).toBe("Unsaved draft");
      // A principal change does change the scope and must hide the content on
      // that render, before the replacement binding resolves.
      act(() => {
        f.sdk.session.setUserId("00000000-0000-4000-8000-000000000098");
      });
      expect(input.isConnected).toBe(false);
      expect(view.getByText(loading)).toBeTruthy();
    } finally {
      typeOnInsertion.disconnect();
      view.unmount();
      restoreHost();
      f.close();
    }
  });
}
