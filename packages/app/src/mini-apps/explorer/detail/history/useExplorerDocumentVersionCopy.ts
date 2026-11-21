import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { isFileBackedDocumentKind } from "../../../../document-types/registry";
import { isTruthyStructuredField } from "../../../../document-types/shared/documentFieldUtils";
import {
  type SelfContactIdentityView,
  selfContactIdentityAdmission,
} from "../../../../stores/contacts/currentSelfContactIdentityState";
import {
  type DocumentVersionCopyContent,
  type OpenDocumentVersionCopy,
  saveDocumentVersionCopy,
} from "../../../../stores/document-history/saveDocumentVersionCopy";
import { isContainerUnderTrashByLookup } from "../../../../stores/explorer/ExplorerSystemContainers";
import {
  canSaveDocumentCopyByRules,
  type ExplorerContainerRulesContext,
} from "../../model/containerRules";

/** Saving a version of a document as a new document beside it. */
export interface ExplorerDocumentVersionCopy {
  /** Whether this version of `document` may be saved beside it. */
  canSave: (
    document: DocumentSummary,
    content: DocumentVersionCopyContent,
  ) => boolean;
  /** Show a saved copy. */
  open: (copy: DocumentSummary) => void;
  /** The database and account copies are saved under. */
  scope: object;
  /**
   * Create the copy in the folder `document` is in now. Resolves the new
   * document, or null when the folder no longer takes it or it could not be
   * created.
   */
  save: (
    document: DocumentSummary,
    content: DocumentVersionCopyContent,
  ) => Promise<DocumentSummary | null>;
}

/**
 * A contact version that says it is the viewer. Me is refused by identity,
 * but other contacts carry the field too (the viewer's own roster profile,
 * or a contact left from another identity). A copy leaves the field out in
 * any case, so this is a second guard: it spares the viewer a copy of
 * themselves that no longer says who it is.
 */
function claimsToBeViewer(content: DocumentVersionCopyContent): boolean {
  const { isSelf = "" } = content.structuredFields;
  // The one reading of the field: the contact model and its projection, which
  // decide what Contacts labels "You", use it too.
  return content.documentKind === "contact" && isTruthyStructuredField(isSelf);
}

/**
 * Whether a version's content can stand as a document of its own. A
 * file-backed version (an image, a PDF, any uploaded file) is its attachment,
 * and attachments are not copied: the copy would be a file document with no
 * file.
 */
function canStandAlone(content: DocumentVersionCopyContent): boolean {
  return (
    !isFileBackedDocumentKind(content.documentKind) &&
    !claimsToBeViewer(content)
  );
}

/** What a copy is created under. */
interface DocumentVersionCopyAuthority {
  /** Opens a document store, as Explorer's document links do. */
  appData: { openDocument: OpenDocumentVersionCopy };
  canSave: ExplorerDocumentVersionCopy["canSave"];
  /** The database and account the Explorer shows. */
  domainScope: object;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  selfContactIdentity: SelfContactIdentityView;
}

/**
 * Create the copy under the authority that is current when this runs, not
 * the one the copy was offered under: a confirmation stays open while
 * folders and access change, and a contact version also waits for the Me
 * read.
 */
function saveUnderCurrentAuthority(
  current: { readonly current: DocumentVersionCopyAuthority },
  document: DocumentSummary,
  content: DocumentVersionCopyContent,
): Promise<DocumentSummary | null> {
  const create = async () => {
    const now = current.current;
    const { containerId } = document;
    // The folder may have been trashed or lost write access since the copy
    // was offered.
    if (containerId === null || !now.canSave(document, content)) {
      return null;
    }
    const copy = await saveDocumentVersionCopy({
      containerId,
      content,
      createLocalId: () => crypto.randomUUID(),
      loadDocumentSummary: now.loadDocumentSummary,
      openDocument: (input) => now.appData.openDocument(input),
    });
    // A copy made under another database or account is not this list's.
    if (copy !== null && current.current.domainScope === now.domainScope) {
      now.mergeDocumentSummary(copy);
    }
    return copy;
  };
  if (content.documentKind !== "contact") return create();
  // A contact version must not be Me. Like a move or a purge, it waits for a
  // pending Me read and runs only if that read still stands.
  const admission = selfContactIdentityAdmission(
    current.current.selfContactIdentity,
  );
  return admission === null
    ? Promise.resolve(null)
    : admission.runWhenCurrent(create);
}

export function useExplorerDocumentVersionCopy(
  params: Omit<
    DocumentVersionCopyAuthority,
    "canSave" | "selfContactIdentity"
  > & {
    nodes: ReadonlyArray<ContainerNode>;
    rulesContext: ExplorerContainerRulesContext;
    selectExplorerDocument: (localId: string, containerId: string) => void;
  },
): ExplorerDocumentVersionCopy {
  const {
    appData,
    domainScope,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    rulesContext,
    selectExplorerDocument,
  } = params;

  // History asks on every stop it shows, so the folders are indexed once.
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const canSave = useCallback<ExplorerDocumentVersionCopy["canSave"]>(
    (document, content) =>
      document.containerId !== null &&
      canStandAlone(content) &&
      // A folder moved to the Trash keeps no rules of its own, but everything
      // under the Trash is read-only: nothing new is born there.
      !isContainerUnderTrashByLookup(
        nodesById,
        document.containerId,
        rulesContext,
      ) &&
      canSaveDocumentCopyByRules(
        rulesContext,
        nodesById.get(document.containerId),
        document,
        content.documentKind,
      ),
    [nodesById, rulesContext],
  );

  const { selfContactIdentity } = rulesContext;
  const authority = useMemo<DocumentVersionCopyAuthority>(
    () => ({
      appData,
      canSave,
      domainScope,
      loadDocumentSummary,
      mergeDocumentSummary,
      selfContactIdentity,
    }),
    [
      appData,
      canSave,
      domainScope,
      loadDocumentSummary,
      mergeDocumentSummary,
      selfContactIdentity,
    ],
  );
  const current = useRef(authority);
  useLayoutEffect(() => {
    current.current = authority;
  }, [authority]);

  const save = useCallback<ExplorerDocumentVersionCopy["save"]>(
    (document, content) =>
      saveUnderCurrentAuthority(current, document, content),
    [],
  );
  const open = useCallback<ExplorerDocumentVersionCopy["open"]>(
    (copy) => {
      if (copy.containerId !== null) {
        selectExplorerDocument(copy.id, copy.containerId);
      }
    },
    [selectExplorerDocument],
  );

  return useMemo(
    () => ({ canSave, open, save, scope: domainScope }),
    [canSave, domainScope, open, save],
  );
}
