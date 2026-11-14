import { expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  createProfileEditorHarness,
  installProfileEditorHost,
  PROFILE_ORGANIZATION_ID,
  profileEditorUser,
  UNKNOWN_PROFILE_ROW,
} from "../../../../test/helpers/org-manager/profileEditorHarness";
import { ORG_MANAGER_LABELS } from "../labels";
import { RosterProfileEditor } from "./RosterProfileEditor";

for (const canEdit of [false, true]) {
  test(`roster profile ${canEdit ? "edits" : "reads"} the discovered row after SDK restart`, async () => {
    const f = await createProfileEditorHarness("roster");
    const restoreHost = installProfileEditorHost(f.sdk);
    const before = await f.durableState();
    const view = render(
      <RosterProfileEditor
        canEdit={canEdit}
        isEditing={canEdit}
        organizationId={PROFILE_ORGANIZATION_ID}
        user={profileEditorUser(f.documentId)}
      />,
    );
    try {
      if (canEdit) {
        const input = await view.findByRole("textbox", {
          name: ORG_MANAGER_LABELS.firstName,
        });
        if (!(input instanceof HTMLInputElement))
          throw new Error("Expected input");
        expect(input.value).toBe("Ada");
        expect(input.disabled).toBe(false);
        fireEvent.change(input, { target: { value: "Augusta" } });
        fireEvent.blur(input);
        await waitFor(async () => {
          expect((await f.durableState()).history).not.toEqual(before.history);
        });
      } else {
        expect(await view.findByText("Ada")).toBeTruthy();
        expect(view.getByText("Lovelace")).toBeTruthy();
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
        firstName: canEdit ? "Augusta" : "Ada",
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
