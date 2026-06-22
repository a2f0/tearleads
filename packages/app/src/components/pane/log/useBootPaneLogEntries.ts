import { useMemo } from "react";
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
  return useMemo(() => {
    if (hasSigningKeyPair) {
      return [];
    }
    return [
      {
        id: "boot-pane-prompt",
        level: "info" as const,
        // Stamped when the prompt is (re)built, i.e. when its visibility or
        // message changes — hasSigningKeyPair is in the deps so the timestamp
        // reflects when the entry actually appears, not an earlier render.
        timestamp: Date.now(),
        message: paneLocked ? LOCKED_PANE_LOG_MESSAGE : bootMessage,
      },
    ];
  }, [bootMessage, hasSigningKeyPair, paneLocked]);
}
