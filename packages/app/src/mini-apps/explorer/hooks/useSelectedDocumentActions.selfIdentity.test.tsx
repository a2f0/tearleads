import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentLinks,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createDocumentStoreRuntime } from "../../../../test/helpers/documentStoreFixtures";
import type { CurrentSelfContactIdentity } from "../../../stores/contacts/currentSelfContactIdentity";
import type {
  SelfContactIdentitySource,
  SelfContactIdentityView,
} from "../../../stores/contacts/currentSelfContactIdentityState";
import { useSelfContactIdentitySource } from "../../../stores/contacts/useSelfContactIdentitySource";
import {
  createReadySelfIdentity,
  createSelfIdentityRules,
  identityDocument,
  SELF_IDENTITY_UPDATED_AT,
  selfIdentityNodes,
} from "../model/selfContactIdentity.testUtils";
import { useSelectedDocumentActions } from "./useSelectedDocumentActions";

afterEach(cleanup);

type LoadDocumentSummary = Parameters<
  typeof useSelectedDocumentActions
>[0]["loadDocumentSummary"];
type DestructiveAction = "move" | "purge";

function renderIdentityActions(
  document: DocumentSummary,
  useIdentity: () => SelfContactIdentityView,
  loadDocumentSummary?: LoadDocumentSummary,
) {
  const writes: string[] = [];
  const effects: string[] = [];
  // Reuse the typed, in-memory runtime rather than casting an incomplete SDK.
  const runtime = createDocumentStoreRuntime({
    auth: {
      isAuthenticated: true,
      organizationId: "identity-org",
      userId: "current-user",
    },
    state: { online: true },
  });
  const appData: ContainerDocumentLinks = {
    ...runtime,
    canMutateDocumentLinks: true,
    canMutateUnsyncedDocumentLinks: true,
    documentRuntime: () => runtime,
    openDocument: () => {
      throw new Error("Explorer actions must not open a document store");
    },
    resolveProjectionUserKey: async () => null,
    setActiveDocumentContainer: async ({ note }) => {
      writes.push(`activate:${note.id}`);
      return note;
    },
    moveDocumentToContainer: async ({ note, targetContainerId }) => {
      writes.push(`move:${note.id}:${targetContainerId}`);
      return {
        linksChanged: true,
        note: { ...note, containerId: targetContainerId },
      };
    },
    purgeDocument: async ({ note }) => {
      writes.push(`purge:${note.id}`);
      return {
        documentId: note.documentId ?? note.id,
        purgedAt: SELF_IDENTITY_UPDATED_AT,
        reclaimedBlobStorageKeys: [],
      };
    },
    linkDocumentToContainer: async ({ note, targetContainerId }) => {
      writes.push(`link:${note.id}:${targetContainerId}`);
      return note;
    },
    unlinkDocumentFromContainer: async ({ note, removedContainerId }) => {
      writes.push(`unlink:${note.id}:${removedContainerId}`);
      return note;
    },
  };
  const view = renderHook(() => {
    const rulesContext = createSelfIdentityRules(useIdentity());
    return useSelectedDocumentActions({
      appData,
      documentSummaries: loadDocumentSummary ? [] : [document],
      expandNode: (id) => effects.push(`expand:${id}`),
      linkedContainerIdsByDocumentId: new Map(),
      loadDocumentSummary: loadDocumentSummary ?? (async () => document),
      loadOrphanedDocumentSummary: async () => null,
      mergeDocumentSummary: (note) => effects.push(`merge:${note.id}`),
      nodes: selfIdentityNodes,
      onDocumentLinksChanged: (ids) => {
        effects.push(...Array.from(ids, (id) => `changed:${id}`));
      },
      rulesContext,
      setLinkedContainerIdsForDocument: () => effects.push("set-links"),
    });
  });
  return { ...view, writes, effects };
}

function invokeDestructiveAction(
  actions: ReturnType<typeof useSelectedDocumentActions>,
  action: DestructiveAction,
  document: DocumentSummary,
) {
  return action === "move"
    ? actions.moveDocument(document.id, "destination")
    : actions.purgeDocument(document.id);
}

