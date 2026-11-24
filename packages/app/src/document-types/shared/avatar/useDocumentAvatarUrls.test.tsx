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
  type DocumentAvatarSource,
  useDocumentAvatarUrls,
} from "./useDocumentAvatarUrls";

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
  const source: DocumentAvatarSource = {
    blobStore,
    openDocument: (document) => {
      opened.push(document.localId);
      return stores[document.localId]?.store ?? null;
    },
  };
  return { opened, source };
}

function listed(localId: string): AvatarDocument {
  return {
    containerId: "root",
    documentId: null,
    documentKind: "tool",
    localId,
    photos,
  };
}

test("lists a chosen avatar and follows the document when it changes", async () => {
  const drill = fakeStore(EMPTY_SNAPSHOT);
  const { source } = fakeSource({ drill });
  const view = renderHook(() =>
    useDocumentAvatarUrls(source, [listed("drill")]),
  );
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
  const { source } = fakeSource({ loading, relabeled });
  const view = renderHook(() =>
    useDocumentAvatarUrls(source, [listed("relabeled"), listed("loading")]),
  );

  await act(async () => {
    await Promise.resolve();
  });
  expect(view.result.current).toEqual({});
});

test("a refreshed listing of the same documents keeps their stores open", () => {
  const drill = fakeStore(withAvatar("drill-key"));
  const { opened, source } = fakeSource({ drill });
  const view = renderHook(
    ({ documents }) => useDocumentAvatarUrls(source, documents),
    { initialProps: { documents: [listed("drill")] } },
  );
  view.rerender({ documents: [listed("drill")] });
  expect(opened).toEqual(["drill"]);

  view.rerender({ documents: [listed("drill"), listed("saw")] });
  expect(opened).toEqual(["drill", "drill", "saw"]);

  view.unmount();
  expect(drill.listeners.size).toBe(0);
});

test("without a source nothing is opened", () => {
  const view = renderHook(() => useDocumentAvatarUrls(null, [listed("drill")]));
  expect(view.result.current).toEqual({});
});
