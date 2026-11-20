import { expect, spyOn, test } from "bun:test";
import { documentSyncOperation } from "@tearleads/validators/operation";
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

test("the mounted profile shows the spinner only for its own HTTP request", async () => {
  const f = await createProfileEditorHarness("organization");
  f.sdk.session.setContext({
    isAuthenticated: true,
    authToken: "profile-test-session",
    organizationId: PROFILE_ORGANIZATION_ID,
  });
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
  const response = Promise.withResolvers<Response>();
  const otherOrganization = "11111111-1111-4111-8111-111111111111";
  const otherResponse = Promise.withResolvers<Response>();
  const fetchSpy = spyOn(globalThis, "fetch")
    .mockReturnValueOnce(otherResponse.promise)
    .mockReturnValue(response.promise);
  try {
    expect(
      view.getByText(ORG_MANAGER_LABELS.loadingOrganizationProfile),
    ).toBeTruthy();
    expect(spinner()).toBeNull();
    const client = f.sdk.documents.workflowRuntime().apiClient;
    const other = client.updateOrganizationProfile(otherOrganization, {
      profileDocumentId: null,
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(spinner()).toBeNull();
    // Exercise the SDK facade and its real request instrumentation. Hold the
    // transport response while the component's local lookup is still pending.
    const pending = f.sdk.organizations.updateProfile(f.documentId);
    await waitFor(() => expect(spinner()).not.toBeNull());
    const [path, init] = fetchSpy.mock.calls[1] ?? [];
    expect(String(path)).toEndWith(
      `/organizations/${PROFILE_ORGANIZATION_ID}/profile`,
    );
    expect(init?.method).toBe("PUT");
    const updated = {
      organizationId: PROFILE_ORGANIZATION_ID,
      profileDocumentId: f.documentId,
    };
    await act(async () => {
      response.resolve(Response.json(updated));
      expect(await pending).toEqual(updated);
    });
    expect(spinner()).toBeNull();
    expect(
      view.getByText(ORG_MANAGER_LABELS.loadingOrganizationProfile),
    ).toBeTruthy();
    otherResponse.resolve(
      Response.json({
        organizationId: otherOrganization,
        profileDocumentId: null,
      }),
    );
    expect(await other).not.toBeNull();
  } finally {
    otherResponse.resolve(new Response(null, { status: 503 }));
    response.resolve(new Response(null, { status: 503 }));
    fetchSpy.mockRestore();
    view.unmount();
    lookup.resolve(null);
    restore();
    f.close();
  }
});

for (const { syncing, canEdit } of [
  { syncing: true, canEdit: true },
  { syncing: false, canEdit: true },
  { syncing: false, canEdit: false },
]) {
  test(`a ready profile follows its request with syncing=${syncing} and canEdit=${canEdit}`, async () => {
    const f = await createProfileEditorHarness("organization");
    const restore = installProfileEditorHost(f.sdk);
    const useDocument = documents.useDocument;
    const syncPass = spyOn(documents, "useDocument").mockImplementation(() => ({
      ...useDocument(),
      syncing,
    }));
    const view = render(
      <OrganizationProfileEditor
        canEdit={canEdit}
        onNameChange={() => undefined}
        organizationId={PROFILE_ORGANIZATION_ID}
        pending={false}
        profileDocumentId={f.documentId}
      />,
    );
    try {
      const field = canEdit
        ? await view.findByRole("textbox", {
            name: ORG_MANAGER_LABELS.organizationName,
          })
        : await view.findByText("Existing organization");
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
      expect(field.isConnected).toBe(true);
    } finally {
      view.unmount();
      syncPass.mockRestore();
      restore();
      f.close();
    }
  });
}
