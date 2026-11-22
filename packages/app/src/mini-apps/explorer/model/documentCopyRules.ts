import type {
  ContainerNode,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { isContainerUnderTrashByLookup } from "../../../stores/explorer/ExplorerSystemContainers";
import {
  canAddDocumentToContainerByRules,
  canMutateDocumentByIdentity,
  type ExplorerContainerRulesContext,
  hasContainerRules,
} from "./containerRules";

/** What the copy rule reads of a folder: its rules, and where it sits. */
type DocumentCopyFolder = Pick<
  ContainerNode,
  | "effectiveAccessLevel"
  | "id"
  | "name"
  | "organizationId"
  | "parentId"
  | "systemSlot"
>;

// A version saved as a copy is a new document born beside the original, so its
// folder must take a new document of the version's kind. An ordinary folder
// does when it is writable. A system folder holds what the app puts there, so
// it takes a copy only when the rules its own slot carries say so
// (`acceptsDocumentCopies`): the viewer's own Contacts, for a contact version.
// A system folder is known by its slot even before its rules are, so one whose
// rules are not loaded yet (Contacts while its slot is being derived) is not
// taken for an ordinary folder, and a shared Contacts, whose rules resolve by
// name, is not the viewer's own.
//
// The copy never touches the original, so identity matters only for what the
// copy would hold. A contact version of the viewer's Me would be born a second
// contact claiming to be them, so it waits for the Me read and is refused for
// Me; the kind is the version's, since a Me alias can list as a note.
function canFolderTakeDocumentCopy(
  context: ExplorerContainerRulesContext,
  container: DocumentCopyFolder | undefined,
  document: Pick<DocumentSummary, "id" | "documentId">,
  documentKind: StoredDocumentKind,
): boolean {
  if (
    !canAddDocumentToContainerByRules(context, container, { documentKind }) ||
    (documentKind === "contact" &&
      !canMutateDocumentByIdentity(context, document))
  ) {
    return false;
  }
  if (container?.systemSlot != null) {
    return (
      context.rulesBySystemSlot.get(container.systemSlot)
        ?.acceptsDocumentCopies === true
    );
  }
  return !hasContainerRules(context, container);
}

/**
 * Whether a version of `document` may be saved as a new document in the
 * folder the document is in now. The folder is looked up here, with its
 * ancestors: a folder moved to the Trash keeps no rules of its own, but
 * everything under the Trash is read-only, so nothing new is born there. A
 * document with no folder, or one the lookup does not hold, has nowhere
 * proven writable to save a copy.
 */
export function canSaveDocumentCopyByRules(
  context: ExplorerContainerRulesContext,
  foldersById: ReadonlyMap<string, DocumentCopyFolder>,
  document: Pick<DocumentSummary, "containerId" | "id" | "documentId">,
  documentKind: StoredDocumentKind,
): boolean {
  const { containerId } = document;
  return (
    containerId !== null &&
    !isContainerUnderTrashByLookup(foldersById, containerId, context) &&
    canFolderTakeDocumentCopy(
      context,
      foldersById.get(containerId),
      document,
      documentKind,
    )
  );
}
