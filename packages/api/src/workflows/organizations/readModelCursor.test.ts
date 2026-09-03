import { expect, test } from "bun:test";
import { OrganizationReadModelCursorError } from "./errors";
import {
  decodeOrganizationReadModelCursor,
  encodeOrganizationReadModelCursor,
} from "./readModelCursor";

test("organization read-model cursors round-trip bigint values", () => {
  const organizationId = crypto.randomUUID();
  const cursor = 9_007_199_254_740_993n;

  expect(
    decodeOrganizationReadModelCursor(
      encodeOrganizationReadModelCursor(organizationId, cursor),
      organizationId,
    ),
  ).toBe(cursor);
});

test("organization read-model cursors are scoped and strictly validated", () => {
  const organizationId = crypto.randomUUID();
  const encoded = encodeOrganizationReadModelCursor(organizationId, 4n);

  for (const invalid of [
    "",
    "not+base64url",
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from(
      JSON.stringify({
        version: 1,
        organizationId,
        cursor: "4",
      }),
      "utf8",
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        version: 6,
        organizationId,
        cursor: "01",
      }),
      "utf8",
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        version: 2,
        organizationId,
        cursor: "4",
      }),
      "utf8",
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        version: 3,
        organizationId,
        cursor: "4",
      }),
      "utf8",
    ).toString("base64url"),
    // v5 is the version this reset replaced, so it is the one a real client
    // could still be holding — rejecting it is what forces a fresh snapshot
    // instead of applying v6 deltas onto v5-shaped rows.
    Buffer.from(
      JSON.stringify({
        version: 5,
        organizationId,
        cursor: "4",
      }),
      "utf8",
    ).toString("base64url"),
  ]) {
    expect(() =>
      decodeOrganizationReadModelCursor(invalid, organizationId),
    ).toThrow(OrganizationReadModelCursorError);
  }
  expect(() =>
    decodeOrganizationReadModelCursor(encoded, crypto.randomUUID()),
  ).toThrow("Invalid organization read-model cursor");
});
