import { expect, test } from "bun:test";
import { createStartMenuStore } from "./startMenuStore";

test("dotted app IDs and dotted host namespaces persist independently", () => {
  const first = createStartMenuStore("test.product", ["menu.notes"]);
  const second = createStartMenuStore("test.product.menu", ["notes"]);
  try {
    first.setVisible("menu.notes", false);
    second.setVisible("notes", true);
    second.reset();
    const restored = createStartMenuStore("test.product", ["menu.notes"]);
    expect(restored.snapshot().get("menu.notes")).toBe(false);
  } finally {
    first.reset();
    second.reset();
  }
});
