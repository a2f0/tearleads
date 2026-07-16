import { expect, test } from "bun:test";
import { createBlobStore } from "./createBlobStore";

test("createBlobStore fails closed when OPFS is unavailable", () => {
  expect(() => createBlobStore(crypto.randomUUID())).toThrow(
    "OPFS blob store is not supported.",
  );
});
