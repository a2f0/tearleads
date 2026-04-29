import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useAppData } from "../../../data/AppDataProvider";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/containers";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import {
  areLinkedContainerIdMapsEqual,
  getRequestedDocumentIds,
} from "../documentSummaryUtils";
import { isDestroyedDatabaseWorkerError } from "../explorerRuntime";

export function useDocumentLinkedContainerIdsByDocumentId(params: {
  dbStatus: ReturnType<typeof useAppData>["dbStatus"];
  documentLinkProjectionVersion: number;
  execSql: ReturnType<typeof useAppData>["execSql"];
  documentSummaries: ReadonlyArray<DocumentSummary>;
}) {
  const {
    dbStatus,
    documentLinkProjectionVersion,
    execSql,
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
      setLinkedContainerIdsByDocumentId(new Map());
      return;
    }

    let cancelled = false;
    const loadVersion = linkedContainerIdsLoadVersionRef.current + 1;
    linkedContainerIdsLoadVersionRef.current = loadVersion;
    void (async () => {
      try {
        const nextLinkedContainerIdsByDocumentId =
          await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
            execSql,
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
    documentLinkProjectionVersion,
    execSql,
    requestedDocumentIdsKey,
  ]);

  return { linkedContainerIdsByDocumentId, setLinkedContainerIdsForDocument };
}
