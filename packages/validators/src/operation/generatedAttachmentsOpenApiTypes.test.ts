import { test } from "bun:test";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "../request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
  ListDocumentAttachmentsResponse,
  PaymentRequiredErrorResponse,
} from "../response";
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

type BindOperation = operations["blobs.attachmentBindings.bind"];
type BindRequest = BindOperation["requestBody"]["content"]["application/json"];
type BindResponse =
  BindOperation["responses"][200]["content"]["application/json"];
type BindPaymentRequiredResponse =
  BindOperation["responses"][402]["content"]["application/json"];
type DetachOperation = operations["blobs.attachmentBindings.detach"];
type DetachRequest =
  DetachOperation["requestBody"]["content"]["application/json"];
type DetachResponse =
  DetachOperation["responses"][200]["content"]["application/json"];
type ListOperation = operations["documents.attachments.list"];
type ListResponse =
  ListOperation["responses"][200]["content"]["application/json"];

function assertType<Condition extends true>(_condition?: Condition): void {}

test("generated OpenAPI types match attachment contracts", () => {
  assertType<
    IsEqual<paths["/blobs/{blobId}/attachment-bindings"]["post"], BindOperation>
  >();
  assertType<
    IsAssignable<BindOperation["parameters"]["path"], { blobId: string }>
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<BindRequest>,
      NormalizeWireType<BlobAttachmentBindRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<BindResponse>,
      NormalizeWireType<BlobAttachmentBindResponse>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<BindPaymentRequiredResponse>,
      NormalizeWireType<PaymentRequiredErrorResponse>
    >
  >();
  assertType<
    IsEqual<
      paths["/blobs/{blobId}/attachment-bindings/{bindingId}/detach"]["post"],
      DetachOperation
    >
  >();
  assertType<
    IsAssignable<
      NormalizeWireType<DetachRequest>,
      NormalizeWireType<BlobAttachmentDetachRequest>
    >
  >();
  assertType<
    IsEqual<
      NormalizeWireType<DetachResponse>,
      NormalizeWireType<BlobAttachmentDetachResponse>
    >
  >();
  assertType<
    IsEqual<paths["/documents/{documentId}/attachments"]["get"], ListOperation>
  >();
  assertType<
    IsEqual<
      NormalizeWireType<ListResponse>,
      NormalizeWireType<ListDocumentAttachmentsResponse>
    >
  >();
});
