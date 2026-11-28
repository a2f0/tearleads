import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { touchDocumentAndLinkedContainers } from "../../documents/mutations/shared/documentRows";
import { markBlobDereferencedIfInactive } from "./persistence";

/** Complete blocking projection writes before starting a blob's GC grace. */
export async function finalizeAttachmentMutation(input: {
  readonly dereferencedBlobId?: string;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  /** True when a carried document sync already touched the document and containers. */
  readonly skipTargetsTouch?: boolean | undefined;
}): Promise<void> {
  if (!input.skipTargetsTouch) {
    await touchDocumentAndLinkedContainers(input.executor, {
      documentId: input.documentId,
      linkedContainerIds: input.linkedContainerIds,
      organizationId: input.organizationId,
    });
  }
  if (input.dereferencedBlobId !== undefined) {
    await markBlobDereferencedIfInactive({
      blobId: input.dereferencedBlobId,
      executor: input.executor,
    });
  }
}
