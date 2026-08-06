import { expect, test } from "bun:test";
import type {
  ChallengeRequest,
  DocumentSyncRequest,
  VerifyRequest,
} from "../request";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
  DestroySessionResponse,
  DocumentNotFoundErrorResponse,
  DocumentSyncErrorResponse,
  DocumentSyncResponse,
  ErrorResponse,
  ListSessionsResponse,
  UserIdentityResponse,
  VerifyFailureResponse,
  VerifySuccessResponse,
  WebSocketTicketResponse,
} from "../response";
import { documentSyncOperation } from "./documentSync";
import type {
  $defs,
  components,
  operations,
  paths,
  webhooks,
} from "./generatedOpenApi";
import type {
  createSyncRequest,
  createSyncResponse,
} from "./openApiTestFixtures";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <
        Value,
      >() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;
type IsNotEqual<Left, Right> =
  IsEqual<Left, Right> extends false ? true : false;
type WithoutIndexSignatures<Value> = {
  [Key in keyof Value as string extends Key
    ? never
    : number extends Key
      ? never
      : symbol extends Key
        ? never
        : Key]: Value[Key];
};
type NormalizeWireType<Value> = Value extends readonly (infer Item)[]
  ? NormalizeWireType<Item>[]
  : Value extends object
    ? {
        [Key in keyof WithoutIndexSignatures<Value>]: NormalizeWireType<
          Exclude<WithoutIndexSignatures<Value>[Key], undefined>
        >;
      }
    : Value;
type LooseWireObject<Shape> = Shape & Record<string, unknown>;
type GeneratedOperation = operations["documents.sync"];
type GeneratedPathOperation = paths["/documents/{documentId}/sync"]["post"];
type GeneratedPathParams = GeneratedOperation["parameters"]["path"];
type GeneratedRequest =
  GeneratedOperation["requestBody"]["content"]["application/json"];
type GeneratedResponses = GeneratedOperation["responses"];
type GeneratedResponse = GeneratedResponses[200]["content"]["application/json"];
type GeneratedErrorResponse =
  GeneratedResponses[409]["content"]["application/json"];
type GeneratedNotFoundResponse =
  GeneratedResponses[404]["content"]["application/json"];
type FixtureRequest = ReturnType<typeof createSyncRequest>;
type FixtureResponse = ReturnType<typeof createSyncResponse>;
type GeneratedFailureStatus = Exclude<keyof GeneratedResponses, 200>;
type DeclaredFailureStatus =
  (typeof documentSyncOperation.failureStatuses)[number];
type GeneratedStatusOnlyFailure = Exclude<GeneratedFailureStatus, 404 | 409>;
type GeneratedStatusOnlyFailuresHaveNoContent =
  GeneratedResponses[GeneratedStatusOnlyFailure] extends { content?: never }
    ? true
    : false;
type GeneratedChallengeOperation = operations["auth.challenge"];
type GeneratedChallengeRequest =
  GeneratedChallengeOperation["requestBody"]["content"]["application/json"];
type GeneratedChallengeResponse =
  GeneratedChallengeOperation["responses"][200]["content"]["application/json"];
type GeneratedChallengeErrorResponse =
  GeneratedChallengeOperation["responses"][400]["content"]["application/json"];
type GeneratedVerifyOperation = operations["auth.verify"];
type GeneratedVerifyRequest =
  GeneratedVerifyOperation["requestBody"]["content"]["application/json"];
type GeneratedVerifySuccessResponse =
  GeneratedVerifyOperation["responses"][200]["content"]["application/json"];
type GeneratedVerifyFailureResponse =
  GeneratedVerifyOperation["responses"][401]["content"]["application/json"];
type GeneratedLogoutOperation = operations["auth.logout"];
type GeneratedLogoutResponse =
  GeneratedLogoutOperation["responses"][200]["content"]["application/json"];
type GeneratedListSessionsOperation = operations["auth.sessions.list"];
type GeneratedListSessionsResponse =
  GeneratedListSessionsOperation["responses"][200]["content"]["application/json"];
type GeneratedDestroySessionOperation = operations["auth.sessions.destroy"];
type GeneratedDestroySessionPathParams =
  GeneratedDestroySessionOperation["parameters"]["path"];
type GeneratedDestroySessionResponse =
  GeneratedDestroySessionOperation["responses"][200]["content"]["application/json"];
type GeneratedDestroySessionErrorResponse =
  GeneratedDestroySessionOperation["responses"][400]["content"]["application/json"];
type GeneratedUserIdentityOperation = operations["auth.userIdentity"];
type GeneratedUserIdentityPathParams =
  GeneratedUserIdentityOperation["parameters"]["path"];
type GeneratedUserIdentityResponse =
  GeneratedUserIdentityOperation["responses"][200]["content"]["application/json"];
type GeneratedWebSocketTicketOperation = operations["auth.webSocketTicket"];
type GeneratedWebSocketTicketResponse =
  GeneratedWebSocketTicketOperation["responses"][200]["content"]["application/json"];