for (const action of ["move", "purge"] as const) {
  for (const containerId of ["linked-folder", "trash"]) {
    test(`canonical-D alias refuses direct ${action} from ${containerId}`, async () => {
      const identity = await createReadySelfIdentity();
      const document = {
        ...identityDocument({
          id: "discovered-me-alias",
          documentId: identity.identity.documentId,
          documentKind: "contact",
          containerId,
        }),
        isSelf: false,
        userId: "not-the-current-user",
      };
      const view = renderIdentityActions(document, () => identity);
      expect({
        result: await invokeDestructiveAction(
          view.result.current,
          action,
          document,
        ),
        writes: view.writes,
        effects: view.effects,
      }).toEqual({ result: null, writes: [], effects: [] });
    });
  }

  for (const status of ["pending", "failed", "expired"] as const) {
    test(`${status} identity refuses direct ${action} without writes or effects`, async () => {
      const identity: SelfContactIdentityView =
        status === "expired"
          ? await createReadySelfIdentity(() => false)
          : status === "failed"
            ? { status: "failed", error: new Error("identity unavailable") }
            : { status: "pending" };
      const document = identityDocument({
        containerId: action === "purge" ? "trash" : "linked-folder",
      });
      const view = renderIdentityActions(document, () => identity);
      expect({
        result: await invokeDestructiveAction(
          view.result.current,
          action,
          document,
        ),
        writes: view.writes,
        effects: view.effects,
      }).toEqual({ result: null, writes: [], effects: [] });
    });
  }

  test(`identity expiry during held summary load refuses direct ${action}`, async () => {
    let current = true;
    const identity = await createReadySelfIdentity(() => current);
    const document = identityDocument({
      containerId: action === "purge" ? "trash" : "linked-folder",
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const loadedIds: string[] = [];
    const view = renderIdentityActions(
      document,
      () => identity,
      async (localId) => {
        loadedIds.push(localId);
        entered.resolve();
        await release.promise;
        return document;
      },
    );
    // Retain the actual callback; no rerender supplies it a replacement context.
    const pending = invokeDestructiveAction(
      view.result.current,
      action,
      document,
    );
    try {
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error("Action completed without entering the held load");
        }),
      ]);
      expect(loadedIds).toEqual([document.id]);
      expect(view.writes).toEqual([]);
      expect(view.effects).toEqual([]);
      current = false;
      release.resolve();
      expect({
        result: await pending,
        writes: view.writes,
        effects: view.effects,
      }).toEqual({ result: null, writes: [], effects: [] });
    } finally {
      release.resolve();
      await Promise.allSettled([pending]);
      view.unmount();
    }
  });

  test(`current ready identity permits ordinary direct ${action}`, async () => {
    const document = identityDocument({
      containerId: action === "purge" ? "trash" : "linked-folder",
    });
    const documentId = document.documentId;
    if (documentId === null) {
      throw new Error("Expected a synced ordinary-document fixture");
    }
    const identity = await createReadySelfIdentity();
    const view = renderIdentityActions(document, () => identity);
    const result = await invokeDestructiveAction(
      view.result.current,
      action,
      document,
    );
    if (action === "move") {
      expect(result).toEqual({ ...document, containerId: "destination" });
      expect(view.writes).toEqual([`move:${document.id}:destination`]);
      expect(view.effects).toEqual([
        "changed:destination",
        "changed:linked-folder",
      ]);
    } else {
      expect(result).toEqual({
        documentId,
        purgedAt: SELF_IDENTITY_UPDATED_AT,
        reclaimedBlobStorageKeys: [],
      });
      expect(view.writes).toEqual([`purge:${document.id}`]);
      expect(view.effects).toEqual([]);
    }
  });
}

