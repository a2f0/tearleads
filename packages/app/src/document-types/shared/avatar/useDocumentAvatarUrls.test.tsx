import { afterEach, expect, test } from "bun:test";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import type {
  BlobStore,
  DocumentAttachment,
  DocumentSnapshot,
  DocumentStore,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DocumentPhotoCapability } from "../documentPhotos";
import {
  type AvatarDocument,
  createDocumentAvatarSource,
  type DocumentAvatarSource,
} from "./documentAvatarSource";
import type { AvatarUrlById } from "./useAvatarUrls";
import { useDocumentAvatarUrls } from "./useDocumentAvatarUrls";

afterEach(cleanup);

const photos: DocumentPhotoCapability = {
  avatarFallbackIcon: WrenchIcon,
  slotId: "equipment-photos",
};

const photo: DocumentAttachment = {
  byteLength: 4,
  contentSha256: "1".repeat(64),
  mimeType: "image/png",
  name: "drill.png",
  slotId: "equipment-photos:one",
};

const EMPTY_SNAPSHOT: DocumentSnapshot = {
  attachments: [],
  attachmentStatusBySlotId: {},
  attachmentStorageKeyBySlotId: {},
  canAttach: true,
  canWrite: true,
  currentAuthorId: "user-1",
  documentId: null,
  documentKind: "tool",
  effectiveAccessLevel: "admin",
  fieldValidationIssues: [],
  ready: true,
  rows: [],
  structuredFields: {},
  syncing: false,
  text: "",
  title: "Untitled tool",
};

function withAvatar(storageKey: string): DocumentSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    attachments: [photo],
    attachmentStorageKeyBySlotId: { [photo.slotId]: storageKey },
    structuredFields: { avatarPhotoSlotId: photo.slotId },
  };
}

