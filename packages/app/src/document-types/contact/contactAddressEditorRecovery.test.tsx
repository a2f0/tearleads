import { expect, test } from "bun:test";
import type { DocumentStore } from "@tearleads/client-sdk";
import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";
import { ContactAddresses } from "./ContactAddresses";
import { ContactAddressWriteRefusal } from "./contactAddressWriteRefusal";
import {
  type ContactAddressEditorInput,
  useContactAddressEditor,
} from "./useContactAddressEditor";

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
  test(`${surface}: an edit refused before invoking its adapter can be cancelled for a new address`, async () => {
    const f = await createAddressRetryHarness(surface);
    const id = await f.actions.onAddAddress(retryFields);
    if (!id) throw new Error("Missing address");
    let updates = 0;
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
        updates += 1;
        const work = f.actions.onUpdateAddress(...args);
        completion = work.catch((error: unknown) => error);
        return work;
      },
    };
    const view = render(<Editor document={f.document} actions={actions} />);
    try {
      fireEvent.click(view.getByRole("button", { name: "Edit address" }));
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Never submitted to the adapter" },
      });
      // Model another writer deleting the row, with persistence complete
      // before the retained draft is submitted to the real editor hook.
      await act(async () => {
        await f.document.removeRow(id);
      });
      await waitFor(() =>
        expect(
          view.queryByRole("button", { name: "Remove address" }),
        ).toBeNull(),
      );
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      expect((await view.findByRole("alert")).textContent).toContain(
        "no longer available",
      );
      expect(updates).toBe(0);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
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
        target: { value: "New address after refusal" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
      await waitFor(() => expect(view.queryByRole("form")).toBeNull());
      const durable = await f.reopen();
      expect(durable.rows).toHaveLength(1);
      const [created] = durable.rows;
      if (!created) throw new Error("Missing new address");
      expect(created.id).not.toBe(id);
      expect(created.fields).toMatchObject({
        street: "New address after refusal",
      });
      expect(f.generatedIds).toEqual([id, created.id]);
      expect(updates).toBe(0);
    } finally {
      await act(async () => {
        await completion;
      });
      view.unmount();
      f.close();
    }
  });

  test(`${surface}: a removal refused before its first SDK mutation can be dismissed for a new address`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let removals = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      removeRow: async (...args) => {
        removals += 1;
        await store.removeRow(...args);
      },
    }));
    const id = await f.actions.onAddAddress(retryFields);
    if (!id) throw new Error("Missing address");
    let completion: Promise<unknown> = Promise.resolve();
    const actions = {
      ...f.actions,
      onAddAddress: (...args: Parameters<typeof f.actions.onAddAddress>) => {
        const work = f.actions.onAddAddress(...args);
        completion = work.catch((error: unknown) => error);
        return work;
      },
      onRemoveAddress: (
        ...args: Parameters<typeof f.actions.onRemoveAddress>
      ) => {
        const work = (async () => {
          entered.resolve();
          await release.promise;
          return f.actions.onRemoveAddress(...args);
        })();
        completion = work.catch((error: unknown) => error);
        return work;
      },
    };
    const hook = renderHook(() => {
      const snapshot = useSyncExternalStore(
        f.document.subscribe,
        f.document.getSnapshot,
      );
      return useContactAddressEditor({
        ...actions,
        rows: snapshot.rows,
        disabled: false,
        isEditing: true,
      });
    });
    try {
      act(() => hook.result.current.remove(id));
      await act(async () => {
        await Promise.race([
          entered.promise,
          completion.then(() => {
            throw new Error("Removal settled before reaching the barrier");
          }),
        ]);
      });
      expect(hook.result.current.state.status).toBe("removing");
      expect(removals).toBe(0);
      // Another writer removes the row before the real adapter reaches its
      // address lookup/pending.add, not after a failed live deletion.
      await act(async () => {
        await f.document.removeRow(id);
      });
      let outcome: unknown;
      await act(async () => {
        release.resolve();
        outcome = await completion;
      });
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).toBeInstanceOf(ContactAddressWriteRefusal);
      await waitFor(() =>
        expect(hook.result.current.state).toMatchObject({
          id,
          error: expect.any(String),
        }),
      );
      expect(removals).toBe(1); // Only the other writer's deletion.
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
      act(() => hook.result.current.dispatch({ type: "cancel" }));
      expect(hook.result.current.state).toEqual({ status: "idle" });
      act(() =>
        hook.result.current.dispatch({
          type: "edit",
          id: null,
          values: { ...retryFields, street: "New address after refusal" },
        }),
      );
      act(() => hook.result.current.save());
      await act(async () => {
        await completion;
      });
      await waitFor(() =>
        expect(hook.result.current.state).toEqual({ status: "idle" }),
      );
      const durable = await f.reopen();
      expect(durable.rows).toHaveLength(1);
      const [created] = durable.rows;
      if (!created) throw new Error("Missing new address");
      expect(created.id).not.toBe(id);
      expect(created.fields).toMatchObject({
        street: "New address after refusal",
      });
      expect(f.generatedIds).toEqual([id, created.id]);
      expect(removals).toBe(1);
    } finally {
      await act(async () => {
        release.resolve();
        await completion;
      });
      hook.unmount();
      f.close();
    }
  });

  test(`${surface}: the removal Dismiss control releases only a proven no-effect refusal`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = await createAddressRetryHarness(surface);
    const id = await f.actions.onAddAddress(retryFields);
    if (!id) throw new Error("Missing address");
    let completion: Promise<unknown> = Promise.resolve();
    const actions = {
      ...f.actions,
      onRemoveAddress: (
        ...args: Parameters<typeof f.actions.onRemoveAddress>
      ) => {
        const work = (async () => {
          entered.resolve();
          await release.promise;
          return f.actions.onRemoveAddress(...args);
        })();
        completion = work.catch((error: unknown) => error);
        return work;
      },
    };
    const view = render(<Editor document={f.document} actions={actions} />);
    try {
      fireEvent.click(view.getByRole("button", { name: "Remove address" }));
      await act(async () => {
        await Promise.race([
          entered.promise,
          completion.then(() => {
            throw new Error("Removal settled before reaching the barrier");
          }),
        ]);
        // Another writer completes deletion before the fresh adapter lookup.
        await f.document.removeRow(id);
        release.resolve();
        await completion;
      });
      await view.findByRole("alert");
      expect(await completion).toBeInstanceOf(ContactAddressWriteRefusal);
      const add = view.getByRole("button", {
        name: "Add address",
      }) as HTMLButtonElement;
      expect(add.disabled).toBe(true);
      fireEvent.click(
        view.getByRole("button", { name: "Dismiss address removal" }),
      );
      expect(view.queryByRole("alert")).toBeNull();
      expect(
        view.queryByRole("button", { name: "Retry address removal" }),
      ).toBeNull();
      expect(add.disabled).toBe(false);
      fireEvent.click(add);
      expect(view.getByRole("form", { name: "Address editor" })).toBeTruthy();
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
    } finally {
      await act(async () => {
        release.resolve();
        await completion;
      });
      view.unmount();
      f.close();
    }
  });

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
      expect(
        view.queryByRole("button", { name: "Dismiss address removal" }),
      ).toBeNull();
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
