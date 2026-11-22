import { expect, test } from "bun:test";
import type { LoroDoc } from "loro-crdt";
import { createDocument, exportUpdatesSince } from "./document";
import { isLoroRuntimeFailure } from "./runtimeFailure";
import { updateMatchesDocumentHistory } from "./updateIdentity";

test("a WebAssembly trap or exhausted memory is a runtime failure; a refusal is not", () => {
  expect(
    isLoroRuntimeFailure(new WebAssembly.RuntimeError("unreachable")),
  ).toBe(true);
  expect(isLoroRuntimeFailure(new RangeError("out of memory"))).toBe(true);
  expect(isLoroRuntimeFailure(new Error("Decode error"))).toBe(false);
  expect(isLoroRuntimeFailure("unreachable")).toBe(false);
});

test("an update proof throws a runtime failure instead of calling the update a mismatch", async () => {
  const doc = await createDocument("runtime-proof");
  doc.getText("text").update("held");
  doc.commit();
  const update = exportUpdatesSince(doc, undefined);
  expect(updateMatchesDocumentHistory(doc, update)).toBe(true);

  const trap = new WebAssembly.RuntimeError("unreachable");
  const trapping = new Proxy(doc, {
    get(target, property, receiver) {
      if (property === "export") {
        return () => {
          throw trap;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as LoroDoc;
  expect(() => updateMatchesDocumentHistory(trapping, update)).toThrow(trap);
  doc.free();
});
