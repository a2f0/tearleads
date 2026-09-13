import { KeyingVerificationError } from "@tearleads/crypto";
import { assertBlobContentKeyBundleTargetHash } from "../../data/documents/blob/shared/responses";
import type { DecryptDocumentAttachmentBlobInput } from "../../data/documents/blob/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import {
  type DocumentWriterProjectionAuthorization,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import { assertAttachmentBindingVerified } from "./attachmentBindingVerification";
import { assertBlobWrapScopeVerified } from "./verifiedWrapScope";

/** Retaining an existing envelope does not propagate a key to a new recipient. */
export async function verifyRetainedAttachment(
  input: Omit<
    DecryptDocumentAttachmentBlobInput,
    "encryptedBytes" | "targetSecretKey"
  >,
): Promise<void> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Retained attachment scope",
  );
  let authorization: DocumentWriterProjectionAuthorization | undefined;
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    allowStaleContentKeyBundle: true,
    ...projectionVerificationOptions({
      execSql: input.execSql,
      resolveProjectionUserKey,
    }),
    onVerifiedAuthorization: (value) => {
      authorization = value;
    },
  });
  if (input.binding.contentKeyBundle.blobId !== input.binding.blobId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Retained attachment bundle names another blob",
    );
  await assertBlobContentKeyBundleTargetHash(input.binding.contentKeyBundle);
  await assertAttachmentBindingVerified({
    ...input,
    authorization,
    resolveProjectionUserKey,
  });
  if (!authorization) throw new Error("Attachment authority is unavailable");
  assertBlobWrapScopeVerified({
    authorization,
    binding: input.binding,
    documentId: input.expectedDocumentId,
  });
}
