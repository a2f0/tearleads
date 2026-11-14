import { expect, test } from "bun:test";
import {
  type ContactAddressEditorState,
  transitionContactAddressEditor as transition,
} from "./contactAddressEditorMachine";
import { readContactAddressFields } from "./contactAddressModel";

const values = readContactAddressFields({ street: "Original" });
const idle: ContactAddressEditorState = { status: "idle" };

test("address editor ignores stale success and failure after a retry", () => {
  const editing = transition(idle, { type: "edit", id: "stable-id", values });
  const first = transition(editing, { type: "save", requestId: 1 });
  const refused = transition(first, {
    type: "failed",
    requestId: 1,
    error: "Retry",
  });
  const second = transition(refused, { type: "save", requestId: 2 });
  expect(transition(second, { type: "saved", requestId: 1 })).toBe(second);
  expect(
    transition(second, { type: "failed", requestId: 1, error: "Late" }),
  ).toBe(second);
  expect(
    transition(second, { type: "refused", requestId: 1, error: "Late" }),
  ).toBe(second);
  expect(transition(second, { type: "saved", requestId: 2 })).toEqual(idle);
});

test("pending operations cannot be replaced or cancelled", () => {
  const editing = transition(idle, { type: "edit", id: null, values });
  const saving = transition(editing, { type: "save", requestId: 1 });
  const removing = transition(idle, {
    type: "remove",
    id: "stable-id",
    requestId: 2,
  });
  for (const state of [saving, removing]) {
    expect(transition(state, { type: "cancel" })).toBe(state);
    expect(transition(state, { type: "edit", id: "other", values })).toBe(
      state,
    );
    expect(
      transition(state, { type: "change", key: "street", value: "Other" }),
    ).toBe(state);
    expect(transition(state, { type: "save", requestId: 3 })).toBe(state);
    expect(
      transition(state, { type: "remove", id: "other", requestId: 3 }),
    ).toBe(state);
  }
  expect(
    transition(removing, { type: "failed", requestId: 2, error: "Retry" }),
  ).toEqual({
    status: "removeFailed",
    id: "stable-id",
    recovery: "unconfirmed",
    error: "Retry",
  });
  expect(transition(removing, { type: "saved", requestId: 2 })).toEqual(idle);
});

test("failed drafts retain their creation intent and cannot be silently discarded", () => {
  const editing = transition(idle, { type: "edit", id: null, values });
  if (editing.status !== "editing") throw new Error("Missing draft");
  const saving = transition(editing, { type: "save", requestId: 1 });
  const failed = transition(saving, {
    type: "failed",
    requestId: 1,
    error: "Retry",
  });
  expect(transition(failed, { type: "cancel" })).toBe(failed);
  const changed = transition(failed, {
    type: "change",
    key: "street",
    value: "Edited",
  });
  if (changed.status !== "editing") throw new Error("Missing retry draft");
  expect(changed.draft.intent).toBe(editing.draft.intent);
  const retry = transition(changed, { type: "save", requestId: 2 });
  const completed = transition(retry, { type: "saved", requestId: 2 });
  const next = transition(completed, { type: "edit", id: null, values });
  if (next.status !== "editing") throw new Error("Missing new draft");
  expect(next.draft.intent).not.toBe(editing.draft.intent);
});

test("an uncertain failed update cannot be discarded and retries reverted submitted cells only", () => {
  const editing = transition(idle, { type: "edit", id: "stable-id", values });
  const changed = transition(editing, {
    type: "change",
    key: "street",
    value: "Possibly applied locally",
  });
  const saving = transition(changed, { type: "save", requestId: 1 });
  const failed = transition(saving, {
    type: "failed",
    requestId: 1,
    error: "Persistence outcome is unknown",
  });
  expect(transition(failed, { type: "cancel" })).toBe(failed);
  expect(transition(failed, { type: "edit", id: null, values })).toBe(failed);
  expect(
    transition(failed, { type: "remove", id: "stable-id", requestId: 2 }),
  ).toBe(failed);
  const reverted = transition(failed, {
    type: "change",
    key: "street",
    value: values.street,
  });
  expect(transition(reverted, { type: "cancel" })).toBe(reverted);
  const retry = transition(reverted, { type: "save", requestId: 3 });
  if (retry.status !== "saving" || editing.status !== "editing")
    throw new Error("Missing update retry");
  expect(retry.draft.intent).toBe(editing.draft.intent);
  expect(retry.draft.submitted).toEqual({ street: values.street });
  const failedAgain = transition(retry, {
    type: "failed",
    requestId: 3,
    error: "Persistence still unconfirmed",
  });
  expect(transition(failedAgain, { type: "cancel" })).toBe(failedAgain);
});