function fakeStore(initial: DocumentSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const store = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as DocumentStore;
  return {
    listeners,
    store,
    update(next: DocumentSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

function fakeSource(stores: Record<string, ReturnType<typeof fakeStore>>) {
  const opened: string[] = [];
  const blobStore = {
    openByteSource: async (storageKey: string) => {
      const bytes = new TextEncoder().encode(storageKey);
      return {
        byteLength: bytes.byteLength,
        read: async () => bytes,
      };
    },
  } as unknown as BlobStore;
  const source = createDocumentAvatarSource({
    blobStore,
    dbStatus: "ready",
    documentQueries: {
      loadDocumentSummary: async (localId) =>
        stores[localId]
          ? {
              containerId: "garage",
              documentId: null,
              id: localId,
              title: localId,
              updatedAt: "2026-11-24T00:00:00.000Z",
            }
          : null,
    },
    documents: {
      open: (input = {}) => {
        const localId = input.localId ?? "";
        opened.push(localId);
        const store = stores[localId]?.store;
        if (!store) throw new Error(`no fake store for ${localId}`);
        return store;
      },
    },
  });
  return { opened, source };
}

function listed(localId: string): AvatarDocument {
  return { documentKind: "tool", localId, photos };
}

test("lists a chosen avatar and follows the document when it changes", async () => {
  const drill = fakeStore(EMPTY_SNAPSHOT);
  const { source } = fakeSource({ drill });
  const listing = [listed("drill")];
  const view = renderHook(() => useDocumentAvatarUrls(source, listing));
  await waitFor(() => expect(drill.listeners.size).toBe(1));
  expect(view.result.current).toEqual({});

  act(() => drill.update(withAvatar("drill-key")));
  await waitFor(() =>
    expect(view.result.current).toEqual({
      drill: expect.stringMatching(/^blob:/u),
    }),
  );

  act(() => drill.update(EMPTY_SNAPSHOT));
  await waitFor(() => expect(view.result.current).toEqual({}));
});

test("a document of another kind, or not yet loaded, shows no avatar", async () => {
  const relabeled = fakeStore({
    ...withAvatar("relabeled-key"),
    documentKind: "appliance",
  });
  const loading = fakeStore({ ...withAvatar("loading-key"), ready: false });
  const { opened, source } = fakeSource({ loading, relabeled });
  const listing = [listed("relabeled"), listed("loading"), listed("missing")];
  const view = renderHook(() => useDocumentAvatarUrls(source, listing));

  await waitFor(() => expect(loading.listeners.size).toBe(1));
  // "missing" has no local copy, so it is never opened.
  expect(opened).toEqual(["relabeled", "loading"]);
  expect(view.result.current).toEqual({});
});

test("a still-listed avatar keeps its URL while a new listing opens", async () => {
  const drill = fakeStore(withAvatar("drill-key"));
  const saw = fakeStore(EMPTY_SNAPSHOT);
  const base = fakeSource({ drill, saw });
  // Reopening drill would be slow, so a listing that reopened it would show
  // saw's open first and drop drill's avatar meanwhile.
  const source: DocumentAvatarSource = {
    ...base.source,
    openDocument: async (document) => {
      const reopen = base.opened.includes(document.localId);
      const store = await base.source.openDocument(document);
      if (reopen) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return store;
    },
  };
  const seen: AvatarUrlById[] = [];
  const view = renderHook(
    ({ documents }) => {
      const urls = useDocumentAvatarUrls(source, documents);
      seen.push(urls);
      return urls;
    },
    { initialProps: { documents: [listed("drill")] } },
  );
  await waitFor(() =>
    expect(view.result.current).toEqual({
      drill: expect.stringMatching(/^blob:/u),
    }),
  );
  const { drill: drillUrl = "" } = view.result.current;
  const settled = seen.length;

  view.rerender({ documents: [listed("saw"), listed("drill")] });
  await waitFor(() => expect(saw.listeners.size).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(base.opened).toEqual(["drill", "saw"]);
  for (const urls of seen.slice(settled)) {
    expect(urls).toEqual({ drill: drillUrl });
  }
});

test("a refreshed listing of the same documents keeps their stores open", async () => {
  const drill = fakeStore(withAvatar("drill-key"));
  const saw = fakeStore(EMPTY_SNAPSHOT);
  const { opened, source } = fakeSource({ drill, saw });
  const view = renderHook(
    ({ documents }) => useDocumentAvatarUrls(source, documents),
    { initialProps: { documents: [listed("drill")] } },
  );
  await waitFor(() => expect(drill.listeners.size).toBe(1));
  view.rerender({ documents: [listed("drill")] });
  expect(opened).toEqual(["drill"]);

  view.rerender({ documents: [listed("saw")] });
  expect(drill.listeners.size).toBe(0);
  await waitFor(() => expect(opened).toEqual(["drill", "saw"]));
  // The dropped document's avatar clears once the new listing settles.
  await waitFor(() => expect(view.result.current).toEqual({}));
});

test("a remounted list reads the source's stores without reopening them", async () => {
  const drill = fakeStore(withAvatar("drill-key"));
  const { opened, source } = fakeSource({ drill });
  const listing = [listed("drill")];
  const first = renderHook(() => useDocumentAvatarUrls(source, listing));
  await waitFor(() => expect(drill.listeners.size).toBe(1));
  first.unmount();
  expect(drill.listeners.size).toBe(0);

  const second = renderHook(() => useDocumentAvatarUrls(source, listing));
  await waitFor(() =>
    expect(second.result.current).toEqual({
      drill: expect.stringMatching(/^blob:/u),
    }),
  );
  expect(drill.listeners.size).toBe(1);
  expect(opened).toEqual(["drill"]);
});

test("a relink reopens the listed document and follows its new owner", async () => {
  const displaced = fakeStore(withAvatar("old-key"));
  const owner = fakeStore(withAvatar("new-key"));
  const stores = { drill: displaced };
  const { opened, source } = fakeSource(stores);
  const listing = [listed("drill")];
  const view = renderHook(() => useDocumentAvatarUrls(source, listing));
  await waitFor(() =>
    expect(view.result.current).toEqual({
      drill: expect.stringMatching(/^blob:/u),
    }),
  );
  const { drill: displacedUrl = "" } = view.result.current;

  // Another record took the document id: the old view freezes, and a reopen
  // of the same local id resolves to the record that now owns it.
  stores.drill = owner;
  act(() =>
    displaced.update({
      ...displaced.store.getSnapshot(),
      relinkedElsewhere: true,
    }),
  );
  await waitFor(() => expect(owner.listeners.size).toBe(1));
  expect(displaced.listeners.size).toBe(0);
  expect(opened).toEqual(["drill", "drill"]);
  await waitFor(() => {
    const { drill: ownerUrl } = view.result.current;
    expect(ownerUrl).toMatch(/^blob:/u);
    expect(ownerUrl).not.toBe(displacedUrl);
  });
  expect(source.openedDocument("drill")).toBe(owner.store);
});

test("an open that finishes after its listing changed is not subscribed", async () => {
  const drill = fakeStore(withAvatar("drill-key"));
  let finishOpen: (store: DocumentStore) => void = () => undefined;
  const source: DocumentAvatarSource = {
    ...fakeSource({}).source,
    openDocument: () =>
      new Promise((resolve) => {
        finishOpen = resolve;
      }),
  };
  const view = renderHook(() =>
    useDocumentAvatarUrls(source, [listed("drill")]),
  );
  view.unmount();

  await act(async () => {
    finishOpen(drill.store);
    await Promise.resolve();
  });
  expect(drill.listeners.size).toBe(0);
});

test("without a source nothing is opened", () => {
  const view = renderHook(() => useDocumentAvatarUrls(null, [listed("drill")]));
  expect(view.result.current).toEqual({});
});
