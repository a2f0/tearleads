import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHmac, hkdfSync } from "node:crypto";
import {
  issueProjectionPolicyHistoryGrant,
  type ProjectionPolicyHistoryGrant,
  readProjectionPolicyHistoryGrant,
} from "./projectionPolicyHistoryGrant";
import { PrincipalPolicyError } from "./shared";

function grant(): ProjectionPolicyHistoryGrant {
  return {
    organizationId: crypto.randomUUID(),
    objectKind: "container",
    objectId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    head: {
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 65,
      keyEpoch: 1,
      stateHash: "a".repeat(64),
      keyFingerprint: "b".repeat(64),
    },
  };
}

test("projection history grants bind the user, authorized object, and exact policy head", () => {
  const input = grant();
  const token = issueProjectionPolicyHistoryGrant(input);
  expect(readProjectionPolicyHistoryGrant(token, input.userId)).toEqual(input);
  expect(() =>
    readProjectionPolicyHistoryGrant(token, crypto.randomUUID()),
  ).toThrow("grant is invalid");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Missing issued token fields");
  for (const substitution of [
    { objectId: crypto.randomUUID() },
    { objectKind: "document" },
    { organizationId: crypto.randomUUID() },
    { head: { ...input.head, version: 66 } },
    { head: { ...input.head, stateHash: "c".repeat(64) } },
  ]) {
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        ...substitution,
      }),
    ).toString("base64url");
    expect(() =>
      readProjectionPolicyHistoryGrant(`${changed}.${signature}`, input.userId),
    ).toThrow("grant is invalid");
  }
  for (const malformed of ["", "a.b", `${token}.extra`, "a".repeat(4097)])
    expect(() =>
      readProjectionPolicyHistoryGrant(malformed, input.userId),
    ).toThrow("grant is invalid");
});

test("the public development cursor fallback cannot forge a projection read grant", () => {
  const input = grant();
  const [payload] = issueProjectionPolicyHistoryGrant(input).split(".");
  if (!payload) throw new Error("Missing payload");
  const domain = "tearleads.projection-policy-history.read-grant.v1";
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      "tearleads-development-document-sync-cursor-key",
      Buffer.alloc(0),
      domain,
      32,
    ),
  );
  const signature = createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(payload)
    .digest("base64url");
  expect(() =>
    readProjectionPolicyHistoryGrant(`${payload}.${signature}`, input.userId),
  ).toThrow("grant is invalid");
});

const CURSOR_KEY_ENV = "DOCUMENT_SYNC_CURSOR_HMAC_KEY";
const CONFIGURED_KEY = "tearleads-test-projection-grant-key-0123456789";

function signedToken(payloadText: string): string {
  const domain = "tearleads.projection-policy-history.read-grant.v1";
  const payload = Buffer.from(payloadText, "utf8").toString("base64url");
  const key = Buffer.from(
    hkdfSync("sha256", CONFIGURED_KEY, Buffer.alloc(0), domain, 32),
  );
  const signature = createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function expectRejected(token: string, userId: string): void {
  let caught: unknown;
  try {
    readProjectionPolicyHistoryGrant(token, userId);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PrincipalPolicyError);
  expect(caught).toMatchObject({
    message: "Projection policy history grant is invalid",
    status: 403,
  });
}

function withConfiguredKey(run: () => void): void {
  const previous = process.env[CURSOR_KEY_ENV];
  process.env[CURSOR_KEY_ENV] = CONFIGURED_KEY;
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env[CURSOR_KEY_ENV];
    } else {
      process.env[CURSOR_KEY_ENV] = previous;
    }
  }
}

test("validly signed but malformed grant payloads are rejected", () => {
  withConfiguredKey(() => {
    const input = grant();
    const valid = {
      version: 1,
      organizationId: input.organizationId,
      objectKind: input.objectKind,
      objectId: input.objectId,
      userId: input.userId,
      head: input.head,
    };
    const { version: _v, ...withoutVersion } = valid;
    const { organizationId: _o, ...withoutOrganization } = valid;
    const { objectKind: _k, ...withoutKind } = valid;
    const { objectId: _i, ...withoutObject } = valid;
    const { userId: _u, ...withoutUser } = valid;
    const { head: _h, ...withoutHead } = valid;
    const malformedPayloads: readonly unknown[] = [
      null,
      "grant",
      1,
      [],
      [valid],
      withoutVersion,
      withoutOrganization,
      withoutKind,
      withoutObject,
      withoutUser,
      withoutHead,
      ...[2, "1", null, true].map((version) => ({ ...valid, version })),
      ...["", 1, null].map((organizationId) => ({ ...valid, organizationId })),
      ...["folder", "", null].map((objectKind) => ({ ...valid, objectKind })),
      ...["", 1, null].map((objectId) => ({ ...valid, objectId })),
      ...[crypto.randomUUID(), "", null].map((userId) => ({
        ...valid,
        userId,
      })),
      ...[
        null,
        [],
        "head",
        { ...input.head, version: 0 },
        { ...input.head, version: 1.5 },
        { ...input.head, keyEpoch: 2 ** 53 },
        { ...input.head, principalType: "user" },
        { ...input.head, stateHash: 1 },
      ].map((head) => ({ ...valid, head })),
    ];
    for (const payload of malformedPayloads) {
      expectRejected(signedToken(JSON.stringify(payload)), input.userId);
    }
    for (const text of ["", "{", "not json"]) {
      expectRejected(signedToken(text), input.userId);
    }
    expect(
      readProjectionPolicyHistoryGrant(
        signedToken(JSON.stringify(valid)),
        input.userId,
      ),
    ).toEqual(input);
    const extendedHead = { ...input.head, extension: "kept" };
    expect(
      readProjectionPolicyHistoryGrant(
        signedToken(
          JSON.stringify({ ...valid, extra: true, head: extendedHead }),
        ),
        input.userId,
      ),
    ).toEqual({ ...input, head: extendedHead });
  });
});
