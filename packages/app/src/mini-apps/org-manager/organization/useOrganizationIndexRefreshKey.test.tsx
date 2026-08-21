import { afterEach, expect, test } from "bun:test";
import {
  type ContainerNode,
  createDomainScope,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  type SymCrypt,
  syncedContainerDocumentObjectSyncState,
} from "@symcrypt/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useOrganizationIndexRefreshKey } from "./useOrganizationIndexRefreshKey";

afterEach(() => cleanup());

function rootNode(id: string, organizationId: string): ContainerNode {
  return {
    id,
    kind: "container",
    name: "/",
    organizationId,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}

function createRefreshHarness() {
  let snapshot = { nodes: [] as ContainerNode[], ready: true };
  const treeListeners = new Set<() => void>();
  let documentListener:
    | ((document: { readonly documentKind: string }) => void)
    | null = null;
  const tree = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      treeListeners.add(listener);
      return () => treeListeners.delete(listener);
    },
  };
  const symcrypt = {
    deviceFirst: { open: () => ({ containerStore: tree }) },
    documents: {
      subscribe: (
        listener: (document: { readonly documentKind: string }) => void,
      ) => {
        documentListener = listener;
        return () => {
          documentListener = null;
        };
      },
    },
  } as unknown as SymCrypt;

  return {
    emitDocument: (documentKind: string) => {
      documentListener?.({ documentKind });
    },
    setNodes: (nodes: ContainerNode[]) => {
      snapshot = { nodes, ready: true };
      for (const listener of treeListeners) {
        listener();
      }
    },
    symcrypt,
  };
}

test("changes for root-set and organization-profile persistence signals", () => {
  const harness = createRefreshHarness();
  const scopeKey = createDomainScope();
  const view = renderHook(() =>
    useOrganizationIndexRefreshKey({ scopeKey, symcrypt: harness.symcrypt }),
  );
  const initialKey = view.result.current;

  act(() => {
    harness.setNodes([rootNode("root-a", "org-a")]);
  });
  const rootKey = view.result.current;
  expect(rootKey).not.toBe(initialKey);

  act(() => {
    harness.emitDocument("note");
  });
  expect(view.result.current).toBe(rootKey);

  act(() => {
    harness.emitDocument(ORGANIZATION_PROFILE_DOCUMENT_KIND);
  });
  expect(view.result.current).not.toBe(rootKey);
});
