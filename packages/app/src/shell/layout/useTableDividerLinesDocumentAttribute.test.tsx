import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useTableDividerLinesDocumentAttribute } from "./useTableDividerLinesDocumentAttribute";

afterEach(cleanup);

function dividerLines(): string | null {
  return document.documentElement.getAttribute("data-table-divider-lines");
}

test("stamps the document root only while the divider lines are hidden", () => {
  const view = renderHook(
    ({ hidden }) => useTableDividerLinesDocumentAttribute(hidden),
    { initialProps: { hidden: false } },
  );
  expect(dividerLines()).toBeNull();

  view.rerender({ hidden: true });
  expect(dividerLines()).toBe("hidden");

  view.rerender({ hidden: false });
  expect(dividerLines()).toBeNull();

  view.rerender({ hidden: true });
  view.unmount();
  expect(dividerLines()).toBeNull();
});
