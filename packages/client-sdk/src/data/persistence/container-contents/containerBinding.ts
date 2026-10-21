import { KeyingVerificationError } from "@tearleads/crypto";

/**
 * The identity this device holds for a folder: its organization and the
 * metadata document its signed `container.create` names. Both are immutable in
 * every signed successor. Purged-organization recovery may reuse a container
 * id. Its owner follows their own signed create; a re-shared member additionally
 * requires replacement authorization from the original organization's pinned
 * founder. Other changes of organization or metadata target are refused. An
 * empty organization (a pre-login local folder) or a null metadata document (a
 * folder not yet created remotely) is not yet bound and accepts its first
 * binding.
 */
export interface HeldContainerBinding {
  readonly organizationId: string;
  readonly metadataDocumentId: string | null;
  /**
   * A live, bound ordinary folder: its binding came from a verified signed
   * manifest or this device's own signed create, so a listing that repeats it
   * needs no second proof. Greenfield contract: rows written by earlier
   * clients, which trusted listing ids, are unsupported; environments reset.
   */
  readonly ordinary?: true | undefined;
}

export function heldContainerBinding(input: {
  readonly container: {
    readonly organizationId: string;
    readonly metadataDocumentId: string | null;
    readonly parentId: string | null;
    readonly systemSlot?: string | null | undefined;
  };
  readonly record: { readonly documentId: string | null } | null;
}): HeldContainerBinding {
  const { container } = input;
  const metadataDocumentId =
    container.metadataDocumentId ?? input.record?.documentId ?? null;
  const ordinary =
    container.organizationId !== "" &&
    metadataDocumentId !== null &&
    container.parentId !== null &&
    (container.systemSlot ?? null) === null;
  return {
    organizationId: container.organizationId,
    metadataDocumentId,
    ...(ordinary ? { ordinary: true as const } : {}),
  };
}

/** Whether a verified binding moves a held folder to another organization or target. */
export function rebindsHeldContainer(
  held: HeldContainerBinding | null,
  verified: {
    readonly metadataDocumentId: string;
    readonly organizationId: string;
  },
): boolean {
  if (!held) return false;
  return (
    (held.organizationId !== "" &&
      held.organizationId !== verified.organizationId) ||
    (held.metadataDocumentId !== null &&
      held.metadataDocumentId !== verified.metadataDocumentId)
  );
}

/** Whether a listing repeats a held ordinary binding exactly. */
export function listingRepeatsHeldOrdinaryBinding(
  held: HeldContainerBinding | null,
  listed: {
    readonly metadataDocumentId: string;
    readonly organizationId: string;
    readonly parentId: string | null;
    readonly systemSlot?: string | null | undefined;
  },
): boolean {
  return (
    held?.ordinary === true &&
    held.organizationId === listed.organizationId &&
    held.metadataDocumentId === listed.metadataDocumentId &&
    listed.parentId !== null &&
    (listed.systemSlot ?? null) === null
  );
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
