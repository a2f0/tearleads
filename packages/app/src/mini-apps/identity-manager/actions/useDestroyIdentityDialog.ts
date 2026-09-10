import { useCallback, useRef, useState } from "react";
import type { IdentityContextValue } from "../../../providers/identity/IdentityProvider";

export function useDestroyIdentityDialog({
  destroyKey,
  onDestroyed,
  signingFingerprint,
}: {
  readonly destroyKey: IdentityContextValue["destroyKey"];
  readonly onDestroyed: () => void;
  readonly signingFingerprint: string | null;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [destroying, setDestroying] = useState(false);
  const [destroyError, setDestroyError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestDestroyKeyPackage = useCallback(() => {
    setTarget(signingFingerprint);
    setDestroyError(null);
  }, [signingFingerprint]);
  const closeDestroyKeyPackageDialog = useCallback(() => {
    if (!inFlight.current) {
      setTarget(null);
    }
  }, []);
  const confirmDestroyKeyPackage = useCallback(() => {
    if (!target || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setDestroying(true);
    setDestroyError(null);
    void (async () => {
      try {
        if (!(await destroyKey(target))) {
          setDestroyError(
            "Another identity operation is in progress. Try again.",
          );
          return;
        }
        onDestroyed();
        setTarget(null);
      } catch {
        setDestroyError(
          "Deletion failed and may be partial. Retry to complete deletion. Until it succeeds, reloading can restore the saved identity.",
        );
      } finally {
        inFlight.current = false;
        setDestroying(false);
      }
    })();
  }, [destroyKey, onDestroyed, target]);

  return {
    closeDestroyKeyPackageDialog,
    confirmDestroyKeyPackage,
    destroyError,
    destroying,
    isDestroyKeyPackageDialogOpen: target !== null,
    requestDestroyKeyPackage,
  };
}