test("failed removals retain their target and only accept a retry for that row", () => {
  const removing = transition(idle, {
    type: "remove",
    id: "row",
    requestId: 1,
  });
  const failed = transition(removing, {
    type: "failed",
    requestId: 1,
    error: "Retry",
  });
  expect(transition(failed, { type: "cancel" })).toBe(failed);
  expect(transition(failed, { type: "edit", id: null, values })).toBe(failed);
  expect(
    transition(failed, { type: "remove", id: "other", requestId: 2 }),
  ).toBe(failed);
  const retry = transition(failed, { type: "remove", id: "row", requestId: 2 });
  expect(retry).toEqual({
    status: "removing",
    id: "row",
    recovery: "unconfirmed",
    requestId: 2,
  });
  expect(transition(retry, { type: "saved", requestId: 1 })).toBe(retry);
  expect(transition(retry, { type: "saved", requestId: 2 })).toEqual(idle);
});

test("cancelled forms cannot receive a stale completion", () => {
  const editing = transition(idle, { type: "edit", id: "first", values });
  const cancelled = transition(editing, { type: "cancel" });
  const next = transition(cancelled, { type: "edit", id: "next", values });
  expect(transition(next, { type: "saved", requestId: 1 })).toBe(next);
  expect(
    transition(next, { type: "failed", requestId: 1, error: "Late" }),
  ).toBe(next);
  expect(
    transition(next, { type: "refused", requestId: 1, error: "Late" }),
  ).toBe(next);
  expect(
    transition(idle, { type: "change", key: "street", value: "Ignored" }),
  ).toBe(idle);
});

test.each([null, "stable-id"])(
  "a first no-effect save refusal allows cancellation for %s",
  (id) => {
    const editing = transition(idle, { type: "edit", id, values });
    const changed = transition(editing, {
      type: "change",
      key: "street",
      value: "Never applied",
    });
    const saving = transition(changed, { type: "save", requestId: 1 });
    const refused = transition(saving, {
      type: "refused",
      requestId: 1,
      error: "No mutation attempted",
    });
    if (refused.status !== "editing" || changed.status !== "editing")
      throw new Error("Missing refused draft");
    expect(refused.draft).toEqual(changed.draft);
    expect(refused.draft.intent).toBe(changed.draft.intent);
    expect(refused.error).toBe("No mutation attempted");
    expect(transition(refused, { type: "cancel" })).toEqual(idle);
  },
);

test.each([null, "stable-id"])(
  "a refused retry preserves earlier uncertain cells and intent for %s",
  (id) => {
    const editing = transition(idle, { type: "edit", id, values });
    const changed = transition(editing, {
      type: "change",
      key: "street",
      value: "Possibly applied",
    });
    const failed = transition(
      transition(changed, { type: "save", requestId: 1 }),
      { type: "failed", requestId: 1, error: "Unconfirmed" },
    );
    const reverted = transition(failed, {
      type: "change",
      key: "street",
      value: values.street,
    });
    const expanded = transition(reverted, {
      type: "change",
      key: "locality",
      value: "Never applied",
    });
    const retry = transition(expanded, { type: "save", requestId: 2 });
    expect(
      transition(retry, { type: "refused", requestId: 1, error: "Late" }),
    ).toBe(retry);
    const refused = transition(retry, {
      type: "refused",
      requestId: 2,
      error: "No mutation attempted",
    });
    if (refused.status !== "editing" || failed.status !== "editing")
      throw new Error("Missing recovery draft");
    expect(refused.draft.submitted).toBe(failed.draft.submitted);
    expect(refused.draft.submitted).toEqual({ street: "Possibly applied" });
    expect(refused.draft.intent).toBe(failed.draft.intent);
    expect(transition(refused, { type: "cancel" })).toBe(refused);
    const restored = transition(refused, {
      type: "change",
      key: "locality",
      value: values.locality,
    });
    const third = transition(restored, { type: "save", requestId: 3 });
    if (third.status !== "saving") throw new Error("Missing third attempt");
    expect(third.draft.submitted).toEqual({ street: values.street });
    expect(third.draft.intent).toBe(failed.draft.intent);
    expect(
      transition(third, { type: "refused", requestId: 2, error: "Late" }),
    ).toBe(third);
    expect(transition(third, { type: "saved", requestId: 3 })).toEqual(idle);
  },
);

test.each(["refused", "failed"] as const)(
  "a refused removal retry preserves the earlier %s outcome",
  (type) => {
    const first = transition(idle, {
      type: "remove",
      id: "row",
      requestId: 1,
    });
    const failed = transition(first, { type, requestId: 1, error: "Retry" });
    const recovery = type === "failed" ? "unconfirmed" : "none";
    expect(failed).toMatchObject({ status: "removeFailed", recovery });
    const retry = transition(failed, {
      type: "remove",
      id: "row",
      requestId: 2,
    });
    expect(
      transition(retry, { type: "refused", requestId: 1, error: "Late" }),
    ).toBe(retry);
    const refused = transition(retry, {
      type: "refused",
      requestId: 2,
      error: "No mutation attempted",
    });
    expect(refused).toEqual({
      status: "removeFailed",
      id: "row",
      recovery,
      error: "No mutation attempted",
    });
    expect(transition(refused, { type: "cancel" })).toEqual(
      type === "failed" ? refused : idle,
    );
    const third = transition(refused, {
      type: "remove",
      id: "row",
      requestId: 3,
    });
    expect(transition(third, { type: "saved", requestId: 3 })).toEqual(idle);
  },
);
