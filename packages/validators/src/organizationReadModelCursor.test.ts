import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { organizationReadModelCursorPosition } from "./organizationReadModelCursor";

const ORG = "2f523e6e-baa4-4842-9764-4fbd52e730c4";

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

test("decodes the monotone position of a cursor for its organization", () => {
  expect(
    organizationReadModelCursorPosition(
      encode({ version: 6, organizationId: ORG, cursor: "6" }),
      ORG,
    ),
  ).toBe(6n);
  expect(
    organizationReadModelCursorPosition(
      encode({ version: 6, organizationId: ORG, cursor: "10" }),
      ORG,
    ),
  ).toBe(10n);
});

test("rejects cursors outside the server's cursor contract", () => {
  const rejected = [
    encode({ version: 6, organizationId: "other", cursor: "6" }),
    encode({ version: 5, organizationId: ORG, cursor: "6" }),
    encode({ version: 6, organizationId: ORG, cursor: "06" }),
    encode({ version: 6, organizationId: ORG, cursor: "-1" }),
    encode({ version: 6, organizationId: ORG, cursor: "6", extra: true }),
    encode({ version: 6, organizationId: ORG, cursor: "9223372036854775808" }),
    encode([6, ORG, "6"]),
    "cursor-1",
    "not+base64url",
    "",
  ];
  for (const value of rejected) {
    expect(organizationReadModelCursorPosition(value, ORG)).toBeNull();
  }
});
