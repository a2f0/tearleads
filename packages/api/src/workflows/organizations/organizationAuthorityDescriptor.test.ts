import { expect, test } from "bun:test";
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";

const adminGroupId = "group-a";
const memberGroupId = "group-b";

function head(principalId: string, overrides: Record<string, unknown> = {}) {
  return {
    principalType: "group",
    principalId,
    version: 1,
    keyEpoch: 1,
    stateHash: `state-${principalId}`,
    keyFingerprint: `fingerprint-${principalId}`,
    ...overrides,
  };
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    organizationId: "organization",
    adminGroupId,
    memberGroupId,
    groupHeads: [head(memberGroupId), head(adminGroupId)],
    ...overrides,
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function withoutKey(value: Record<string, unknown>, key: string) {
  const { [key]: _omitted, ...rest } = value;
  return rest;
}

function withHead(overrides: Record<string, unknown>) {
  return descriptor({
    groupHeads: [head(adminGroupId, overrides), head(memberGroupId)],
  });
}

test("a stored authority descriptor parses to sorted group heads", () => {
  expect<unknown>(
    parseOrganizationAuthorityDescriptor(
      encode(
        descriptor({
          groupHeads: [
            head("group-c", { version: 3, keyEpoch: 2 }),
            head(memberGroupId),
            head(adminGroupId, { version: Number.MAX_SAFE_INTEGER }),
          ],
        }),
      ),
    ),
  ).toEqual({
    version: 2,
    organizationId: "organization",
    adminGroupId,
    memberGroupId,
    groupHeads: [
      head(adminGroupId, { version: Number.MAX_SAFE_INTEGER }),
      head(memberGroupId),
      head("group-c", { version: 3, keyEpoch: 2 }),
    ],
  });
  // Only ids are compared, so an empty organization id is still a string.
  expect(
    parseOrganizationAuthorityDescriptor(
      encode(descriptor({ organizationId: "" })),
    )?.organizationId,
  ).toBe("");
});

const invalidDescriptors: readonly (readonly [string, string])[] = [
  ["not base64 JSON", Buffer.from("{", "utf8").toString("base64")],
  ["empty ciphertext", ""],
  ["null", encode(null)],
  ["an array", encode([descriptor()])],
  ["a string", encode("descriptor")],
  ["a number", encode(2)],
  ["an extra key", encode(descriptor({ extra: true }))],
  ["a missing version", encode(withoutKey(descriptor(), "version"))],
  ["a missing groupHeads", encode(withoutKey(descriptor(), "groupHeads"))],
  ["version 1", encode(descriptor({ version: 1 }))],
  ["a string version", encode(descriptor({ version: "2" }))],
  ["a numeric organization id", encode(descriptor({ organizationId: 1 }))],
  ["a null admin group", encode(descriptor({ adminGroupId: null }))],
  ["a numeric member group", encode(descriptor({ memberGroupId: 2 }))],
  [
    "one group as admin and member",
    encode(descriptor({ memberGroupId: adminGroupId })),
  ],
  ["object group heads", encode(descriptor({ groupHeads: {} }))],
  ["null group heads", encode(descriptor({ groupHeads: null }))],
  ["no group heads", encode(descriptor({ groupHeads: [] }))],
  [
    "a null head",
    encode(descriptor({ groupHeads: [head(adminGroupId), null] })),
  ],
  [
    "an array head",
    encode(descriptor({ groupHeads: [head(adminGroupId), []] })),
  ],
  ["a head extra key", encode(withHead({ extra: 1 }))],
  [
    "a head missing stateHash",
    encode(
      descriptor({
        groupHeads: [
          withoutKey(head(adminGroupId), "stateHash"),
          head(memberGroupId),
        ],
      }),
    ),
  ],
  ["a user head", encode(withHead({ principalType: "user" }))],
  ["an empty principal id", encode(withHead({ principalId: "" }))],
  ["a numeric principal id", encode(withHead({ principalId: 1 }))],
  ["version 0", encode(withHead({ version: 0 }))],
  ["a negative version", encode(withHead({ version: -1 }))],
  ["a fractional version", encode(withHead({ version: 1.5 }))],
  ["an unsafe version", encode(withHead({ version: 2 ** 53 }))],
  ["a string version head", encode(withHead({ version: "1" }))],
  ["keyEpoch 0", encode(withHead({ keyEpoch: 0 }))],
  ["an unsafe keyEpoch", encode(withHead({ keyEpoch: 2 ** 60 }))],
  ["a fractional keyEpoch", encode(withHead({ keyEpoch: 1.25 }))],
  ["an empty stateHash", encode(withHead({ stateHash: "" }))],
  ["a null stateHash", encode(withHead({ stateHash: null }))],
  ["an empty keyFingerprint", encode(withHead({ keyFingerprint: "" }))],
  ["a numeric keyFingerprint", encode(withHead({ keyFingerprint: 1 }))],
  [
    "a duplicate head",
    encode(
      descriptor({
        groupHeads: [
          head(adminGroupId),
          head(memberGroupId),
          head(adminGroupId, { version: 2 }),
        ],
      }),
    ),
  ],
  [
    "no admin head",
    encode(descriptor({ groupHeads: [head(memberGroupId), head("group-c")] })),
  ],
  [
    "no member head",
    encode(descriptor({ groupHeads: [head(adminGroupId), head("group-c")] })),
  ],
];

test.each(invalidDescriptors)(
  "a stored descriptor with %s is rejected",
  (_label, ciphertext) => {
    expect(parseOrganizationAuthorityDescriptor(ciphertext)).toBeNull();
  },
);

test("a stored descriptor with an own __proto__ key is rejected", () => {
  const json = JSON.stringify(descriptor()).replace(/^\{/u, '{"__proto__":{},');
  expect(
    parseOrganizationAuthorityDescriptor(
      Buffer.from(json, "utf8").toString("base64"),
    ),
  ).toBeNull();
});
