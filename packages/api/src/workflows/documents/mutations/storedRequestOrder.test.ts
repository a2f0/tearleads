import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { assertStoredInRequestOrder } from "./appendOutgoingUpdates";
import { DocumentMutationError } from "./errors";

// A pull serves by `sequence`, a baseline's segments are read back as a
// group in it, and a redirect starts at the group's first. The insert is
// held to that order from the rows it returns, not trusted to keep it.
test("a request whose rows were not stored in its order fails", () => {
  const updates = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const stored = (...sequences: number[]) =>
    updates.flatMap(({ id }, index) => {
      const sequence = sequences[index];
      return sequence === undefined ? [] : [{ id, sequence }];
    });
  expect(() =>
    assertStoredInRequestOrder(updates, stored(10, 11, 12)),
  ).not.toThrow();
  // Other documents' rows may take sequences in between.
  expect(() =>
    assertStoredInRequestOrder(updates, stored(10, 14, 90)),
  ).not.toThrow();
  // The returned rows need not come back in order themselves.
  expect(() =>
    assertStoredInRequestOrder(updates, stored(10, 11, 12).reverse()),
  ).not.toThrow();
  // A row committed already is skipped by the insert and returns nothing.
  expect(() =>
    assertStoredInRequestOrder(updates, [
      { id: "a", sequence: 10 },
      { id: "c", sequence: 11 },
    ]),
  ).not.toThrow();
  for (const sequences of [
    [11, 10, 12],
    [10, 12, 11],
    [10, 10, 11],
  ]) {
    // A server fault, refused as a coded conflict a client can retry, not
    // an uncoded error that surfaces as a 500.
    let refusal: unknown;
    try {
      assertStoredInRequestOrder(updates, stored(...sequences));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(DocumentMutationError);
    expect(refusal).toMatchObject({
      code: DOCUMENT_SYNC_ERROR_CODES.conflict,
      message: "Document updates were not stored in request order",
      status: 409,
    });
  }
});
