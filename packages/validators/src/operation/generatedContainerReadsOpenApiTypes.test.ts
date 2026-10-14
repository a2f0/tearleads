import { test } from "bun:test";
import type {
  ListContainerDocumentLanesRequest,
  ListContainerParentLanesRequest,
} from "../request";
import type {
  ContainerKekLogResponse,
  ListContainerDocumentLanesResponse,
  ListContainerParentLanesResponse,
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

type KekLogOperation = operations["containers.kekLog.get"];
type KekLogResponse =
  KekLogOperation["responses"][200]["content"]["application/json"];
type DocumentsOperation = operations["containers.documentLanes.query"];
type DocumentsRequest =
  DocumentsOperation["requestBody"]["content"]["application/json"];
type DocumentsResponse =
  DocumentsOperation["responses"][200]["content"]["application/json"];
type ParentLanesOperation = operations["containers.parentLanes.query"];
type ParentLanesRequest =
  ParentLanesOperation["requestBody"]["content"]["application/json"];
type ParentLanesResponse =
  ParentLanesOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match container read contracts", () => {
  assertType<
    IsEqual<paths["/containers/{containerId}/kek-log"]["get"], KekLogOperation>
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<KekLogResponse>,
      NormalizeWireType<ContainerKekLogResponse>
    >
  >();
  assertType<
    IsEqual<paths["/containers/documents/query"]["post"], DocumentsOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<DocumentsRequest>,
      NormalizeWireType<ListContainerDocumentLanesRequest>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<DocumentsResponse>,
      NormalizeWireType<ListContainerDocumentLanesResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/containers/parent-lanes/query"]["post"],
      ParentLanesOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<ParentLanesRequest>,
      NormalizeWireType<ListContainerParentLanesRequest>
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<ParentLanesResponse>,
      NormalizeWireType<ListContainerParentLanesResponse>
    >
  >();
});
