import { test } from "bun:test";
import type {
  ContainerWriterProjectionResponse,
  DocumentNotFoundErrorResponse,
  DocumentWriterProjectionErrorResponse,
  DocumentWriterProjectionResponse,
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

type ContainerOperation = operations["containers.writerProjection.get"];
type ContainerResponse =
  ContainerOperation["responses"][200]["content"]["application/json"];
type DocumentOperation = operations["documents.writerProjection.get"];
type DocumentResponse =
  DocumentOperation["responses"][200]["content"]["application/json"];
type DocumentNotFoundResponse =
  DocumentOperation["responses"][404]["content"]["application/json"];
type DocumentConflictResponse =
  DocumentOperation["responses"][409]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match writer projection contracts", () => {
  assertType<
    IsEqual<
      paths["/containers/{containerId}/writer-projection"]["get"],
      ContainerOperation
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<ContainerResponse>,
      NormalizeWireType<ContainerWriterProjectionResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/writer-projection"]["get"],
      DocumentOperation
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<DocumentResponse>,
      NormalizeWireType<DocumentWriterProjectionResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<DocumentNotFoundResponse>,
      NormalizeWireType<DocumentNotFoundErrorResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<DocumentConflictResponse>,
      NormalizeWireType<DocumentWriterProjectionErrorResponse>
    >
  >();
});
