import type { BlobStore } from "@tearleads/client-sdk";
import type { DesktopStateStorage } from "@tearleads/windowing";
import { useMemo } from "react";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";

// The desktop layout's key in the pane's blob store. The store is the
// identity's encrypted OPFS namespace once an identity is open (an in-memory
// store before that), so each identity keeps its own encrypted layout.
const DESKTOP_STATE_STORAGE_KEY = "shell/desktop-state.json";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** The desktop's storage adapter over a blob store, as UTF-8 JSON. */
export function createBlobStoreDesktopStateStorage(
  blobStore: BlobStore,
): DesktopStateStorage {
  return {
    read: async () => {
      const bytes = await blobStore.readBytes(DESKTOP_STATE_STORAGE_KEY);
      return bytes ? textDecoder.decode(bytes) : null;
    },
    write: (serialized) =>
      blobStore.writeBytes(
        DESKTOP_STATE_STORAGE_KEY,
        textEncoder.encode(serialized),
      ),
  };
}

/**
 * The pane desktop's storage adapter, over the pane's blob store. A new store
 * (another identity) yields a new adapter, so the desktop reloads its layout.
 */
export function usePaneDesktopStateStorage(): DesktopStateStorage {
  const { blobStore } = useTearleadsRuntime().infra;
  return useMemo(
    () => createBlobStoreDesktopStateStorage(blobStore),
    [blobStore],
  );
}
