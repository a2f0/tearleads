// Document stores snapshot an attachment's source before queueing its upload.

export { attachmentContentSha256 } from "../../data/blobs/attachmentContentIdentity";
export {
  type BlobSourceSnapshot,
  inspectBlobSource,
} from "../../data/blobs/attachments/blobSourceSnapshot";
export type {
  BlobAttachmentCollaborators,
  BlobAttachmentServiceApi,
} from "../../data/blobs/attachments/collaborators";
export { DEFAULT_BLOB_CHUNK_SIZE_BYTES } from "../../data/blobs/attachments/crypto";
export type {
  DecryptDocumentAttachmentBlobRequest,
  DetachDocumentAttachmentRequest,
  DetachDocumentAttachmentResult,
  MultipartStageResolvedListener,
  MultipartUploadProgress,
  MultipartUploadProgressListener,
  UploadDocumentAttachmentRequest,
  UploadDocumentAttachmentResult,
} from "../../data/blobs/attachments/types";
export type {
  BlobByteSource,
  BlobByteSourceInput,
  BlobBytes,
  BlobStore,
} from "../../data/blobs/blobContracts";
export {
  BlobIntegrityError,
  blobByteSourceInputLength,
  createBlobByteSource,
  readBlobByteSource,
} from "../../data/blobs/blobContracts";
export { createBlobStore } from "../../data/blobs/createBlobStore";
export type {
  EncryptedBlobStoreCipher,
  EncryptedBlobStoreKey,
  EncryptedBlobStoreOptions,
  WrapEncryptedBlobStoreOptions,
} from "../../data/blobs/encryptedBlobStore";
export {
  createEncryptedBlobStore,
  createLazyEncryptedBlobStore,
  wrapEncryptedBlobStore,
} from "../../data/blobs/encryptedBlobStore";
export { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
export { purgeOpfsBlobStore } from "../../data/blobs/opfsBlobStore";
export { BlobAttachmentService } from "./blobAttachmentService";
export type {
  HydrateDocumentAttachmentBlobsRequest,
  HydratedDocumentAttachmentBlob,
} from "./hydration/hydrate";
