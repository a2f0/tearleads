import { expect, test } from "bun:test";
import type { DocumentStore } from "@tearleads/client-sdk";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";
import { ContactAddresses } from "./ContactAddresses";
import type { ContactAddressEditorInput } from "./useContactAddressEditor";

function Editor({
  document,
  actions,
}: {
  document: DocumentStore;
  actions: Pick<
    ContactAddressEditorInput,
    "onAddAddress" | "onUpdateAddress" | "onRemoveAddress"
  >;
}) {
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  return (
    <ContactAddresses
      {...actions}
      rows={snapshot.rows}
      disabled={false}
      isEditing
      currentAuthorId={null}
    />
  );
}

for (const surface of addressSurfaces) {
  test(`${surface}: a failed creation retains its intent through edited retries and cannot be silently cancelled`, async () => {
    const f = await createAddressRetryHarness(surface);
    const view = render(<Editor document={f.document} actions={f.actions} />);
    try {
      fireEvent.click(view.getByRole("button", { name: "Add address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Original draft" },
      });
      f.fail();
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await view.findByRole("alert");
      expect(
        (
          view.getByRole("button", {
            name: "Cancel address editing",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(view.getByText(/already be applied locally/)).toBeTruthy();
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Edited draft" },
      });
      f.fail();
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await waitFor(() => expect(f.failures()).toBe(2));
      await waitFor(() =>
        expect(
          (
            view.getByRole("button", {
              name: "Save address",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      expect((await f.reopen()).rows).toHaveLength(0);
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await waitFor(() => expect(view.queryByRole("form")).toBeNull());
      expect(f.generatedIds).toHaveLength(1);
      const durable = await f.reopen();
      expect(durable.rows.map((row) => row.id)).toEqual(f.generatedIds);
      expect(durable.rows[0]?.fields).toMatchObject({ street: "Edited draft" });
      fireEvent.click(view.getByRole("button", { name: "Add address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Edited draft" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await waitFor(() => expect(view.queryByRole("form")).toBeNull());
      expect((await f.reopen()).rows).toHaveLength(2);
    } finally {
      view.unmount();
      f.close();
    }
  });

  test(`${surface}: unmount during recovery stops the edited follow-up write`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let held = false;
    let updates = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      setStructuredFields: async (...args) => {
        await store.setStructuredFields(...args);
        if (held) {
          entered.resolve();
          await release.promise;
        }
      },
      updateRowFields: async (...args) => {
        updates += 1;
        await store.updateRowFields(...args);
      },
    }));
    let completion: Promise<unknown> = Promise.resolve();
    const actions = {
      ...f.actions,
      onAddAddress: (...args: Parameters<typeof f.actions.onAddAddress>) => {
        const work = f.actions.onAddAddress(...args);
        completion = work.catch((error: unknown) => error);
        return work;
      },
    };
    const view = render(<Editor document={f.document} actions={actions} />);
    try {
      fireEvent.click(view.getByRole("button", { name: "Add address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Original" },
      });
      f.fail();
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await view.findByRole("alert");
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Must not be written" },
      });
      held = true;
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await act(async () => {
        await entered.promise;
      });
      view.unmount();
      release.resolve();
      expect(await completion).toBeInstanceOf(Error);
      expect(updates).toBe(0);
      expect((await f.reopen()).rows[0]?.fields).toMatchObject({
        street: "Original",
      });
    } finally {
      release.resolve();
      view.unmount();
      f.close();
    }
  });

  test(`${surface}: reverting a failed edit to its original value still persists the recovery`, async () => {
    const f = await createAddressRetryHarness(surface);
    await f.actions.onAddAddress(retryFields);
    const view = render(<Editor document={f.document} actions={f.actions} />);
    try {
      fireEvent.click(view.getByRole("button", { name: "Edit address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Failed change" },
      });
      f.fail();
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await view.findByRole("alert");
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: retryFields.street },
      });
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await waitFor(() => expect(view.queryByRole("form")).toBeNull());
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows[0]?.fields).toMatchObject({
        street: retryFields.street,
      });
    } finally {
      view.unmount();
      f.close();
    }
  });

  test(`${surface}: removal can be retried from the editor after the row vanishes`, async () => {
    const f = await createAddressRetryHarness(surface);
    const id = await f.actions.onAddAddress(retryFields);
    if (!id) throw new Error("Missing address");
    const view = render(<Editor document={f.document} actions={f.actions} />);
    try {
      f.fail();
      fireEvent.click(view.getByRole("button", { name: "Remove address" }));
      await view.findByRole("alert");
      await act(async () => {
        await f.document.removeRow(id);
      });
      await waitFor(() =>
        expect(
          view.queryByRole("button", { name: "Remove address" }),
        ).toBeNull(),
      );
      fireEvent.click(
        view.getByRole("button", { name: "Retry address removal" }),
      );
      await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
    } finally {
      view.unmount();
      f.close();
    }
  });
}
