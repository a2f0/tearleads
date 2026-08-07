import type { ContainerDocumentLinks } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

export interface ExplorerDocumentLinksRuntimeInput {
  auth: RuntimeSnapshot["auth"];
  crypto: RuntimeSnapshot["crypto"];
  infra: RuntimeSnapshot["infra"];
  state: RuntimeSnapshot["state"];
  util: RuntimeSnapshot["util"];
}

export function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

export function isIgnorableDatabaseWorkerError(error: unknown): boolean {
  return (
    isDestroyedDatabaseWorkerError(error) ||
    (error instanceof Error &&
      error.message === "Database client is unavailable.")
  );
}

export function useExplorerDocumentLinks(
  appData: ExplorerDocumentLinksRuntimeInput,
): ContainerDocumentLinks {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentLinks(),
    [
      appData.auth,
      appData.crypto,
      appData.infra,
      appData.state,
      appData.util,
      containerContents,
    ],
  );
}
