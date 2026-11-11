import { expect, test } from "bun:test";
import { publishedOpenApiDocument } from "./operation/openApi";
import {
  OrganizationPrincipalPolicyRequestSchema,
  PutPrincipalPolicyRequestSchema,
} from "./request/principal";
import { PrincipalPolicyBundleResponseSchema } from "./response/principal";
import { PrincipalPolicyPageResponseSchema } from "./response/principalPolicyPage";
import { PrincipalPolicySnapshotPageResponseSchema } from "./response/principalPolicySnapshotPage";
import { PrincipalPolicySnapshotResponseSchema } from "./response/principalSnapshot";

const userId = "550e8400-e29b-41d4-a716-446655440001";
const member = { role: "admin", userId };
const identityBundleFingerprint = "0123456789abcdef".repeat(4);
const projection = [{ ...member, identityBundleFingerprint }];
const policy = {
  encryptedPayload: {
    cipherSuite: "aes-256-gcm",
    ciphertext: "ciphertext",
    ciphertextHash: "ciphertext-hash",
  },
  grants: [],
  memberEnvelopes: [],
  projection,
  state: {
    encapsulationPublicKey: "public-key",
    externalAuthority: null,
    grantCount: 0,
    grantRoot: "grant-root",
    keyEpoch: 1,
    keyFingerprint: "key-fingerprint",
    memberCount: 1,
    memberEnvelopesRoot: "envelopes-root",
    membershipMode: "projection",
    membershipRoot: "membership-root",
    payloadCiphertextHash: "ciphertext-hash",
    prevStateHash: null,
    principalId: "550e8400-e29b-41d4-a716-446655440002",
    principalType: "group",
    projectionRoot: "projection-root",
    signature: "signature",
    signedAt: "2026-11-11T00:00:00.000Z",
    signerUserId: userId,
    signerUserKeyFingerprint: "signing-fingerprint",
    version: 1,
  },
};
const invalidFingerprints = [
  ["missing", {}],
  ["undefined", { identityBundleFingerprint: undefined }],
  ["null", { identityBundleFingerprint: null }],
  ["non-string", { identityBundleFingerprint: 123 }],
  ["empty", { identityBundleFingerprint: "" }],
  ["short", { identityBundleFingerprint: "a".repeat(63) }],
  ["long", { identityBundleFingerprint: "a".repeat(65) }],
  ["uppercase", { identityBundleFingerprint: "A".repeat(64) }],
  ["non-hex", { identityBundleFingerprint: "g".repeat(64) }],
] as const;

for (const [principalType, schema] of [
  ["group", PutPrincipalPolicyRequestSchema],
  ["organization", OrganizationPrincipalPolicyRequestSchema],
] as const) {
  const request = { ...policy, state: { ...policy.state, principalType } };
  test(`${principalType} policy preserves the exact member identity bundle fingerprint`, () => {
    expect(Object.is(schema.parse(request), request)).toBe(true);
  });
  test.each(invalidFingerprints)(
    `${principalType} policy rejects %s member identity bundle fingerprints`,
    (_label, fields) => {
      const result = schema.safeParse({
        ...request,
        projection: [{ ...member, ...fields }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path)).toEqual([
          ["projection", 0, "identityBundleFingerprint"],
        ]);
      }
    },
  );
}

const state = {
  ...policy.state,
  createdAt: policy.state.signedAt,
  stateHash: "state-hash",
};
const previousState = { grants: [], projection, state };
const response = {
  currentGrants: [],
  currentMemberEnvelopes: {
    envelopes: [],
    epoch: 1,
    principalId: state.principalId,
    principalType: state.principalType,
    stateHash: state.stateHash,
  },
  currentPayload: {
    ...policy.encryptedPayload,
    createdAt: state.createdAt,
    principalId: state.principalId,
    principalType: state.principalType,
    stateHash: state.stateHash,
  },
  currentProjection: projection,
  currentState: state,
  historyPage: { afterVersion: 0, nextAfterVersion: null },
  previousStates: [previousState],
};

for (const [name, schema] of [
  ["bundle", PrincipalPolicyBundleResponseSchema],
  ["page", PrincipalPolicyPageResponseSchema],
  ["snapshot", PrincipalPolicySnapshotResponseSchema],
  ["snapshot page", PrincipalPolicySnapshotPageResponseSchema],
] as const) {
  test(`${name} response preserves member identity bundle fingerprints`, () => {
    expect(Object.is(schema.parse(response), response)).toBe(true);
  });
  for (const location of ["current", "previous"] as const) {
    test.each(invalidFingerprints)(
      `${name} response rejects %s ${location} member identity bundle fingerprints`,
      (_label, fields) => {
        const invalidProjection = [{ ...member, ...fields }];
        const result = schema.safeParse({
          ...response,
          ...(location === "current"
            ? { currentProjection: invalidProjection }
            : {
                previousStates: [
                  { ...previousState, projection: invalidProjection },
                ],
              }),
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.map((issue) => issue.path)).toEqual([
            location === "current"
              ? ["currentProjection", 0, "identityBundleFingerprint"]
              : [
                  "previousStates",
                  0,
                  "projection",
                  0,
                  "identityBundleFingerprint",
                ],
          ]);
        }
      },
    );
  }
}

const fingerprintSchema = {
  type: "string",
  minLength: 64,
  maxLength: 64,
  pattern: "^[0-9a-f]+$",
};

test("published policy responses require canonical member identity bundle fingerprints", () => {
  const name = "PrincipalProjectionMemberResponse";
  expect(publishedOpenApiDocument.components.schemas[name]).toMatchObject({
    properties: { identityBundleFingerprint: fingerprintSchema },
    required: ["identityBundleFingerprint", "role", "userId"],
  });
});

test("published policy requests require canonical member identity bundle fingerprints", () => {
  for (const name of [
    "PutPrincipalPolicyRequest",
    "OrganizationPrincipalPolicyRequest",
  ]) {
    expect(publishedOpenApiDocument.components.schemas[name]).toMatchObject({
      properties: {
        projection: {
          items: {
            properties: { identityBundleFingerprint: fingerprintSchema },
            required: ["identityBundleFingerprint", "role", "userId"],
          },
        },
      },
    });
  }
});
