import { expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  createProfileEditorHarness,
  installProfileEditorHost,
  PROFILE_ORGANIZATION_ID,
  UNKNOWN_PROFILE_ROW,
} from "../../../../test/helpers/org-manager/profileEditorHarness";
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
