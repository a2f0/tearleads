import { KeyingVerificationError } from "@tearleads/crypto";

/**
 * The identity this device holds for a folder: its organization and the
 * metadata document its signed `container.create` names. Both are immutable in
 * every signed successor, and container ids never recur, so an honest server
 * never presents a held folder under another organization or metadata target.
 * An empty organization (a pre-login local folder) or a null metadata document
 * (a folder not yet created remotely) is not yet bound and accepts its first
 * binding.
 */
export interface HeldContainerBinding {
  readonly organizationId: string;
  readonly metadataDocumentId: string | null;
}

export function heldContainerBinding(input: {
  readonly container: {
    readonly organizationId: string;
    readonly metadataDocumentId: string | null;
  };
  readonly record: { readonly documentId: string | null } | null;
}): HeldContainerBinding {
  return {
    organizationId: input.container.organizationId,
    metadataDocumentId:
      input.container.metadataDocumentId ?? input.record?.documentId ?? null,
  };
}

/**
 * Refuse a listing, response or persisted mutation that would move a held
 * folder into another organization or retarget its metadata document. The
 * refusal leaves the held row, its private content and its pending updates in
 * place.
 */
export function assertHeldContainerBinding(
  held: HeldContainerBinding | null,
  incoming: {
    readonly organizationId: string;
    readonly metadataDocumentIds?: ReadonlyArray<string | null> | undefined;
  },
): void {
  if (!held) return;
  if (
    held.organizationId !== "" &&
    incoming.organizationId !== held.organizationId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "container organization conflicts with its held binding",
    );
  }
  const heldDocumentId = held.metadataDocumentId;
  if (
    heldDocumentId !== null &&
    incoming.metadataDocumentIds?.some(
      (documentId) => documentId !== heldDocumentId,
    )
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "container metadata document conflicts with its held binding",
    );
  }
}
