import { test } from "bun:test";
import type { InitiateMultipartBlobStageRequest } from "../request";
import type {
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
} from "../response";
import type { operations, paths } from "./generatedOpenApi";
import type {
  MultipartBlobPartUploadRequest,
  MultipartBlobPartUploadResponse,
} from "./multipartPartUploads";

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

type InitiateOperation = operations["blobs.multipartStages.initiate"];
type InitiateRequest =
  InitiateOperation["requestBody"]["content"]["application/json"];
type InitiateResponse =
  InitiateOperation["responses"][200]["content"]["application/json"];
type GetOperation = operations["blobs.multipartStages.get"];
type GetResponse =
  GetOperation["responses"][200]["content"]["application/json"];
type PartUploadOperation = operations["blobs.multipartStages.parts.authorize"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match part upload authorization", () => {
  assertType<
    IsEqual<
      paths["/blobs/stages/multipart/{stageId}/parts/{partNumber}/upload"]["post"],
      PartUploadOperation
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<
        PartUploadOperation["requestBody"]["content"]["application/json"]
      >,
      NormalizeWireType<MultipartBlobPartUploadRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<
        PartUploadOperation["responses"][200]["content"]["application/json"]
      >,
      NormalizeWireType<MultipartBlobPartUploadResponse>
    >
  >();
});

test("generated OpenAPI types match multipart control contracts", () => {
  assertType<
    IsEqual<paths["/blobs/stages/multipart"]["post"], InitiateOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<InitiateRequest>,
      NormalizeWireType<InitiateMultipartBlobStageRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<InitiateResponse>,
      NormalizeWireType<InitiateMultipartBlobStageResponse>
    >
  >();
  assertType<
    IsEqual<paths["/blobs/stages/multipart/{stageId}"]["get"], GetOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<GetResponse>,
      NormalizeWireType<MultipartBlobStageStatusResponse>
    >
  >();
  // Binding the attachment completes the stage, so no completion route exists.
  assertType<
    IsEqual<
      "/blobs/stages/multipart/{stageId}/complete" extends keyof paths
        ? true
        : false,
      false
    >
  >();
});
