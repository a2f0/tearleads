import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { selfContactIdentityAdmission } from "../../../../stores/contacts/currentSelfContactIdentityState";
import {
  type DocumentVersionCopyContent,
  saveDocumentVersionCopy,
} from "../../../../stores/document-history/saveDocumentVersionCopy";
import { isContainerUnderTrashByLookup } from "../../../../stores/explorer/ExplorerSystemContainers";
import {
  canSaveDocumentCopyByRules,
  type ExplorerContainerRulesContext,
} from "../../model/containerRules";

/** Saving a version of a document as a new document beside it. */
export interface ExplorerDocumentVersionCopy {
  /** Whether a version of `document` of this kind may be saved beside it. */
  canSave: (
    document: DocumentSummary,
    documentKind: StoredDocumentKind,
  ) => boolean;
  /** Show a saved copy. */
  open: (copy: DocumentSummary) => void;
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

export function useExplorerDocumentVersionCopy(params: {
  appData: Pick<ContainerDocumentLinks, "openDocument">;
  /** The database and account the Explorer shows. */
  domainScope: object;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  selectExplorerDocument: (localId: string, containerId: string) => void;
}): ExplorerDocumentVersionCopy {
  const {
    appData,
    domainScope,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    rulesContext,
    selectExplorerDocument,
  } = params;
  const shownScope = useRef(domainScope);
  useLayoutEffect(() => {
    shownScope.current = domainScope;
  }, [domainScope]);

  // History asks on every stop it shows, so the folders are indexed once.
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const canSave = useCallback<ExplorerDocumentVersionCopy["canSave"]>(
    (document, documentKind) =>
      document.containerId !== null &&
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
        documentKind,
      ),
    [nodesById, rulesContext],
  );

  const save = useCallback<ExplorerDocumentVersionCopy["save"]>(
    (document, content) => {
      const create = async () => {
        const { containerId } = document;
        // The button was offered under these rules, but this runs after a
        // confirmation: the folder may have been trashed or lost write
        // access since.
        if (containerId === null || !canSave(document, content.documentKind)) {
          return null;
        }
        const copy = await saveDocumentVersionCopy({
          containerId,
          content,
          createLocalId: () => crypto.randomUUID(),
          loadDocumentSummary,
          openDocument: (input) => appData.openDocument(input),
        });
        // A copy made under another database or account is not this list's.
        if (copy !== null && shownScope.current === domainScope) {
          mergeDocumentSummary(copy);
        }
        return copy;
      };
      if (content.documentKind !== "contact") return create();
      // A contact version must not be Me. Like a move or a purge, it waits
      // for a pending Me read and runs only if that read still stands.
      const admission = selfContactIdentityAdmission(
        rulesContext.selfContactIdentity,
      );
      return admission === null
        ? Promise.resolve(null)
        : admission.runWhenCurrent(create);
    },
    [
      appData,
      canSave,
      domainScope,
      loadDocumentSummary,
      mergeDocumentSummary,
      rulesContext.selfContactIdentity,
    ],
  );

  const open = useCallback<ExplorerDocumentVersionCopy["open"]>(
    (copy) => {
      if (copy.containerId !== null) {
        selectExplorerDocument(copy.id, copy.containerId);
      }
    },
    [selectExplorerDocument],
  );

  return useMemo(() => ({ canSave, open, save }), [canSave, open, save]);
}
