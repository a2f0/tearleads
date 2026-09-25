import { afterEach, expect, test } from "bun:test";
import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { EXPLORER_ORPHANED_DOCUMENTS_ID } from "../../../stores/explorer/orphanedDocuments";
import { useExplorerNodesWithOrphanedDocuments } from "./useExplorerOrphanedDocuments";

afterEach(() => cleanup());

test("the Explorer adds recovery only while the active scope has orphans", async () => {
  const calls: Array<string | null> = [];
  const documentQueries = {
    hasOrphanedDocuments: async ({
      currentOrganizationId,
    }: {
      currentOrganizationId: string | null;
    }) => {
      calls.push(currentOrganizationId);
      return currentOrganizationId === "org-1";
    },
  } as unknown as ContainerDocumentQueries;
  const view = renderHook(
    ({ organizationId }: { organizationId: string | null }) =>
      useExplorerNodesWithOrphanedDocuments({
        dbReady: true,
        documentLinkProjectionVersion: 0,
        documentListRevision: 0,
        documentQueries,
        logError: () => undefined,
        nodes: [],
        organizationId,
        ready: true,
      }),
    { initialProps: { organizationId: "org-1" } },
  );

  expect(view.result.current).toEqual([]);
  await waitFor(() => {
    expect(view.result.current.map((node) => node.id)).toEqual([
      EXPLORER_ORPHANED_DOCUMENTS_ID,
    ]);
  });

  view.rerender({ organizationId: "org-2" });
  expect(view.result.current).toEqual([]);
  await waitFor(() => expect(calls).toEqual(["org-1", "org-2"]));
  expect(view.result.current).toEqual([]);
});

test("the Explorer logs an orphan visibility query failure", async () => {
  const failure = new Error("query failed");
  const logged: Array<[string, unknown]> = [];
  const documentQueries = {
    hasOrphanedDocuments: async () => {
      throw failure;
    },
  } as unknown as ContainerDocumentQueries;
  const view = renderHook(() =>
    useExplorerNodesWithOrphanedDocuments({
      dbReady: true,
      documentLinkProjectionVersion: 0,
      documentListRevision: 0,
      documentQueries,
      logError: (message, cause) => logged.push([message, cause]),
      nodes: [],
      organizationId: "org-1",
      ready: true,
    }),
  );

  await waitFor(() => {
    expect(logged).toEqual([
      ["Failed to check for orphaned documents", failure],
    ]);
  });
  expect(view.result.current).toEqual([]);
});

test("a local folder with a missing parent makes Recovery reachable", async () => {
  const documentQueries = {
    hasOrphanedDocuments: async () => false,
  } as unknown as ContainerDocumentQueries;
  const node = {
    id: "local",
    organizationId: "org",
    parentId: "missing",
    metadataDocumentId: null,
    name: "Local",
    kind: "container" as const,
    syncState: {
      pendingUpdateCount: 0,
      pendingAttachmentCount: 0,
      pendingAttachmentBytes: 0,
      lastError: null,
      status: "local-only" as const,
    },
  };
  const view = renderHook(() =>
    useExplorerNodesWithOrphanedDocuments({
      dbReady: true,
      documentLinkProjectionVersion: 0,
      documentListRevision: 0,
      documentQueries,
      logError: () => undefined,
      nodes: [node],
      organizationId: "org",
      ready: true,
    }),
  );
  expect(view.result.current.map((item) => item.id)).toContain(
    EXPLORER_ORPHANED_DOCUMENTS_ID,
  );
  await waitFor(() => expect(view.result.current).toHaveLength(2));
});
