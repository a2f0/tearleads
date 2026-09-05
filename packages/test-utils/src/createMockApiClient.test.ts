import { expect, test } from "bun:test";
import { createMockApiClient } from "./createMockApiClient";
import { createMockRequestFailure } from "./createMockRequestFailure";

test("undefined projection-result overrides use the current derived defaults", async () => {
  const overrides = {};
  Reflect.set(overrides, "getDocumentWriterProjectionResult", undefined);
  Reflect.set(overrides, "getContainerWriterProjectionResult", undefined);
  const client = createMockApiClient(overrides);
  expect(await client.getDocumentWriterProjectionResult("doc")).toMatchObject({
    ok: false,
  });
  expect(
    await client.getContainerWriterProjectionResult("container"),
  ).toMatchObject({ ok: false });
});

test("explicit projection-result overrides remain authoritative", () => {
  const result = async () =>
    createMockRequestFailure({ message: "Explicit failure" });
  const client = createMockApiClient({
    getContainerWriterProjectionResult: result,
    getDocumentWriterProjectionResult: result,
  });
  expect(client.getContainerWriterProjectionResult).toBe(result);
  expect(client.getDocumentWriterProjectionResult).toBe(result);
});
