import { useMemo, useRef } from "react";
import type { PaneLogEntry } from "./PaneLog";

const LOCKED_PANE_LOG_MESSAGE =
  "Unlock the local keychain to restore this pane.";

/**
 * Shared trailing pane-log prompt used by both pane shells (windowed and
 * routed). While the pane has no signing key pair it appends a single prompt
 * telling the user how to boot it; once a key pair exists the prompt is
 * dropped. The boot message differs per shell, so it is passed in.
 */
export function useBootPaneLogEntries(input: {
  readonly bootMessage: string;
  readonly hasSigningKeyPair: boolean;
  readonly paneLocked: boolean;
}): readonly PaneLogEntry[] {
  const { bootMessage, hasSigningKeyPair, paneLocked } = input;

  // Stamp the timestamp only when the inputs actually change. useMemo is not a
  // semantic guarantee (React may discard and recompute it), so calling
  // Date.now() inside it could drift the timestamp on a spurious recompute;
  // tracking previous inputs in a ref keeps it stable until a real change.
  const previousInputsRef = useRef({
    bootMessage,
    hasSigningKeyPair,
    paneLocked,
  });
  const timestampRef = useRef(Date.now());
  const previous = previousInputsRef.current;
  if (
    previous.bootMessage !== bootMessage ||
    previous.hasSigningKeyPair !== hasSigningKeyPair ||
    previous.paneLocked !== paneLocked
  ) {
    timestampRef.current = Date.now();
    previousInputsRef.current = { bootMessage, hasSigningKeyPair, paneLocked };
  }

  return useMemo(() => {
    if (hasSigningKeyPair) {
      return [];
    }
    return [
      {
        id: "boot-pane-prompt",
        level: "info" as const,
        timestamp: timestampRef.current,
        message: paneLocked ? LOCKED_PANE_LOG_MESSAGE : bootMessage,
      },
    ];
  }, [bootMessage, hasSigningKeyPair, paneLocked]);
}
