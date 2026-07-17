import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "../request";
import type { DocumentSyncResponse } from "../response";
import { documentSyncOperation } from "./documentSync";
import type { operations, paths } from "./generatedOpenApi";
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
type FixtureRequest = ReturnType<typeof createSyncRequest>;
type FixtureResponse = ReturnType<typeof createSyncResponse>;
type GeneratedFailureStatus = Exclude<keyof GeneratedResponses, 200>;
type DeclaredFailureStatus =
  (typeof documentSyncOperation.failureStatuses)[number];
type GeneratedFailuresHaveNoContent =
  GeneratedResponses[GeneratedFailureStatus] extends { content?: never }
    ? true
    : false;

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match the document sync structural contract", () => {
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
  assertType<IsAssignable<FixtureRequest, GeneratedRequest>>();
  assertType<IsAssignable<FixtureResponse, GeneratedResponse>>();
  assertType<IsAssignable<GeneratedFailureStatus, DeclaredFailureStatus>>();
  assertType<IsAssignable<DeclaredFailureStatus, GeneratedFailureStatus>>();
  assertType<GeneratedFailuresHaveNoContent>();

  expect(documentSyncOperation.method).toBe("POST");
  expect(documentSyncOperation.path).toBe("/documents/{documentId}/sync");
});
