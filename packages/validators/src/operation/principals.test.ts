import { expect, test } from "bun:test";
import {
  CommitOrganizationGroupPolicyRequestSchema,
  OrganizationPrincipalPolicyRequestSchema,
} from "../request";
import {
  CommitOrganizationGroupPolicyConflictResponseSchema,
  CommitOrganizationGroupPolicyResponseSchema,
  CurrentPrincipalMemberEnvelopesResponseSchema,
  ErrorResponseSchema,
  PaymentRequiredErrorResponseSchema,
  PrincipalPolicyErrorResponseSchema,
  PrincipalPolicyMutationResponseSchema,
  PrincipalPolicyReadResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { PrincipalHistoryPreparationFailureResponseSchema } from "../response/principalHistoryPreparation";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  commitOrganizationGroupPolicyOperation,
  getPrincipalMemberEnvelopesOperation,
  getPrincipalPolicyOperation,
  isGetPrincipalMemberEnvelopesOperationResponse,
  PrincipalPolicyPathParamsSchema,
  putPrincipalPolicyOperation,
} from "./principals";

const principalId = "11111111-1111-4111-8111-111111111111";

test("principal policy operations own their HTTP contracts", () => {
  expect(getPrincipalPolicyOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 409, 500, 503],
    id: "principals.policy.get",
    method: "GET",
    params: PrincipalPolicyPathParamsSchema,
    path: "/principals/{principalType}/{principalId}/policy",
    responses: { 200: PrincipalPolicyReadResponseSchema },
  });
  expect(getPrincipalPolicyOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
  expect(putPrincipalPolicyOperation).toMatchObject({
    auth: "session",
    body: OrganizationPrincipalPolicyRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "principals.policy.update",
    method: "PUT",
    params: PrincipalPolicyPathParamsSchema,
    path: "/principals/{principalType}/{principalId}/policy",
    responses: { 200: PrincipalPolicyMutationResponseSchema },
  });
  expect(putPrincipalPolicyOperation.failureResponses).toEqual({
    400: PrincipalPolicyErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: PrincipalPolicyErrorResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    409: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalHistoryPreparationFailureResponseSchema,
  });
});

test("compound organization group policy commits declare billing failures", () => {
  expect(commitOrganizationGroupPolicyOperation).toMatchObject({
    auth: "session",
    body: CommitOrganizationGroupPolicyRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "organizations.groups.policy.commit",
    method: "PUT",
    responses: { 200: CommitOrganizationGroupPolicyResponseSchema },
  });
  expect(commitOrganizationGroupPolicyOperation.failureResponses).toEqual({
    400: PrincipalPolicyErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: PrincipalPolicyErrorResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    409: CommitOrganizationGroupPolicyConflictResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalHistoryPreparationFailureResponseSchema,
  });
});

test("principal policy paths derive from the shared path schema", () => {
  expect(operationRoutePath(getPrincipalPolicyOperation)).toBe(
    "/principals/:principalType/:principalId/policy",
  );
  expect(
    operationRequestPath(getPrincipalPolicyOperation, {
      principalId,
      principalType: "group",
    }),
  ).toBe(`/principals/group/${principalId}/policy`);
  expect(() =>
    operationRequestPath(getPrincipalPolicyOperation, {
      principalId: "invalid",
      principalType: "group",
    }),
  ).toThrow("Invalid path parameters for principals.policy.get");
  expect(() =>
    operationRequestPath(getPrincipalPolicyOperation, {
      principalId,
      principalType: "team" as never,
    }),
  ).toThrow("Invalid path parameters for principals.policy.get");
});

test("principal member envelope reads name one exact state", () => {
  expect(getPrincipalMemberEnvelopesOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    id: "principals.policy.memberEnvelopes.get",
    method: "GET",
    params: PrincipalPolicyPathParamsSchema,
    path: "/principals/{principalType}/{principalId}/policy/member-envelopes",
    responses: { 200: CurrentPrincipalMemberEnvelopesResponseSchema },
  });
  expect(getPrincipalMemberEnvelopesOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
  const query = getPrincipalMemberEnvelopesOperation.query;
  expect(query.safeParse({ stateHash: "a".repeat(64) }).success).toBe(true);
  for (const invalid of [
    {},
    { stateHash: "A".repeat(64) },
    { stateHash: "a".repeat(63) },
    { stateHash: "a".repeat(64), afterVersion: "1" },
  ])
    expect(query.safeParse(invalid).success).toBe(false);
  expect(
    operationRequestPath(getPrincipalMemberEnvelopesOperation, {
      principalId,
      principalType: "group",
    }),
  ).toBe(`/principals/group/${principalId}/policy/member-envelopes`);
  const envelopes = {
    envelopes: [],
    epoch: 1,
    principalId,
    principalType: "group",
    stateHash: "a".repeat(64),
  };
  expect(isGetPrincipalMemberEnvelopesOperationResponse(envelopes)).toBe(true);
  expect(
    isGetPrincipalMemberEnvelopesOperationResponse({ ...envelopes, epoch: 0 }),
  ).toBe(false);
});