type EmptyGeneratedComponents = {
  schemas: never;
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match the document sync structural contract", () => {
  assertType<IsEqual<webhooks, Record<string, never>>>();
  assertType<IsEqual<$defs, Record<string, never>>>();
  assertType<IsEqual<components, EmptyGeneratedComponents>>();
  assertType<
    IsNotEqual<
      NormalizeWireType<
        LooseWireObject<{
          nested: LooseWireObject<{ sourceVersionVector?: string }>;
        }>
      >,
      NormalizeWireType<LooseWireObject<{ nested: LooseWireObject<object> }>>
    >
  >();
  assertType<
    IsNotEqual<
      NormalizeWireType<LooseWireObject<{ value: string | null }>>,
      NormalizeWireType<LooseWireObject<{ value: null }>>
    >
  >();
  assertType<IsAssignable<GeneratedPathOperation, GeneratedOperation>>();
  assertType<IsAssignable<GeneratedPathParams, { documentId: string }>>();
  assertType<IsAssignable<{ documentId: string }, GeneratedPathParams>>();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedRequest>,
      NormalizeWireType<DocumentSyncRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedResponse>,
      NormalizeWireType<DocumentSyncResponse>
    >
  >();
  assertType<IsAssignable<GeneratedRequest, DocumentSyncRequest>>();
  assertType<IsAssignable<GeneratedResponse, DocumentSyncResponse>>();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedErrorResponse>,
      NormalizeWireType<DocumentSyncErrorResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedNotFoundResponse>,
      NormalizeWireType<DocumentNotFoundErrorResponse>
    >
  >();
  assertType<IsAssignable<FixtureRequest, GeneratedRequest>>();
  assertType<IsAssignable<FixtureResponse, GeneratedResponse>>();
  assertType<IsAssignable<GeneratedFailureStatus, DeclaredFailureStatus>>();
  assertType<IsAssignable<DeclaredFailureStatus, GeneratedFailureStatus>>();
  assertType<GeneratedStatusOnlyFailuresHaveNoContent>();

  expect(documentSyncOperation.method).toBe("POST");
  expect(documentSyncOperation.path).toBe("/documents/{documentId}/sync");
});

test("generated OpenAPI types match the auth structural contracts", () => {
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedChallengeRequest>,
      NormalizeWireType<ChallengeRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedChallengeResponse>,
      NormalizeWireType<ChallengeResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedChallengeErrorResponse>,
      NormalizeWireType<ChallengeErrorResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedVerifyRequest>,
      NormalizeWireType<VerifyRequest>
    >
  >();
  assertType<
    IsEqual<
      Pick<
        NormalizeWireType<GeneratedVerifySuccessResponse>,
        "authenticated" | "organizationId" | "token" | "userId"
      >,
      Pick<
        NormalizeWireType<VerifySuccessResponse>,
        "authenticated" | "organizationId" | "token" | "userId"
      >
    >
  >();
  assertType<
    IsEqual<
      Pick<
        NormalizeWireType<GeneratedVerifyFailureResponse>,
        "authenticated" | "error"
      >,
      Pick<NormalizeWireType<VerifyFailureResponse>, "authenticated" | "error">
    >
  >();
  assertType<
    IsEqual<paths["/auth/challenge"]["post"], GeneratedChallengeOperation>
  >();
  assertType<
    IsEqual<paths["/auth/verify"]["post"], GeneratedVerifyOperation>
  >();

  assertType<IsAssignable<GeneratedLogoutOperation, { requestBody?: never }>>();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedLogoutResponse>,
      NormalizeWireType<DestroySessionResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedListSessionsResponse>,
      NormalizeWireType<ListSessionsResponse>
    >
  >();
  assertType<
    IsAssignable<GeneratedDestroySessionPathParams, { sessionId: string }>
  >();
  assertType<
    IsAssignable<{ sessionId: string }, GeneratedDestroySessionPathParams>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedDestroySessionResponse>,
      NormalizeWireType<DestroySessionResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedDestroySessionErrorResponse>,
      NormalizeWireType<ErrorResponse>
    >
  >();
  assertType<
    IsAssignable<GeneratedUserIdentityPathParams, { userId: string }>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedUserIdentityResponse>,
      NormalizeWireType<UserIdentityResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GeneratedWebSocketTicketResponse>,
      NormalizeWireType<WebSocketTicketResponse>
    >
  >();
  assertType<
    IsEqual<paths["/auth/logout"]["post"], GeneratedLogoutOperation>
  >();
  assertType<
    IsEqual<paths["/auth/sessions"]["get"], GeneratedListSessionsOperation>
  >();
  assertType<
    IsEqual<
      paths["/auth/sessions/{sessionId}"]["delete"],
      GeneratedDestroySessionOperation
    >
  >();
  assertType<
    IsEqual<
      paths["/auth/user-identity/{userId}"]["get"],
      GeneratedUserIdentityOperation
    >
  >();
  assertType<
    IsEqual<paths["/auth/ws-ticket"]["post"], GeneratedWebSocketTicketOperation>
  >();
});
