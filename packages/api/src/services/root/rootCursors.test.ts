import { expect, test } from "bun:test";
import type { ApiServiceRuntime } from "../runtime";
import { listAuditEvents, RootAuditError } from "./audit";
import { listIdentities, RootIdentityError } from "./identities";
import { pageInput, RootOrganizationError } from "./organizations";

const reachedDatabase = new Error("reached the database");
// A valid cursor gets past decoding and reaches the first query.
const runtime: ApiServiceRuntime = new Proxy(Object.create(null), {
  get() {
    throw reachedDatabase;
  },
});

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

const uuid = "8f14e45f-ceea-467f-a0e6-1f0b3e3c4d5a";

function invalidPayloads(key: string): readonly unknown[] {
  return [
    null,
    [],
    [uuid],
    uuid,
    1,
    {},
    { [key]: null },
    { [key]: 1 },
    { [key]: "" },
    { [key]: "not-a-uuid" },
    { [key]: uuid.toUpperCase() },
    // Version 1 UUIDs are not identifiers the API issues.
    { [key]: "8f14e45f-ceea-167f-a0e6-1f0b3e3c4d5a" },
    { [key]: [uuid] },
    { [key]: { id: uuid } },
  ];
}

test.each([
  [
    "identity",
    "afterUserId",
    (cursor: string) => listIdentities(runtime, { cursor }),
    RootIdentityError,
  ],
  [
    "audit",
    "afterEventId",
    (cursor: string) => listAuditEvents(runtime, { cursor }),
    RootAuditError,
  ],
] as const)(
  "root %s cursors keep their payload rules",
  async (_label, key, list, ErrorClass) => {
    for (const payload of invalidPayloads(key)) {
      const rejected = list(encode(payload));
      await expect(rejected).rejects.toThrow(ErrorClass);
      await expect(rejected).rejects.toThrow("Invalid cursor");
    }
    for (const payload of [
      { [key]: uuid },
      // Unknown keys never had meaning, and they still do not reject a cursor.
      { [key]: uuid, extra: true, scope: null },
    ]) {
      await expect(list(encode(payload))).rejects.toBe(reachedDatabase);
    }
  },
);

test("root organization cursors keep their scope and payload rules", () => {
  const scope = "organizations:hash";
  for (const payload of [
    ...invalidPayloads("afterId").map((value) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { ...value, scope }
        : value,
    ),
    { afterId: uuid },
    { afterId: uuid, scope: "organizations:other" },
    { afterId: uuid, scope: null },
    { afterId: uuid, scope: 1 },
  ]) {
    expect(() => pageInput({ cursor: encode(payload) }, scope)).toThrow(
      RootOrganizationError,
    );
    expect(() => pageInput({ cursor: encode(payload) }, scope)).toThrow(
      "Invalid cursor",
    );
  }
  expect(
    pageInput({ cursor: encode({ afterId: uuid, scope }) }, scope),
  ).toEqual({ afterId: uuid, limit: 50 });
  expect(
    pageInput(
      { cursor: encode({ scope, afterId: uuid, extra: [1] }), limit: 10 },
      scope,
    ),
  ).toEqual({ afterId: uuid, limit: 10 });
  expect(pageInput({}, scope)).toEqual({ afterId: undefined, limit: 50 });
});
