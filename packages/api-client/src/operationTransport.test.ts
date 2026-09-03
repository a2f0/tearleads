import { expect, test } from "bun:test";
import {
  challengeOperation,
  documentAttributionWireHeaderKeys,
  getDocumentAttributionOperation,
  getHealthOperation,
  getOrganizationReadModelOperation,
  type listDocumentAttributionRangesOperation,
  protocolOperations,
} from "@tearleads/validators/operation";
import type { JsonOperationRequestInput } from "./operationTransport";
import {
  createJsonOperationTransport,
  deriveJsonOperationRequest,
  supportsJsonOperationTransport,
} from "./operationTransport";
import type {
  RequestFailure,
  ResponseRequestFn,
  ResponseRequestValidationFailureInput,
} from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

type ChallengeTransportBody = JsonOperationRequestInput<
  typeof challengeOperation
>["body"];
type AcceptsChallengeBody<Value> = Value extends ChallengeTransportBody
  ? true
  : false;
type AttributionRangesTransportQuery = JsonOperationRequestInput<
  typeof listDocumentAttributionRangesOperation
>["query"];
type AcceptsAttributionRangesQuery<Value> =
  Value extends AttributionRangesTransportQuery ? true : false;

function assertType<Condition extends true>(_condition?: Condition): void {}

assertType<AcceptsChallengeBody<{ fingerprint: string }>>();
assertType<AcceptsChallengeBody<number> extends false ? true : false>();
assertType<AcceptsAttributionRangesQuery<{ limit: "10" }>>();

function requestFailure(
  input: ResponseRequestValidationFailureInput,
): RequestFailure {
  return {
    kind: input.kind,
    message: input.message,
    method: input.method,
    ok: false,
    path: input.path,
    report: () => {},
    status: input.status,
    statusText: input.statusText,
  };
}

test("derives JSON body, path, query, and headers from source schemas", () => {
  const fingerprint = "a".repeat(64);
  expect(
    deriveJsonOperationRequest(challengeOperation, {
      body: { fingerprint },
      params: {},
    }),
  ).toEqual({
    body: JSON.stringify({ fingerprint }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    path: "/auth/challenge",
  });

  expect(
    deriveJsonOperationRequest(getOrganizationReadModelOperation, {
      params: { organizationId },
      query: { cursor: "opaque+/=cursor" },
    }),
  ).toEqual({
    method: "GET",
    path: `/organizations/${organizationId}/read-model?cursor=opaque%2B%2F%3Dcursor`,
  });

  expect(
    deriveJsonOperationRequest(getDocumentAttributionOperation, {
      headers: {
        [documentAttributionWireHeaderKeys.ifNoneMatch]: '"revision-4"',
      },
      params: { documentId },
    }),
  ).toEqual({
    headers: {
      [documentAttributionWireHeaderKeys.ifNoneMatch]: '"revision-4"',
    },
    method: "GET",
    path: `/documents/${documentId}/attribution`,
  });
});

test("fails before fetch when request values violate source schemas", () => {
  expect(() =>
    deriveJsonOperationRequest(challengeOperation, {
      body: { fingerprint: "not-a-fingerprint" },
      params: {},
    }),
  ).toThrow("Invalid request body for auth.challenge");
  expect(() =>
    deriveJsonOperationRequest(getOrganizationReadModelOperation, {
      params: { organizationId: "invalid" },
      query: { cursor: undefined },
    }),
  ).toThrow("Invalid path parameters for organizations.readModel.get");
});

test("decodes success bodies with the operation response schema", async () => {
  const calls: unknown[][] = [];
  const request = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      return {
        data: Response.json({ message: "ok" }),
        ok: true as const,
      };
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.request(getHealthOperation, { params: {} }),
  ).resolves.toEqual({ message: "ok" });
  expect(calls).toEqual([["/", "GET", undefined, {}]]);
});

test("returns transformed response schema output", async () => {
  const transformedHealthOperation = {
    ...getHealthOperation,
    responses: {
      200: getHealthOperation.responses[200].transform(({ message }) => ({
        message: message.toUpperCase(),
      })),
    },
  };
  const request = Object.assign(
    async () => ({
      data: Response.json({ message: "ok" }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.request(transformedHealthOperation, { params: {} }),
  ).resolves.toEqual({ message: "OK" });
});

test("caller headers override derived headers case-insensitively", async () => {
  const calls: unknown[][] = [];
  const request = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      return requestFailure({
        kind: "network",
        message: "offline",
        method: "POST",
        path: "/auth/challenge",
        status: null,
        statusText: "",
      });
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await transport.requestResult(
    challengeOperation,
    { body: { fingerprint: "a".repeat(64) }, params: {} },
    { headers: { "content-type": "application/problem+json" } },
  );

  expect(calls[0]?.[3]).toEqual({
    headers: { "content-type": "application/problem+json" },
  });
});

test("reports malformed JSON and shapes through ApiClient policy", async () => {
  const reported: ResponseRequestValidationFailureInput[] = [];
  const responses = [
    new Response("not-json", { status: 200, statusText: "OK" }),
    Response.json({ unexpected: true }),
  ];
  const request = Object.assign(
    async () => ({ data: responses.shift() as Response, ok: true as const }),
    {
      reportFailure(input: ResponseRequestValidationFailureInput) {
        reported.push(input);
        return requestFailure(input);
      },
    },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  expect(
    await transport.requestResult(getHealthOperation, { params: {} }),
  ).toMatchObject({ kind: "json", ok: false, path: "/", status: 200 });
  expect(
    await transport.requestResult(getHealthOperation, { params: {} }),
  ).toMatchObject({ kind: "shape", ok: false, path: "/", status: 200 });
  expect(reported.map((failure) => failure.kind)).toEqual(["json", "shape"]);
});

test("rejects special response operations before fetch", async () => {
  let calls = 0;
  const request = Object.assign(
    async () => {
      calls += 1;
      return { data: Response.json({}), ok: true as const };
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.request(getDocumentAttributionOperation, {
      headers: {},
      params: { documentId },
    }),
  ).rejects.toThrow(
    "Unsupported JSON transport operation: documents.attribution.get",
  );
  expect(calls).toBe(0);
});

test("registry coverage makes special response transports explicit", () => {
  const unsupported = protocolOperations
    .filter((operation) => !supportsJsonOperationTransport(operation))
    .map((operation) => operation.id);

  expect(unsupported).toEqual([
    "blobs.bytes.get",
    "blobs.multipartStages.parts.upload",
    "documents.attribution.get",
    "documents.attribution.ranges.list",
  ]);
});
