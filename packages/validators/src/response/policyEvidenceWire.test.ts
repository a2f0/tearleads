import { expect, test } from "bun:test";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
  jsonRoundTrip,
} from "../operation/openApiTestFixtures";
import { ContainerWriterProjectionWireResponseSchema } from "./container";
import { DocumentWriterProjectionWireResponseSchema } from "./documentMutation";
import type { PrincipalStatePayloadResponse } from "./principalSnapshot";
import type { ProjectionPolicyEvidenceResponse } from "./projectionPolicyEvidence";
import {
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
  encodeContainerWriterProjection,
  encodeDocumentWriterProjection,
} from "./writerProjectionWire";

const CURRENT = "c".repeat(64);
const OLDER = "d".repeat(64);
const UNKNOWN = "e".repeat(64);

function payload(stateHash: string): PrincipalStatePayloadResponse {
  return {
    cipherSuite: "aes-256-gcm",
    ciphertext: `directory-${stateHash.slice(0, 4)}`,
    ciphertextHash: `hash-${stateHash.slice(0, 4)}`,
    createdAt: "2026-11-17T00:00:00.000Z",
    principalId: "organization-1",
    principalType: "organization",
    stateHash,
  };
}

function evidence(): ProjectionPolicyEvidenceResponse {
  const entry = (stateHash: string, version: number) => ({
    reference: {
      keyEpoch: 1,
      keyFingerprint: "fingerprint",
      principalId: "organization-1",
      principalType: "organization" as const,
      stateHash,
      version,
    },
    payload: payload(stateHash),
  });
  return {
    organization: null,
    organizationPayloads: [entry(CURRENT, 2), entry(OLDER, 1)],
    groups: [],
  };
}

test("a cited directory payload travels as null and refills from the cited bytes", () => {
  const projection = {
    ...createContainerWriterProjectionResponse(),
    policyEvidence: evidence(),
  };
  const wire = ContainerWriterProjectionWireResponseSchema.parse(
    jsonRoundTrip(
      encodeContainerWriterProjection(
        projection,
        new Set(),
        undefined,
        new Set([CURRENT, UNKNOWN]),
      ),
    ),
  );
  // Only the cited state is omitted; an unknown hash changes nothing.
  expect(
    wire.policyEvidence.organizationPayloads.map(({ payload }) => payload),
  ).toEqual([null, payload(OLDER)]);
  const held = new Map([[CURRENT, payload(CURRENT)]]);
  const decoded = decodeContainerWriterProjection(
    wire,
    new Map(),
    new Map(),
    held,
  );
  expect(decoded).toEqual(projection);
  // Each refill is its own copy of the cited bytes.
  expect(decoded?.policyEvidence.organizationPayloads[0]?.payload).not.toBe(
    held.get(CURRENT),
  );
  // Without the cited bytes, or with bytes held for another state, the
  // response is unusable and the caller refetches in full.
  expect(decodeContainerWriterProjection(wire)).toBeNull();
  expect(
    decodeContainerWriterProjection(
      wire,
      new Map(),
      new Map(),
      new Map([[CURRENT, payload(OLDER)]]),
    ),
  ).toBeNull();
  // Nothing cited: every payload travels.
  expect(
    ContainerWriterProjectionWireResponseSchema.parse(
      jsonRoundTrip(encodeContainerWriterProjection(projection)),
    ).policyEvidence,
  ).toEqual(projection.policyEvidence);
});

test("document projections omit and refill cited directory payloads", () => {
  const projection = {
    ...createDocumentWriterProjectionResponse(),
    policyEvidence: evidence(),
  };
  const wire = DocumentWriterProjectionWireResponseSchema.parse(
    jsonRoundTrip(
      encodeDocumentWriterProjection(
        projection,
        new Set(),
        undefined,
        new Set([OLDER]),
      ),
    ),
  );
  expect(
    wire.policyEvidence.organizationPayloads.map(({ payload }) => payload),
  ).toEqual([payload(CURRENT), null]);
  expect(
    decodeDocumentWriterProjection(
      wire,
      new Map(),
      new Map(),
      new Map([[OLDER, payload(OLDER)]]),
    ),
  ).toEqual(projection);
  expect(decodeDocumentWriterProjection(wire)).toBeNull();
});
