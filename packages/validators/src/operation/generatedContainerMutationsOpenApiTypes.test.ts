import { test } from "bun:test";
import type {
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
} from "../request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerDeleteResponse,
  ContainerMutationResponse,
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

type CreateOperation = operations["containers.create"];
type CreateRequest =
  CreateOperation["requestBody"]["content"]["application/json"];
type CreateResponse =
  CreateOperation["responses"][200]["content"]["application/json"];
type MetadataOperation = operations["containers.withMetadataDocument.create"];
type MetadataRequest =
  MetadataOperation["requestBody"]["content"]["application/json"];
type MetadataResponse =
  MetadataOperation["responses"][200]["content"]["application/json"];
type DeleteOperation = operations["containers.delete"];
type DeleteResponse =
  DeleteOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match container mutation contracts", () => {
  assertType<IsEqual<paths["/containers"]["post"], CreateOperation>>();
  assertType<
    IsAssignable<
      NormalizeWireType<CreateRequest>,
      NormalizeWireType<ContainerMutationRequest>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<CreateResponse>,
      NormalizeWireType<ContainerMutationResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/containers/with-metadata-document"]["post"],
      MetadataOperation
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<MetadataRequest>,
      NormalizeWireType<ContainerCreateWithMetadataDocumentRequest>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<MetadataResponse>,
      NormalizeWireType<ContainerCreateWithMetadataDocumentResponse>
    >
  >();

  assertType<
    IsEqual<paths["/containers/{containerId}"]["delete"], DeleteOperation>
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<DeleteResponse>,
      NormalizeWireType<ContainerDeleteResponse>
    >
  >();

  assertType<
    IsEqual<
      paths["/containers/{containerId}/move"]["post"],
      operations["containers.move"]
    >
  >();
  assertType<
    IsEqual<
      paths["/containers/{containerId}/rekey"]["post"],
      operations["containers.rekey"]
    >
  >();
  assertType<
    IsEqual<
      paths["/containers/{containerId}/revoke"]["post"],
      operations["containers.revoke"]
    >
  >();
  assertType<
    IsEqual<
      paths["/containers/{containerId}/share"]["post"],
      operations["containers.share"]
    >
  >();
});
