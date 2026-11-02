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

function encodedPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

test("organization read-model cursor payloads keep their exact shape", () => {
  const organizationId = crypto.randomUUID();
  const valid = { version: 6, organizationId, cursor: "4" };
  expect(
    decodeOrganizationReadModelCursor(encodedPayload(valid), organizationId),
  ).toBe(4n);
  expect(
    decodeOrganizationReadModelCursor(
      encodedPayload({ cursor: "0", organizationId, version: 6 }),
      organizationId,
    ),
  ).toBe(0n);
  const { cursor: _cursor, ...withoutCursor } = valid;
  const { version: _version, ...withoutVersion } = valid;
  for (const payload of [
    null,
    [],
    [6, organizationId, "4"],
    "4",
    4,
    {},
    withoutCursor,
    withoutVersion,
    { ...valid, extra: true },
    { ...withoutCursor, cursor: "4", extra: undefined, more: 1 },
    { ...valid, version: "6" },
    { ...valid, version: 6.5 },
    { ...valid, organizationId: 1 },
    { ...valid, organizationId: null },
    { ...valid, cursor: 4 },
    { ...valid, cursor: null },
    { ...valid, cursor: "" },
    { ...valid, cursor: "-1" },
    { ...valid, cursor: "1.5" },
    { ...valid, cursor: " 4" },
    { ...valid, cursor: "4\n" },
    { ...valid, cursor: "1e3" },
    { ...valid, cursor: "9223372036854775808" },
  ]) {
    expect(() =>
      decodeOrganizationReadModelCursor(
        encodedPayload(payload),
        organizationId,
      ),
    ).toThrow(OrganizationReadModelCursorError);
  }
  const ownProto = JSON.stringify(valid).replace(/^\{/u, '{"__proto__":{},');
  expect(() =>
    decodeOrganizationReadModelCursor(
      Buffer.from(ownProto, "utf8").toString("base64url"),
      organizationId,
    ),
  ).toThrow(OrganizationReadModelCursorError);
});
