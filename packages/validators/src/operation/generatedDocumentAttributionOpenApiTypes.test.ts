import { test } from "bun:test";
import type {
  DocumentEditAttributionResponse,
  ListDocumentEditAttributionRangesResponse,
} from "../response";
import type {
  DocumentAttributionRangesQuery,
  DocumentAttributionRequestHeaders,
} from "./documentAttribution";
import type { operations, paths } from "./generatedOpenApi";

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

type GetOperation = operations["documents.attribution.get"];
type GetHeaders = NonNullable<GetOperation["parameters"]["header"]>;
type GetResponse =
  GetOperation["responses"][200]["content"]["application/json"];
type NotModifiedContent = GetOperation["responses"][304]["content"];
type RangesOperation = operations["documents.attribution.ranges.list"];
type RangesQuery = NonNullable<RangesOperation["parameters"]["query"]>;
type RangesResponse =
  RangesOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match document attribution contracts", () => {
  assertType<
    IsEqual<paths["/documents/{documentId}/attribution"]["get"], GetOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GetHeaders>,
      NormalizeWireType<DocumentAttributionRequestHeaders>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GetResponse>,
      NormalizeWireType<DocumentEditAttributionResponse>
    >
  >();
  assertType<IsEqual<NotModifiedContent, undefined>>();
  assertType<
    IsEqual<
      paths["/documents/{documentId}/attribution/ranges"]["get"],
      RangesOperation
    >
  >();
  assertType<IsAssignable<RangesQuery, DocumentAttributionRangesQuery>>();
  assertType<
    IsAssignable<
      NormalizeWireType<RangesResponse>,
      NormalizeWireType<ListDocumentEditAttributionRangesResponse>
    >
  >();
});
