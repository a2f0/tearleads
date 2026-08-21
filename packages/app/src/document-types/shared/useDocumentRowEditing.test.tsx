import { afterEach, expect, test } from "bun:test";
import type { DocumentRow } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDocumentRowEditing } from "./useDocumentRowEditing";

afterEach(cleanup);

function row(id: string, fields: Record<string, string>): DocumentRow {
  return {
    id,
    fields,
    fieldEditors: {},
    createdBy: "",
    createdAt: "",
    createdByPeer: null,
    updatedBy: "",
    updatedAt: "",
    updatedByPeer: null,
  };
}

function renderEditing(rows: DocumentRow[]) {
  return renderHook(
    (props: { rows: DocumentRow[] }) => useDocumentRowEditing(props.rows),
    {
      initialProps: { rows },
    },
  );
}

test("readCell falls through to the store value until a cell is staged", () => {
  const { result } = renderEditing([row("r1", { key: "API" })]);

  expect(result.current.readCell("r1", "key", "API")).toBe("API");

  act(() => result.current.stageCell("r1", "key", "APP"));

  // The staged value is read immediately, before the store catches up.
  expect(result.current.readCell("r1", "key", "APP-store-lag")).toBe("APP");
});

test("an empty staged value is honored over the store value", () => {
  const { result } = renderEditing([row("r1", { key: "API" })]);

  act(() => result.current.stageCell("r1", "key", ""));

  expect(result.current.readCell("r1", "key", "API")).toBe("");
});

test("a staged cell clears once the store row catches up", () => {
  const { rerender, result } = renderEditing([row("r1", { key: "API" })]);

  act(() => result.current.stageCell("r1", "key", "APP"));
  act(() => rerender({ rows: [row("r1", { key: "APP" })] }));

  // Overlay cleared: a later store value now passes straight through.
  expect(result.current.readCell("r1", "key", "APP-next")).toBe("APP-next");
});

test("clearRow drops any staged cells for a removed row", () => {
  const { result } = renderEditing([row("r1", { key: "API", value: "x" })]);

  act(() => {
    result.current.stageCell("r1", "key", "APP");
    result.current.stageCell("r1", "value", "y");
  });
  act(() => result.current.clearRow("r1"));

  expect(result.current.readCell("r1", "key", "API")).toBe("API");
  expect(result.current.readCell("r1", "value", "x")).toBe("x");
});

test("staged cells for a vanished row clear automatically", () => {
  const { rerender, result } = renderEditing([row("r1", { key: "API" })]);

  act(() => result.current.stageCell("r1", "key", "APP"));
  act(() => rerender({ rows: [] }));

  // The row is gone, so its overlay entry is dropped and read-through resumes.
  expect(result.current.readCell("r1", "key", "store")).toBe("store");
});
