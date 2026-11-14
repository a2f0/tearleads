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
import { ContactAddressWriteRefusal } from "./contactAddressWriteRefusal";
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
  test(`${surface}: an initial missing-row update refusal can be cancelled for a new address`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let updates = 0;
    let flushes = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      updateRowFields: async (...args) => {
        updates += 1;
        await store.updateRowFields(...args);
      },
      setStructuredFields: async (...args) => {
        flushes += 1;
        await store.setStructuredFields(...args);
      },
    }));
    const id = await f.actions.onAddAddress(retryFields);
    if (!id) throw new Error("Missing address");
    updates = 0;
    flushes = 0;
    let completion: Promise<unknown> = Promise.resolve();
    const actions = {
      ...f.actions,
      onAddAddress: (...args: Parameters<typeof f.actions.onAddAddress>) => {
        const work = f.actions.onAddAddress(...args);
        completion = work.catch((error: unknown) => error);
        return work;
      },
      onUpdateAddress: (
        ...args: Parameters<typeof f.actions.onUpdateAddress>
      ) => {
        const work = (async () => {
          entered.resolve();
          await release.promise;
          return f.actions.onUpdateAddress(...args);
        })();
        completion = work.catch((error: unknown) => error);
        return work;
      },
    };
    const view = render(<Editor document={f.document} actions={actions} />);
    try {
      fireEvent.click(view.getByRole("button", { name: "Edit address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Must never be written" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await act(async () => {
        await Promise.race([
          entered.promise,
          completion.then(() => {
            throw new Error("Update settled before reaching the barrier");
          }),
        ]);
      });
      expect(updates).toBe(0);
      expect(flushes).toBe(0);
      // The editor has accepted a real row. Another writer removes it before
      // forwarding this first update to the adapter's initial address lookup.
      await act(async () => {
        await f.document.removeRow(id);
      });
      expect(f.document.getSnapshot().rows).toHaveLength(0);
      let outcome: unknown;
      await act(async () => {
        release.resolve();
        outcome = await completion;
      });
      expect(updates).toBe(0);
      expect(flushes).toBe(0);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
      await view.findByRole("alert");
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).toBeInstanceOf(ContactAddressWriteRefusal);
      const cancel = view.getByRole("button", {
        name: "Cancel address editing",
      }) as HTMLButtonElement;
      expect(cancel.disabled).toBe(false);
      expect(view.queryByText(/already be applied locally/)).toBeNull();
      fireEvent.click(cancel);
      expect(view.queryByRole("form")).toBeNull();
      expect(view.queryByRole("alert")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Add address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "New address after adapter refusal" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await act(async () => {
        await completion;
      });
      await waitFor(() => expect(view.queryByRole("form")).toBeNull());
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      const durable = await f.reopen();
      expect(durable.rows).toHaveLength(1);
      const [created] = durable.rows;
      if (!created) throw new Error("Missing new address");
      expect(created.id).not.toBe(id);
      expect(created.fields).toMatchObject({
        street: "New address after adapter refusal",
      });
      expect(f.generatedIds).toEqual([id, created.id]);
    } finally {
      await act(async () => {
        release.resolve();
        await completion;
      });
      view.unmount();
      f.close();
    }
  });
}
