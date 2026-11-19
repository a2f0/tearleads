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

test("subscribing keeps a choice made while storage writes are blocked", () => {
  const store = createStartMenuStore("test.blocked", ["notes"]);
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (!storage) throw new Error("Expected browser storage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Storage disabled");
    },
  });
  try {
    store.setVisible("notes", false);
    const unsubscribe = store.subscribe(() => {});
    try {
      expect(store.snapshot().get("notes")).toBe(false);
    } finally {
      unsubscribe();
    }
  } finally {
    Object.defineProperty(globalThis, "localStorage", storage);
  }
});
