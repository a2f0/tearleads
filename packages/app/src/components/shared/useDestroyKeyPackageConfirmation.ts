import { useCallback, useState } from "react";

export function useDestroyKeyPackageConfirmation(onDestroy: () => void) {
  const [isOpen, setOpen] = useState(false);

  const requestDestroyKeyPackage = useCallback(() => {
    setOpen(true);
  }, []);

  const closeDestroyKeyPackageDialog = useCallback(() => {
    setOpen(false);
  }, []);

  const confirmDestroyKeyPackage = useCallback(() => {
    onDestroy();
    setOpen(false);
  }, [onDestroy]);

  return {
    closeDestroyKeyPackageDialog,
    confirmDestroyKeyPackage,
    isOpen,
    requestDestroyKeyPackage,
  };
}
