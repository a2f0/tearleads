import { expect, test } from "bun:test";
import { createMockRequestFailure } from "./createMockRequestFailure";

test("mock failures supply every current transport field", () => {
  const failure = createMockRequestFailure({ message: "Offline" });
  expect(failure).toMatchObject({
    ok: false,
    kind: "network",
    method: "POST",
    path: "mock-request",
    status: null,
    statusText: "",
    message: "Offline",
  });
  expect(failure.report()).toBeUndefined();
});

test("mock failures preserve explicit transport metadata and reporting", () => {
  let reports = 0;
  const failure = createMockRequestFailure({
    message: "Conflict",
    status: 409,
    statusText: "Conflict",
    code: "document_update_id_conflict",
    method: "GET",
    path: "/documents/example/writer-projection",
    report: () => {
      reports += 1;
    },
  });
  expect(failure.kind).toBe("http");
  expect(failure.method).toBe("GET");
  expect(failure.statusText).toBe("Conflict");
  expect(failure.code).toBe("document_update_id_conflict");
  expect(failure.path).toBe("/documents/example/writer-projection");
  failure.report();
  expect(reports).toBe(1);
});
