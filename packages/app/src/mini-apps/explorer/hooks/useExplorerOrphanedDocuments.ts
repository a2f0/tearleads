import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { isIgnorableDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
} from "../../../stores/explorer/orphanedDocuments";
import { EXPLORER_LABELS } from "../labels";

interface OrphanedDocumentsVisibility {
  documentQueries: ContainerDocumentQueries;
  organizationId: string | null;
  visible: boolean;
}

function retainEqualVisibility(
  current: OrphanedDocumentsVisibility | null,
  next: OrphanedDocumentsVisibility,
): OrphanedDocumentsVisibility {
  return current?.documentQueries === next.documentQueries &&
    current.organizationId === next.organizationId &&
    current.visible === next.visible
    ? current
    : next;
}

export function useExplorerNodesWithOrphanedDocuments(params: {
  dbReady: boolean;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  nodes: ReadonlyArray<ContainerNode>;
  organizationId: string | null;
  logError: (message: string, cause?: unknown) => void;
  ready: boolean;
}): ReadonlyArray<ContainerNode> {
  const [visibility, setVisibility] =
    useState<OrphanedDocumentsVisibility | null>(null);
  const {
    dbReady,
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    nodes,
    organizationId,
    logError,
    ready,
  } = params;
  const logErrorRef = useRef(logError);
  logErrorRef.current = logError;
  // A container removal can create row-3 orphans, so topology changes must
  // re-probe even when the document revision counters have not changed.
  const nodeIdsKey = nodes.map((node) => node.id).join("\u0000");

  useEffect(() => {
    if (!dbReady || !ready) {
      return;
    }

    let current = true;
    const loadVisibility = async () => {
      try {
        const visible = await documentQueries.hasOrphanedDocuments({
          currentOrganizationId: organizationId,
        });
        if (current) {
          setVisibility((previous) =>
            retainEqualVisibility(previous, {
              documentQueries,
              organizationId,
              visible,
            }),
          );
        }
      } catch (error) {
        if (current) {
          if (!isIgnorableDatabaseWorkerError(error)) {
            logErrorRef.current(
              "Failed to check for orphaned documents",
              error,
            );
          }
          setVisibility((previous) =>
            retainEqualVisibility(previous, {
              documentQueries,
              organizationId,
              visible: false,
            }),
          );
        }
      }
    };
    void loadVisibility();

    return () => {
      current = false;
    };
  }, [
    dbReady,
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    nodeIdsKey,
    organizationId,
    ready,
  ]);

  const visible =
    dbReady &&
    ready &&
    visibility?.documentQueries === documentQueries &&
    visibility.organizationId === organizationId &&
    visibility.visible;

  return useMemo(
    () =>
      visible &&
      !nodes.some((node) => node.id === EXPLORER_ORPHANED_DOCUMENTS_ID)
        ? [
            ...nodes,
            createExplorerOrphanedDocumentsNode(
              organizationId,
              EXPLORER_LABELS.orphanedDocumentsName,
            ),
          ]
        : nodes,
    [nodes, organizationId, visible],
  );
}
