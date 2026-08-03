import { expect, test } from "bun:test";
import { OrganizationManagerError } from "./errors";
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
        version: 5,
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
  ]) {
    expect(() =>
      decodeOrganizationReadModelCursor(invalid, organizationId),
    ).toThrow(OrganizationManagerError);
  }
  expect(() =>
    decodeOrganizationReadModelCursor(encoded, crypto.randomUUID()),
  ).toThrow("Invalid organization read-model cursor");
});
