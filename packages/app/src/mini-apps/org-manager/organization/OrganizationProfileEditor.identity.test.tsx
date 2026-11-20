import { expect, spyOn, test } from "bun:test";
import {
  documentSyncOperation,
  updateOrganizationProfileOperation,
} from "@tearleads/validators/operation";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createProfileEditorHarness,
  installProfileEditorHost,
  PROFILE_ORGANIZATION_ID,
  UNKNOWN_PROFILE_ROW,
} from "../../../../test/helpers/org-manager/profileEditorHarness";
import * as documents from "../../../stores/documents/DocumentsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { OrganizationProfileEditor } from "./OrganizationProfileEditor";

for (const canEdit of [false, true]) {
  test(`organization profile ${canEdit ? "edits" : "reads"} the discovered row after SDK restart`, async () => {
    const f = await createProfileEditorHarness("organization");
    const restoreHost = installProfileEditorHost(f.sdk);
    const before = await f.durableState();
    const onNameChange = () => undefined;
    const editor = (pending: boolean) => (
      <OrganizationProfileEditor
        canEdit={canEdit}
        onNameChange={onNameChange}
        organizationId={PROFILE_ORGANIZATION_ID}
        pending={pending}
        profileDocumentId={f.documentId}
      />
    );
    const view = render(editor(false));
    try {
      if (canEdit) {
        const input = await view.findByRole("textbox", {
          name: ORG_MANAGER_LABELS.organizationName,
        });
        if (!(input instanceof HTMLInputElement))
          throw new Error("Expected input");
        expect(input.value).toBe("Existing organization");
        expect(input.disabled).toBe(false);
        fireEvent.change(input, { target: { value: "Edited organization" } });
        // A managed refresh must not remount the document or lose the draft.
        view.rerender(editor(true));
        expect(view.getByRole("textbox")).toBe(input);
        expect(input.value).toBe("Edited organization");
        view.rerender(editor(false));
        expect(view.getByRole("textbox")).toBe(input);
        expect(input.value).toBe("Edited organization");
        fireEvent.blur(input);
        await waitFor(async () => {
          expect((await f.durableState()).history).not.toEqual(before.history);
        });
      } else {
        expect(await view.findByText("Existing organization")).toBeTruthy();
        expect(view.queryByRole("textbox")).toBeNull();
        const after = await f.durableState();
        expect(after.history).toEqual(before.history);
        expect(after.pending).toEqual(before.pending);
      }
      await f.assertOnlyOriginalRecord();
      view.unmount();
      const reopened = await f.reopen();
      expect(reopened.structuredFields).toMatchObject({
        ...f.fields,
        name: canEdit ? "Edited organization" : "Existing organization",
      });
      expect(reopened.rows).toMatchObject([
        { id: f.rowId, fields: UNKNOWN_PROFILE_ROW },
      ]);
      await f.assertOnlyOriginalRecord();
    } finally {
      view.unmount();
      restoreHost();
      f.close();
    }
  });
}

test("the profile spinner follows only in-flight requests for the active profile", async () => {
  const f = await createProfileEditorHarness("organization");
  const lookup = Promise.withResolvers<null>();
  const restore = installProfileEditorHost(f.sdk, {
    ensureOrganizationMetadataContainer: () => lookup.promise,
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
  const spinner = () =>
    view.container.querySelector(".mini-app-state-panel-spinner");
  const { apiRequests, identity } = f.sdk;
  try {
    expect(
      view.getByText(ORG_MANAGER_LABELS.loadingOrganizationProfile),
    ).toBeTruthy();
    expect(spinner()).toBeNull();
    const begin = (id: string) =>
      apiRequests.beginResource(
        identity.signingFingerprint,
        documentSyncOperation,
        id,
      );
    const unrelated = begin("another-document");
    expect(spinner()).toBeNull();
    let finish = () => {};
    await act(async () => {
      const document = begin(f.documentId);
      finish = () => document();
    });
    expect(spinner()).not.toBeNull();
    await act(async () => finish());
    expect(spinner()).toBeNull();
    await act(async () => {
      const binding = apiRequests.beginResource(
        identity.signingFingerprint,
        updateOrganizationProfileOperation,
        PROFILE_ORGANIZATION_ID,
      );
      finish = () => binding();
    });
    expect(spinner()).not.toBeNull();
    await act(async () => {
      finish();
      unrelated();
    });
    expect(spinner()).toBeNull();
  } finally {
    view.unmount();
    lookup.resolve(null);
    restore();
    f.close();
  }
});

test("a local sync pass keeps the name field visible until the profile makes a request", async () => {
  const f = await createProfileEditorHarness("organization");
  const restore = installProfileEditorHost(f.sdk);
  const useDocument = documents.useDocument;
  const syncPass = spyOn(documents, "useDocument").mockImplementation(() => ({
    ...useDocument(),
    syncing: true,
  }));
  const view = render(
    <OrganizationProfileEditor
      canEdit
      onNameChange={() => undefined}
      organizationId={PROFILE_ORGANIZATION_ID}
      pending={false}
      profileDocumentId={f.documentId}
    />,
  );
  try {
    const field = await view.findByRole("textbox", {
      name: ORG_MANAGER_LABELS.organizationName,
    });
    expect(
      view.queryByText(ORG_MANAGER_LABELS.syncingOrganizationProfile),
    ).toBeNull();
    let settle = () => {};
    await act(async () => {
      const finish = f.sdk.apiRequests.beginResource(
        f.sdk.identity.signingFingerprint,
        documentSyncOperation,
        f.documentId,
      );
      settle = () => finish();
    });
    expect(
      view.getByText(ORG_MANAGER_LABELS.syncingOrganizationProfile),
    ).toBeTruthy();
    await act(async () => settle());
    expect(
      view.queryByText(ORG_MANAGER_LABELS.syncingOrganizationProfile),
    ).toBeNull();
    expect(view.getByRole("textbox")).toBe(field);
  } finally {
    view.unmount();
    syncPass.mockRestore();
    restore();
    f.close();
  }
});
