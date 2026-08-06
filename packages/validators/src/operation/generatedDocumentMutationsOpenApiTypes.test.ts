import { test } from "bun:test";
import type {
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
} from "../request";
import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentPurgeResponse,
} from "../response";
import type { operations, paths } from "./generatedOpenApi";

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
type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
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

type CreateOperation = operations["documents.create"];
type CreateRequest =
  CreateOperation["requestBody"]["content"]["application/json"];
type CreateResponse =
  CreateOperation["responses"][200]["content"]["application/json"];
type LinkOperation = operations["documents.link"];
type LinkRequest = LinkOperation["requestBody"]["content"]["application/json"];
type LinkResponse =
  LinkOperation["responses"][200]["content"]["application/json"];
type DeleteOperation = operations["documents.delete"];
type DeleteResponse =
  DeleteOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match document mutation contracts", () => {
  assertType<IsEqual<paths["/documents"]["post"], CreateOperation>>();
  assertType<
    IsAssignable<
      NormalizeWireType<CreateRequest>,
      NormalizeWireType<DocumentCreateRequest>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<CreateResponse>,
      NormalizeWireType<DocumentCreateResponse>
    >
  >();

  assertType<
    IsEqual<paths["/documents/{documentId}/link"]["post"], LinkOperation>
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<LinkRequest>,
      NormalizeWireType<DocumentLinkSetMutationRequest>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<LinkResponse>,
      NormalizeWireType<DocumentLinkSetMutationResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/unlink"]["post"],
      operations["documents.unlink"]
    >
  >();

  assertType<
    IsEqual<paths["/documents/{documentId}"]["delete"], DeleteOperation>
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<DeleteResponse>,
      NormalizeWireType<DocumentPurgeResponse>
    >
  >();
});
