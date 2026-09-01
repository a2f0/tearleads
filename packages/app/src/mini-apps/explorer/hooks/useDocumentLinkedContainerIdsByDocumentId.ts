import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isDestroyedDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import {
  areLinkedContainerIdMapsEqual,
  getRequestedDocumentIds,
} from "../../../stores/explorer/documentSummaryUtils";

export function useDocumentLinkedContainerIdsByDocumentId(params: {
  dbStatus: RuntimeSnapshot["infra"]["dbStatus"];
  documentQueries: ContainerDocumentQueries;
  documentLinkProjectionVersion: number;
  documentSummaries: ReadonlyArray<DocumentSummary>;
}) {
  const {
    dbStatus,
    documentQueries,
    documentLinkProjectionVersion,
    documentSummaries,
  } = params;
  const [linkedContainerIdsByDocumentId, setLinkedContainerIdsByDocumentId] =
    useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map());
  const linkedContainerIdsLoadVersionRef = useRef(0);
  const requestedDocumentIds = useMemo(
    () => getRequestedDocumentIds(documentSummaries),
    [documentSummaries],
  );
  const requestedDocumentIdsKey = requestedDocumentIds.join("\u0000");
  const setLinkedContainerIdsForDocument = useCallback(
    (documentId: string, linkedContainerIds: ReadonlyArray<string>) => {
      setLinkedContainerIdsByDocumentId((currentMap) => {
        const nextLinkedContainerIds = Array.from(
          new Set(linkedContainerIds),
        ).sort();
        const currentLinkedContainerIds = currentMap.get(documentId);
        if (
          currentLinkedContainerIds &&
          currentLinkedContainerIds.length === nextLinkedContainerIds.length &&
          currentLinkedContainerIds.every(
            (containerId, index) =>
              containerId === nextLinkedContainerIds[index],
          )
        ) {
          return currentMap;
        }

        const nextMap = new Map(currentMap);
        nextMap.set(documentId, nextLinkedContainerIds);
        return nextMap;
      });
    },
    [],
  );

  useEffect(() => {
    if (dbStatus !== "ready" || requestedDocumentIds.length === 0) {
      setLinkedContainerIdsByDocumentId((currentMap) =>
        currentMap.size === 0 ? currentMap : new Map(),
      );
      return;
    }

    let cancelled = false;
    const loadVersion = linkedContainerIdsLoadVersionRef.current + 1;
    linkedContainerIdsLoadVersionRef.current = loadVersion;
    void (async () => {
      try {
        const nextLinkedContainerIdsByDocumentId =
          await documentQueries.listLinkedContainerIdsByDocumentIds(
            requestedDocumentIds,
          );
        if (
          !cancelled &&
          linkedContainerIdsLoadVersionRef.current === loadVersion
        ) {
          setLinkedContainerIdsByDocumentId((currentMap) =>
            areLinkedContainerIdMapsEqual(
              currentMap,
              nextLinkedContainerIdsByDocumentId,
            )
              ? currentMap
              : nextLinkedContainerIdsByDocumentId,
          );
        }
      } catch (error: unknown) {
        if (!cancelled && !isDestroyedDatabaseWorkerError(error)) {
          console.error(
            "Explorer: failed to load linked container projections:",
            error,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dbStatus,
    documentQueries,
    documentLinkProjectionVersion,
    requestedDocumentIdsKey,
  ]);

  return { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument };
}
