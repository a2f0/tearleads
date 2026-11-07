import { EraserIcon } from "@phosphor-icons/react/dist/csr/Eraser";
import { useWindowTitleBarAction } from "@tearleads/windowing";
import { useMemo } from "react";

const CLEAR_ICON = <EraserIcon aria-hidden size={18} />;

/**
 * Registers a tab's clear action in the shared window/routed toolbar, right
 * after Copy report. Every tab's clear uses the same icon, and it acts at once:
 * what it clears is local, in-memory diagnostics, so there is no confirmation.
 */
export function useSystemMonitorClearAction({
  id,
  label,
  onClear,
}: {
  id: string;
  label: string;
  onClear: () => void;
}): void {
  useWindowTitleBarAction(
    useMemo(
      () => ({ icon: CLEAR_ICON, id, label, onClick: onClear, priority: 90 }),
      [id, label, onClear],
    ),
  );
}
