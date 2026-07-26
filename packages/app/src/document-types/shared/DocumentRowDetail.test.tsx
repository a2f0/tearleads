import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { DocumentRowDetailOverlay } from "./DocumentRowDetail";

afterEach(() => cleanup());

function renderOverlay(showFieldValues: boolean) {
  return render(
    createElement(DocumentRowDetailOverlay, {
      createdAt: "2026-06-20T10:00:00.000Z",
      createdBy: "user-a",
      currentAuthorId: "user-a",
      fields: [
        { label: "Systolic", value: "128", writerUserId: "user-a" },
        { label: "Measured at", value: "2026-06-20", writerUserId: null },
      ],
      onClose: () => undefined,
      showFieldValues,
      title: "Reading 1",
      updatedAt: "2026-06-20T10:05:00.000Z",
      updatedBy: "user-a",
    }),
  );
}

// This modal stacks two key/value tables — Fields above History — which is the
// pairing the shared key/value table exists for: as independent `<table>`
// elements they would each size their key column to their own longest key, so
// History's values sat at a different indent from Fields' directly above them.
// Both must stay on MiniAppKeyValueTable for the shared column to hold; a
// regression here is silent, since each table still renders correctly alone.
test("row detail stacks two tables that share the key column", () => {
  const view = renderOverlay(true);

  const tables = view.container.querySelectorAll("table");
  expect(tables).toHaveLength(2);
  for (const table of Array.from(tables)) {
    expect(table.classList.contains("mini-app-info-table--aligned")).toBe(true);
    expect(table.classList.contains("mini-app-info-table--borderless")).toBe(
      true,
    );
  }
});

// The attribution-only view (blood pressure's kebab) drops the values but keeps
// the same two-table shape, so it needs the same column.
test("row detail keeps the shared key column without field values", () => {
  const view = renderOverlay(false);

  const tables = view.container.querySelectorAll("table");
  expect(tables).toHaveLength(2);
  for (const table of Array.from(tables)) {
    expect(table.classList.contains("mini-app-info-table--aligned")).toBe(true);
  }
});
