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
type CreationAttempt = {
  store: DocumentStore;
  state: ContactAddressCreationState;
  current: () => boolean;
};
const creations = new WeakMap<object, CreationAttempt>();

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

function canWrite(store: DocumentStore, current: () => boolean) {
  const snapshot = store.getSnapshot();
  return (
    current() &&
    snapshot.ready &&
    snapshot.canWrite &&
    snapshot.documentKind === "contact"
  );
}

function writable(store: DocumentStore, current: () => boolean) {
  if (!canWrite(store, current)) throw new Error(SAVE_FAILURE);
  return store.getSnapshot();
}

function mutationOptions(store: DocumentStore, current: () => boolean) {
  // The SDK may wait on its own write queue after our preflight succeeds.
  return { stillCurrent: () => canWrite(store, current) };
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
    await store.setStructuredFields(
      "contact",
      {},
      mutationOptions(store, current),
    );
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
    if (Object.keys(patch).length)
      await store.updateRowFields(id, patch, mutationOptions(store, current));
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
    }
    // A previous SDK refusal may have made no mutation. After flushing any
    // pending delta, remove a still-present row rather than treating an attempt
    // as evidence of deletion.
    if (writable(store, current).rows.some((row) => row.id === id)) {
      address(store, id, current);
      await store.removeRow(id, mutationOptions(store, current));
    }
    saved(
      store,
      current,
      !writable(store, current).rows.some((row) => row.id === id),
    );
    pending.delete(id);
  });
}

function reconcileCreation(attempt: CreationAttempt, current: () => boolean) {
  const { state, store } = attempt;
  if (state.status !== "unconfirmed") return;
  // A returned ID proves neither mutation nor persistence. Only absence after
  // pending deltas are saved permits a fresh add; dirty snapshots can omit a
  // real live creation, or the dirty delta can belong to an unrelated edit.
  saved(store, current, true);
  attempt.state = transitionContactAddressCreation(state, {
    type: "reconciled",
    exists: writable(store, current).rows.some((row) => row.id === state.id),
  });
}

async function editCreation(
  attempt: CreationAttempt,
  values: Readonly<Record<string, string>>,
  current: () => boolean,
) {
  const { store, state } = attempt;
  if (state.status !== "identified" && state.status !== "updating")
    throw new Error(SAVE_FAILURE);
  const row = address(store, state.id, current);
  // Compare this draft with its last submission, not other writers' live cells.
  attempt.state = transitionContactAddressCreation(state, {
    type: "edit",
    fields: values,
  });
  if (attempt.state.status !== "updating") throw new Error(SAVE_FAILURE);
  const { id, patch } = attempt.state;
  const changed = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => value !== (row.fields[key] ?? ""),
    ),
  );
  if (Object.keys(changed).length)
    await store.updateRowFields(id, changed, mutationOptions(store, current));
  const updated = address(store, id, current);
  saved(
    store,
    current,
    Object.entries(patch).every(
      ([key, value]) => (updated.fields[key] ?? "") === value,
    ),
  );
  attempt.state = transitionContactAddressCreation(attempt.state, {
    type: "saved",
  });
  return id;
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
    if (
      previous &&
      (previous.store !== store ||
        !previous.current() ||
        previous.state.status === "creating")
    )
      throw new Error(SAVE_FAILURE);
    const attempt: CreationAttempt = previous ?? {
      store,
      state: { status: "creating" },
      current,
    };
    // Keep the original lifetime even after a confirmed no-effect refusal.
    const authorized = () => current() && attempt.current();
    if (previous) {
      await flushPending(store, authorized);
      reconcileCreation(attempt, authorized);
      if (attempt.state.status !== "creating")
        return editCreation(attempt, values, authorized);
    }
    creations.set(intent, attempt);
    writable(store, authorized);
    const id = await store.addRow(
      {
        ...values,
        recordType: CONTACT_ADDRESS_ROW_TYPE,
      },
      mutationOptions(store, authorized),
    );
    attempt.state = transitionContactAddressCreation(attempt.state, {
      type: "returned",
      id,
      fields: values,
    });
    const row = address(store, id, authorized);
    saved(
      store,
      authorized,
      Object.entries(values).every(([key, value]) => row.fields[key] === value),
    );
    reconcileCreation(attempt, authorized);
    return id;
  });
}
