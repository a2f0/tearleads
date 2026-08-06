import { test } from "bun:test";
import type { UploadMultipartBlobPartResponse } from "../response";
import type {
  BlobBytesResponseHeaders,
  MultipartBlobPartHeaders,
} from "./blobBytes";
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

type GetOperation = operations["blobs.bytes.get"];
type GetHeaders = GetOperation["responses"][200]["headers"];
type GetBody =
  GetOperation["responses"][200]["content"]["application/octet-stream"];
type UploadOperation = operations["blobs.multipartStages.parts.upload"];
type UploadHeaders = UploadOperation["parameters"]["header"];
type UploadBody =
  UploadOperation["requestBody"]["content"]["application/octet-stream"];
type UploadResponse =
  UploadOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match blob byte contracts", () => {
  assertType<IsEqual<paths["/blobs/{blobId}/bytes"]["get"], GetOperation>>();
  assertType<
    IsEqual<
      NormalizeWireType<GetHeaders>,
      NormalizeWireType<BlobBytesResponseHeaders>
    >
  >();
  assertType<IsEqual<GetBody, string>>();
  assertType<
    IsEqual<
      paths["/blobs/stages/multipart/{stageId}/parts/{partNumber}/bytes"]["put"],
      UploadOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<UploadHeaders>,
      NormalizeWireType<MultipartBlobPartHeaders>
    >
  >();
  assertType<IsEqual<UploadBody, string>>();
  assertType<
    IsEqual<
      NormalizeWireType<UploadResponse>,
      NormalizeWireType<UploadMultipartBlobPartResponse>
    >
  >();
});
