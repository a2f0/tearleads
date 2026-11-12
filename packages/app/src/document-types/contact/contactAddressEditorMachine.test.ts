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
  ).toEqual({ status: "removeFailed", id: "stable-id", error: "Retry" });
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
  expect(retry).toEqual({ status: "removing", id: "row", requestId: 2 });
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
    transition(idle, { type: "change", key: "street", value: "Ignored" }),
  ).toBe(idle);
});
