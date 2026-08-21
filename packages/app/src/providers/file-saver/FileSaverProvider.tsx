import type { FileSaver } from "@symcrypt/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useRef,
} from "react";
import { createBrowserFileSaver } from "../../utils/downloadFile";
import { useAppHostConfig } from "../host/AppHostConfigProvider";

// Default to the browser saver so any component (and its tests) can call
// useFileSaver() without a provider mounted; the provider overrides it with the
// platform saver from the host config. The default is built eagerly here
// because createBrowserFileSaver() touches no DOM until saveFile() runs.
const FileSaverContext = createContext<FileSaver>(createBrowserFileSaver());

/**
 * Exposes the platform's {@link FileSaver} (the download action), mirroring
 * `DirectCheckoutProvider`. Shells without a native saver fall back to the
 * browser saver, so `useFileSaver()` is always safe to call.
 *
 * Built once per mount via a ref: a Capacitor/Electrobun saver may hold native
 * resources, so it must not be rebuilt on re-render.
 */
export function FileSaverProvider({ children }: PropsWithChildren) {
  const { createFileSaver } = useAppHostConfig();
  const saverRef = useRef<FileSaver | null>(null);
  if (!saverRef.current) {
    saverRef.current = createFileSaver
      ? createFileSaver()
      : createBrowserFileSaver();
  }
  return (
    <FileSaverContext.Provider value={saverRef.current}>
      {children}
    </FileSaverContext.Provider>
  );
}

export function useFileSaver(): FileSaver {
  return useContext(FileSaverContext);
}
