import type { DocumentStore } from "@tearleads/client-sdk";
import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  CONTACT_ADDRESS_ROW_TYPE,
  type ContactAddressFields,
  isContactAddressRow,
} from "../../document-types/contact/contactAddressModel";

import {
  type ContactAddressCreationState,
  transitionContactAddressCreation,
} from "./contactAddressCreationState";

const SAVE_FAILURE = "Address changes could not be saved. Please try again.";
const queues = new WeakMap<DocumentStore, Promise<unknown>>();
const removals = new WeakMap<DocumentStore, Set<string>>();
const creations = new WeakMap<
  object,
  {
    store: DocumentStore;
    state: ContactAddressCreationState;
    current: () => boolean;
  }
>();

function trimFields(fields: Partial<ContactAddressFields>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (
        !CONTACT_ADDRESS_FIELD_DESCRIPTORS.some((field) => field.key === key) ||
        typeof value !== "string"
      )
        throw new Error("Invalid contact address field.");
      return [key, value.trim()];
    }),
  );
}

function captureWriter(store: DocumentStore, current: () => boolean) {
  const author = store.getSnapshot().currentAuthorId;
  return () => current() && store.getSnapshot().currentAuthorId === author;
}

function writable(store: DocumentStore, current: () => boolean) {
  const snapshot = store.getSnapshot();
  if (
    !current() ||
    !snapshot.ready ||
    !snapshot.canWrite ||
    snapshot.documentKind !== "contact"
  )
    throw new Error(SAVE_FAILURE);
  return snapshot;
}

function saved(store: DocumentStore, current: () => boolean, matches: boolean) {
  writable(store, current);
  if (!matches || store.hasUnsavedLocalEdits()) throw new Error(SAVE_FAILURE);
}

function queue<T>(
  store: DocumentStore,
  current: () => boolean,
  work: () => Promise<T>,
) {
  const result = (queues.get(store) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      writable(store, current);
      return work();
    });
  queues.set(
    store,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

async function flushPending(store: DocumentStore, current: () => boolean) {
  writable(store, current);
  if (store.hasUnsavedLocalEdits()) {
    await store.setStructuredFields("contact", {});
    saved(store, current, true);
  }
}

function address(store: DocumentStore, id: string, current: () => boolean) {
  const row = writable(store, current).rows.find((row) => row.id === id);
  if (!row || !isContactAddressRow(row)) throw new Error(SAVE_FAILURE);
  return row;
}

export async function updateContactAddressRow(
  store: DocumentStore,
  id: string,
  fields: Partial<ContactAddressFields>,
  guard: () => boolean,
): Promise<void> {
  const current = captureWriter(store, guard);
  const values = trimFields(fields);
  return queue(store, current, async () => {
    address(store, id, current);
    await flushPending(store, current);
    const row = address(store, id, current);
    const patch = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => value !== (row.fields[key] ?? ""),
      ),
    );
    if (Object.keys(patch).length) await store.updateRowFields(id, patch);
    const updated = address(store, id, current);
    saved(
      store,
      current,
      Object.entries(values).every(
        ([key, value]) => (updated.fields[key] ?? "") === value,
      ),
    );
  });
}

export async function removeContactAddressRow(
  store: DocumentStore,
  id: string,
  guard: () => boolean,
): Promise<void> {
  const current = captureWriter(store, guard);
  return queue(store, current, async () => {
    let pending = removals.get(store);
    if (!pending) {
      pending = new Set();
      removals.set(store, pending);
    }
    if (pending.has(id)) {
      // The current call must be authorized, but a closed editor must not
      // permanently block a fresh explicit deletion of the same row.
      await flushPending(store, current);
    } else {
      address(store, id, current);
      pending.add(id);
      await store.removeRow(id);
    }
    saved(
      store,
      current,
      !writable(store, current).rows.some((row) => row.id === id),
    );
    pending.delete(id);
  });
}

export async function addContactAddressRow(
  store: DocumentStore,
  fields: ContactAddressFields,
  intent: object,
  guard: () => boolean,
): Promise<string> {
  const current = captureWriter(store, guard);
  const values = trimFields(fields);
  return queue(store, current, async () => {
    const previous = creations.get(intent);
    if (previous) {
      if (
        previous.store !== store ||
        !previous.current() ||
        previous.state.status === "creating"
      )
        throw new Error(SAVE_FAILURE);
      // Flush the original delta without minting another row. Compare this
      // draft's edits to its last submission, not to other writers' live cells.
      await flushPending(store, current);
      const row = address(store, previous.state.id, current);
      previous.state = transitionContactAddressCreation(previous.state, {
        type: "edit",
        fields: values,
      });
      if (previous.state.status !== "updating") throw new Error(SAVE_FAILURE);
      const { id, patch } = previous.state;
      const changed = Object.fromEntries(
        Object.entries(patch).filter(
          ([key, value]) => value !== (row.fields[key] ?? ""),
        ),
      );
      if (Object.keys(changed).length) await store.updateRowFields(id, changed);
      const updated = address(store, id, current);
      saved(
        store,
        current,
        Object.entries(patch).every(
          ([key, value]) => (updated.fields[key] ?? "") === value,
        ),
      );
      previous.state = transitionContactAddressCreation(previous.state, {
        type: "saved",
      });
      return id;
    }
    const attempt = {
      store,
      state: { status: "creating" } as ContactAddressCreationState,
      current,
    };
    creations.set(intent, attempt);
    const id = await store.addRow({
      ...values,
      recordType: CONTACT_ADDRESS_ROW_TYPE,
    });
    attempt.state = transitionContactAddressCreation(attempt.state, {
      type: "created",
      id,
      fields: values,
    });
    const row = address(store, id, current);
    saved(
      store,
      current,
      Object.entries(values).every(([key, value]) => row.fields[key] === value),
    );
    return id;
  });
}