test("canonical Me still permits direct link and unlink outside Contacts", async () => {
  const identity = await createReadySelfIdentity();
  const document = identityDocument({
    id: "discovered-me-alias",
    documentId: identity.identity.documentId,
    documentKind: "contact",
  });
  const view = renderIdentityActions(document, () => identity);
  await expect(
    view.result.current.linkDocument(document.id, "destination"),
  ).resolves.toEqual(document);
  await expect(
    view.result.current.unlinkDocument(document.id, "linked-folder"),
  ).resolves.toEqual(document);
  expect(view.writes).toEqual([
    `link:${document.id}:destination`,
    `unlink:${document.id}:linked-folder`,
  ]);
  expect(view.effects).toEqual([
    "changed:destination",
    "changed:linked-folder",
  ]);
});

function refreshableIdentity(identity: CurrentSelfContactIdentity) {
  let read = Promise.resolve(identity);
  let listener: () => void = () => undefined;
  let onLoad: () => void = () => undefined;
  let current: SelfContactIdentityView = { status: "pending" };
  const source: SelfContactIdentitySource = {
    enabled: true,
    isCurrent: () => true,
    load: () => {
      onLoad();
      return read;
    },
    subscribe: (next) => {
      listener = next;
      return () => undefined;
    },
  };
  return {
    getView: () => current,
    useIdentity: () => {
      current = useSelfContactIdentitySource(source);
      return current;
    },
    refresh: (next: Promise<CurrentSelfContactIdentity>) => {
      const entered = Promise.withResolvers<void>();
      read = next;
      onLoad = entered.resolve;
      listener();
      return entered.promise;
    },
  };
}

for (const action of ["move", "purge"] as const) {
  test(`an equivalent identity refresh preserves a retained ${action} callback`, async () => {
    const identity = (await createReadySelfIdentity()).identity;
    const source = refreshableIdentity(identity);
    const document = identityDocument({
      containerId: action === "purge" ? "trash" : "linked-folder",
    });
    const view = renderIdentityActions(document, source.useIdentity);
    try {
      await waitFor(() => expect(source.getView().status).toBe("ready"));
      const retained = view.result.current;
      await act(async () => {
        await source.refresh(
          Promise.resolve({
            ...identity,
            localIds: new Set(identity.localIds),
          }),
        );
      });
      expect(source.getView().status).toBe("ready");
      expect(
        await invokeDestructiveAction(retained, action, document),
      ).not.toBeNull();
      expect(view.writes).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  for (const changed of [false, true]) {
    test(`held ${action} waits for ${changed ? "a new recovery alias and refuses" : "equivalent identity and proceeds"}`, async () => {
      const identity = (await createReadySelfIdentity()).identity;
      const source = refreshableIdentity(identity);
      const document = identityDocument({
        id: "possibly-recovered-alias",
        documentId: null,
        containerId: action === "purge" ? "trash" : "linked-folder",
      });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const refresh = Promise.withResolvers<CurrentSelfContactIdentity>();
      const refreshed = {
        ...identity,
        localIds: new Set([
          ...identity.localIds,
          ...(changed ? [document.id] : []),
        ]),
      };
      const view = renderIdentityActions(
        document,
        source.useIdentity,
        async () => {
          entered.resolve();
          await release.promise;
          return document;
        },
      );
      let pending: Promise<unknown> | undefined;
      try {
        await waitFor(() => expect(source.getView().status).toBe("ready"));
        let settled = false;
        pending = invokeDestructiveAction(
          view.result.current,
          action,
          document,
        ).then((result) => {
          settled = true;
          return result;
        });
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw new Error("Action did not enter preparation");
          }),
        ]);
        await act(async () => {
          await source.refresh(refresh.promise);
        });
        await act(async () => {
          release.resolve();
          await release.promise;
        });
        expect(view.writes).toEqual([]);
        expect(settled).toBe(false);
        await act(async () => {
          refresh.resolve(refreshed);
          await refresh.promise;
        });
        const result = await pending;
        if (changed) {
          expect(result).toBeNull();
          expect(view.writes).toEqual([]);
          expect(view.effects).toEqual([]);
        } else {
          expect(result).not.toBeNull();
          expect(view.writes).toHaveLength(1);
        }
      } finally {
        await act(async () => {
          release.resolve();
          refresh.resolve(refreshed);
          await Promise.allSettled([pending]);
        });
        view.unmount();
      }
    });
  }
}
